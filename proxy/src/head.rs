//! Bounded reading of HTTP/1.1 heads

use tokio::io::{AsyncRead, AsyncReadExt};

pub enum HeadError {
    TooLarge,
    Malformed,
    Closed,
}

/// Reads from `stream` until `parse` finds a complete head within `max_bytes`, and returns the
/// parsed head with the bytes received after it
pub async fn read_head<S: AsyncRead + Unpin, T>(
    stream: &mut S,
    max_bytes: usize,
    mut parse: impl FnMut(&[u8]) -> Result<Option<(usize, T)>, HeadError>,
) -> Result<(T, Vec<u8>), HeadError> {
    let mut buffer = vec![0; max_bytes];
    let mut length = 0;
    loop {
        let free = buffer
            .get_mut(length..)
            .filter(|free| !free.is_empty())
            .ok_or(HeadError::TooLarge)?;
        let read = stream.read(free).await.map_err(|_| HeadError::Closed)?;
        if read == 0 {
            return Err(HeadError::Closed);
        }
        length += read;
        let received = buffer.get(..length).unwrap_or_default();
        if let Some((head_length, head)) = parse(received)? {
            return Ok((
                head,
                received.get(head_length..).unwrap_or_default().to_vec(),
            ));
        }
    }
}
