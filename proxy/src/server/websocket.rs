//! The WebSocket client transport: adapts `tungstenite` messages to the relay and closes the
//! WebSocket with a status code for the way the tunnel ended

use std::time::Duration;

use futures_util::{SinkExt, StreamExt, future::ready};
use telesignal_tunnel::{
    relay::{self, ClientError, ClientOutput, End, Tunnel, UPSTREAM_READ_BYTES},
    upstream::Upstream,
};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::WebSocketStream;
use tungstenite::{
    Bytes, Error as WsError, Message, Utf8Bytes,
    error::ProtocolError,
    protocol::{CloseFrame, WebSocketConfig, frame::coding::CloseCode},
};

/// Room for one message and a queued control frame
const MAX_WRITE_BUFFER_BYTES: usize = 2 * UPSTREAM_READ_BYTES;
/// Time allowed for the client's reply to the tunnel's close frame
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
const TEXT_MESSAGE: &str = "binary messages only";
const MESSAGE_TOO_BIG: &str = "message too big";
const PROTOCOL_ERROR: &str = "protocol error";

pub fn get_config(max_message_bytes: usize) -> WebSocketConfig {
    WebSocketConfig::default()
        .max_frame_size(Some(max_message_bytes))
        .max_message_size(Some(max_message_bytes))
        .write_buffer_size(0)
        .max_write_buffer_size(MAX_WRITE_BUFFER_BYTES)
}

pub async fn relay(
    tunnel: &Tunnel<'_>,
    websocket: WebSocketStream<TcpStream>,
    upstream: Upstream,
    shutdown: impl Future<Output = ()>,
) -> End {
    let (client_tx, client_rx) = websocket.split();
    let mut client_rx = client_rx.filter_map(|message| ready(get_client_input(message)));
    let mut client_tx = client_tx.with(|output| ready(Ok::<_, WsError>(get_message(output))));
    let end = relay::relay(tunnel, &mut client_rx, &mut client_tx, upstream, shutdown).await;

    match get_close_frame(&end) {
        // Waits for the client's close frame, so the connection ends cleanly
        Some(frame) => drop(
            timeout(CLOSE_TIMEOUT, async {
                if client_tx
                    .get_mut()
                    .send(Message::Close(Some(frame)))
                    .await
                    .is_ok()
                {
                    while let Some(Ok(_)) = client_rx.next().await {}
                }
            })
            .await,
        ),
        // Sends the reply to the client's close frame if it is still queued
        None => drop(timeout(CLOSE_TIMEOUT, client_tx.flush()).await),
    }
    end
}

/// Returns `None` for messages the relay does not see: `tungstenite` answers pings, and after a
/// close frame the next read sends the reply and ends the stream
fn get_client_input(message: Result<Message, WsError>) -> Option<Result<Bytes, ClientError>> {
    Some(match message {
        Ok(Message::Binary(data)) => Ok(data),
        Ok(Message::Text(_)) | Err(WsError::Utf8(_)) => Err(ClientError::Violation(TEXT_MESSAGE)),
        Ok(_) => return None,
        Err(WsError::Capacity(_)) => Err(ClientError::Violation(MESSAGE_TOO_BIG)),
        Err(WsError::Protocol(ProtocolError::ResetWithoutClosingHandshake)) => {
            Err(ClientError::Failed)
        }
        Err(WsError::Protocol(_)) => Err(ClientError::Violation(PROTOCOL_ERROR)),
        Err(_) => Err(ClientError::Failed),
    })
}

fn get_message(output: ClientOutput) -> Message {
    match output {
        ClientOutput::Data(data) => Message::binary(data),
        ClientOutput::Finished => Message::Close(Some(CloseFrame {
            code: CloseCode::Normal,
            reason: Utf8Bytes::default(),
        })),
    }
}

fn get_close_frame(end: &End) -> Option<CloseFrame> {
    let (code, reason) = match end {
        End::ClientViolation(reason) => {
            let code = match *reason {
                TEXT_MESSAGE => CloseCode::Unsupported,
                MESSAGE_TOO_BIG => CloseCode::Size,
                _ => CloseCode::Protocol,
            };
            (code, *reason)
        }
        End::BadClientHello(reason) => (CloseCode::Policy, *reason),
        End::HourlyBytes => (CloseCode::Policy, "hourly byte limit reached"),
        End::UpstreamFailed => (CloseCode::Error, "upstream connection failed"),
        End::Idle => (CloseCode::Normal, "idle timeout"),
        End::Shutdown => (CloseCode::Away, "tunnel shutting down"),
        End::ClientClosed | End::ClientFailed | End::UpstreamClosed => return None,
    };
    Some(CloseFrame {
        code,
        reason: Utf8Bytes::from_static(reason),
    })
}
