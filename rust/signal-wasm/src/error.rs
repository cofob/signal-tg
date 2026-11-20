use std::cell::RefCell;
use std::fmt;

use js_sys::{Error as JsError, Object, Reflect};
use libsignal_protocol::{ProtocolAddress as LsProtocolAddress, SignalProtocolError};
use wasm_bindgen::prelude::*;

use crate::handles::ProtocolAddress;

pub(crate) type JsResult<T> = Result<T, JsValue>;

thread_local! {
    // The exception thrown by the last failed JS store callback, rethrown as is
    // when libsignal reports `ApplicationCallbackError`
    static CALLBACK_ERROR: RefCell<Option<JsValue>> = const { RefCell::new(None) };
}

#[derive(Debug)]
pub(crate) struct CallbackError(pub(crate) String);

impl fmt::Display for CallbackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CallbackError {}

pub(crate) fn remember_callback_error(error: JsValue) {
    CALLBACK_ERROR.with(|slot| *slot.borrow_mut() = Some(error));
}

fn take_callback_error() -> Option<JsValue> {
    CALLBACK_ERROR.with(|slot| slot.borrow_mut().take())
}

/// Builds the error object that `Native.ts` converts into `LibSignalErrorBase`.
pub(crate) fn make_error(
    name: Option<&str>,
    message: &str,
    operation: &str,
    extra_props: Option<Object>,
) -> JsValue {
    let error = JsError::new(message);
    let name = name.map_or(JsValue::UNDEFINED, JsValue::from_str);
    // Setting properties on a fresh `Error` cannot fail
    let _ = Reflect::set(&error, &"libsignalName".into(), &name);
    let _ = Reflect::set(&error, &"operation".into(), &operation.into());
    if let Some(extra_props) = extra_props {
        let _ = Reflect::set(&error, &"extraProps".into(), &extra_props);
    }
    error.into()
}

fn props(entries: &[(&str, JsValue)]) -> Object {
    let object = Object::new();
    for (key, value) in entries {
        let _ = Reflect::set(&object, &(*key).into(), value);
    }
    object
}

pub(crate) fn protocol_error(error: SignalProtocolError, operation: &str) -> JsValue {
    let message = error.to_string();
    match error {
        SignalProtocolError::DuplicatedMessage(..) => {
            make_error(Some("DuplicatedMessage"), &message, operation, None)
        }
        SignalProtocolError::SealedSenderSelfSend => {
            make_error(Some("SealedSenderSelfSend"), &message, operation, None)
        }
        SignalProtocolError::UntrustedIdentity(addr) => make_error(
            Some("UntrustedIdentity"),
            &message,
            operation,
            Some(props(&[("_addr", addr.name().into())])),
        ),
        SignalProtocolError::InvalidRegistrationId(addr, _value) => make_error(
            Some("InvalidRegistrationId"),
            &message,
            operation,
            Some(props(&[("_addr", ProtocolAddress(addr).into())])),
        ),
        SignalProtocolError::InvalidProtocolAddress { name, device_id } => make_error(
            Some("InvalidProtocolAddress"),
            &message,
            operation,
            Some(props(&[("name", name.into()), ("deviceId", device_id.into())])),
        ),
        SignalProtocolError::InvalidSessionStructure(..) => {
            make_error(Some("InvalidSession"), &message, operation, None)
        }
        SignalProtocolError::InvalidSenderKeySession { distribution_id } => make_error(
            Some("InvalidSenderKeySession"),
            &message,
            operation,
            Some(props(&[(
                "distribution_id",
                format!("{:x}", distribution_id.as_hyphenated()).into(),
            )])),
        ),
        SignalProtocolError::ApplicationCallbackError(..) => take_callback_error()
            .unwrap_or_else(|| make_error(None, &message, operation, None)),
        _ => make_error(None, &message, operation, None),
    }
}

pub(crate) fn generic_error(error: impl fmt::Display, operation: &str) -> JsValue {
    make_error(None, &error.to_string(), operation, None)
}

pub(crate) trait ProtocolResultExt<T> {
    fn or_throw(self, operation: &str) -> JsResult<T>;
}

impl<T> ProtocolResultExt<T> for Result<T, SignalProtocolError> {
    fn or_throw(self, operation: &str) -> JsResult<T> {
        self.map_err(|error| protocol_error(error, operation))
    }
}

pub(crate) trait GenericResultExt<T> {
    fn or_throw_generic(self, operation: &str) -> JsResult<T>;
}

impl<T, E: fmt::Display> GenericResultExt<T> for Result<T, E> {
    fn or_throw_generic(self, operation: &str) -> JsResult<T> {
        self.map_err(|error| generic_error(error, operation))
    }
}

pub(crate) fn invalid_address(name: String, device_id: u32) -> SignalProtocolError {
    SignalProtocolError::InvalidProtocolAddress { name, device_id }
}

pub(crate) fn new_address(name: String, device_id: u32) -> Result<LsProtocolAddress, SignalProtocolError> {
    let device = device_id
        .try_into()
        .map_err(|_| invalid_address(name.clone(), device_id))?;
    Ok(LsProtocolAddress::new(name, device))
}
