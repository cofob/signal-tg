//! libsignal store traits implemented by calling async JS objects.
//!
//! `Native.ts` adapts the wrapper's stores to this byte-level interface, so records
//! cross the boundary serialized and addresses as `(name, deviceId)`:
//!
//! - session: `loadSession(name, deviceId)`, `storeSession(name, deviceId, record)`
//! - identity: `getLocalIdentityKeyPair() -> [privateKey, publicKey]`, `getLocalRegistrationId()`,
//!   `getIdentityKey(name, deviceId)`, `saveIdentityKey(name, deviceId, key) -> IdentityChange`,
//!   `isTrustedIdentity(name, deviceId, key, direction)`, `recordReceivedIdentityKey(name, deviceId, key)`
//! - prekeys: `loadPreKey(id)`, `storePreKey(id, record)`, `removePreKey(id)`
//! - signed prekeys: `loadSignedPreKey(id)`, `storeSignedPreKey(id, record)`
//! - Kyber prekeys: `loadKyberPreKey(id)`, `storeKyberPreKey(id, record)`,
//!   `markKyberPreKeyUsed(id, signedPreKeyId, baseKey)`
//! - sender keys: `loadSenderKey(name, deviceId, distributionId)`, `storeSenderKey(name, deviceId, distributionId, record)`
//!
//! Loads resolve to `Uint8Array`, or to `undefined` or `null` when the record is missing.

use async_trait::async_trait;
use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
use libsignal_protocol::{self as lsp, SignalProtocolError};
use uuid::Uuid;
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::error::{CallbackError, remember_callback_error};

type Result<T> = std::result::Result<T, SignalProtocolError>;

pub(crate) struct JsStore(pub(crate) JsValue);

fn callback_failure(method: &'static str, error: JsValue) -> SignalProtocolError {
    let description = error
        .dyn_ref::<js_sys::Error>()
        .map(|error| String::from(error.message()))
        .unwrap_or_else(|| method.to_owned());
    remember_callback_error(error);
    SignalProtocolError::ApplicationCallbackError(method, Box::new(CallbackError(description)))
}

fn bytes(value: &[u8]) -> JsValue {
    Uint8Array::from(value).into()
}

fn optional_bytes(value: JsValue) -> Option<Vec<u8>> {
    if value.is_null() || value.is_undefined() {
        None
    } else {
        Some(Uint8Array::new(&value).to_vec())
    }
}

fn address_args(address: &lsp::ProtocolAddress) -> [JsValue; 2] {
    [address.name().into(), u32::from(address.device_id()).into()]
}

impl JsStore {
    async fn call(&self, method: &'static str, args: &[JsValue]) -> Result<JsValue> {
        let function: Function = Reflect::get(&self.0, &method.into())
            .map_err(|error| callback_failure(method, error))?
            .dyn_into()
            .map_err(|_| {
                let message = format!("store method `{method}` is not a function");
                callback_failure(method, js_sys::Error::new(&message).into())
            })?;
        let args: Array = args.iter().collect();
        let result = function
            .apply(&self.0, &args)
            .map_err(|error| callback_failure(method, error))?;
        JsFuture::from(Promise::resolve(&result))
            .await
            .map_err(|error| callback_failure(method, error))
    }

    async fn load(&self, method: &'static str, args: &[JsValue]) -> Result<Option<Vec<u8>>> {
        Ok(optional_bytes(self.call(method, args).await?))
    }
}

#[async_trait(?Send)]
impl lsp::SessionStore for JsStore {
    async fn load_session(&self, address: &lsp::ProtocolAddress) -> Result<Option<lsp::SessionRecord>> {
        self.load("loadSession", &address_args(address))
            .await?
            .map(|record| lsp::SessionRecord::deserialize(&record))
            .transpose()
    }

    async fn store_session(&mut self, address: &lsp::ProtocolAddress, record: &lsp::SessionRecord) -> Result<()> {
        let [name, device_id] = address_args(address);
        self.call("storeSession", &[name, device_id, bytes(&record.serialize()?)])
            .await?;
        Ok(())
    }
}

#[async_trait(?Send)]
impl lsp::IdentityKeyStore for JsStore {
    async fn get_identity_key_pair(&self) -> Result<lsp::IdentityKeyPair> {
        let pair = Array::from(&self.call("getLocalIdentityKeyPair", &[]).await?);
        let private_key = lsp::PrivateKey::deserialize(&Uint8Array::new(&pair.get(0)).to_vec())?;
        let public_key = lsp::PublicKey::deserialize(&Uint8Array::new(&pair.get(1)).to_vec())?;
        Ok(lsp::IdentityKeyPair::new(lsp::IdentityKey::new(public_key), private_key))
    }

    async fn get_local_registration_id(&self) -> Result<u32> {
        let id = self.call("getLocalRegistrationId", &[]).await?;
        Ok(id.as_f64().unwrap_or_default() as u32)
    }

    async fn save_identity(
        &mut self,
        address: &lsp::ProtocolAddress,
        identity: &lsp::IdentityKey,
    ) -> Result<lsp::IdentityChange> {
        let [name, device_id] = address_args(address);
        let change = self
            .call("saveIdentityKey", &[name, device_id, bytes(&identity.serialize())])
            .await?;
        Ok(if change.as_f64() == Some(1.0) {
            lsp::IdentityChange::ReplacedExisting
        } else {
            lsp::IdentityChange::NewOrUnchanged
        })
    }

    async fn is_trusted_identity(
        &self,
        address: &lsp::ProtocolAddress,
        identity: &lsp::IdentityKey,
        direction: lsp::Direction,
    ) -> Result<bool> {
        let [name, device_id] = address_args(address);
        let direction = match direction {
            lsp::Direction::Sending => 0,
            lsp::Direction::Receiving => 1,
        };
        let trusted = self
            .call(
                "isTrustedIdentity",
                &[name, device_id, bytes(&identity.serialize()), direction.into()],
            )
            .await?;
        Ok(trusted.is_truthy())
    }

    async fn get_identity(&self, address: &lsp::ProtocolAddress) -> Result<Option<lsp::IdentityKey>> {
        self.load("getIdentityKey", &address_args(address))
            .await?
            .map(|key| lsp::IdentityKey::decode(&key))
            .transpose()
    }

    async fn record_received_identity(
        &mut self,
        address: &lsp::ProtocolAddress,
        identity: &lsp::IdentityKey,
    ) -> Result<()> {
        let [name, device_id] = address_args(address);
        self.call(
            "recordReceivedIdentityKey",
            &[name, device_id, bytes(&identity.serialize())],
        )
        .await?;
        Ok(())
    }
}

#[async_trait(?Send)]
impl lsp::PreKeyStore for JsStore {
    async fn get_pre_key(&self, prekey_id: lsp::PreKeyId) -> Result<lsp::PreKeyRecord> {
        let record = self
            .load("loadPreKey", &[u32::from(prekey_id).into()])
            .await?
            .ok_or(SignalProtocolError::InvalidPreKeyId)?;
        lsp::PreKeyRecord::deserialize(&record)
    }

    async fn save_pre_key(&mut self, prekey_id: lsp::PreKeyId, record: &lsp::PreKeyRecord) -> Result<()> {
        self.call("storePreKey", &[u32::from(prekey_id).into(), bytes(&record.serialize()?)])
            .await?;
        Ok(())
    }

    async fn remove_pre_key(&mut self, prekey_id: lsp::PreKeyId) -> Result<()> {
        self.call("removePreKey", &[u32::from(prekey_id).into()]).await?;
        Ok(())
    }
}

#[async_trait(?Send)]
impl lsp::SignedPreKeyStore for JsStore {
    async fn get_signed_pre_key(&self, id: lsp::SignedPreKeyId) -> Result<lsp::SignedPreKeyRecord> {
        use lsp::GenericSignedPreKey as _;
        let record = self
            .load("loadSignedPreKey", &[u32::from(id).into()])
            .await?
            .ok_or(SignalProtocolError::InvalidSignedPreKeyId)?;
        lsp::SignedPreKeyRecord::deserialize(&record)
    }

    async fn save_signed_pre_key(
        &mut self,
        id: lsp::SignedPreKeyId,
        record: &lsp::SignedPreKeyRecord,
    ) -> Result<()> {
        use lsp::GenericSignedPreKey as _;
        self.call("storeSignedPreKey", &[u32::from(id).into(), bytes(&record.serialize()?)])
            .await?;
        Ok(())
    }
}

#[async_trait(?Send)]
impl lsp::KyberPreKeyStore for JsStore {
    async fn get_kyber_pre_key(&self, id: lsp::KyberPreKeyId) -> Result<lsp::KyberPreKeyRecord> {
        use lsp::GenericSignedPreKey as _;
        let record = self
            .load("loadKyberPreKey", &[u32::from(id).into()])
            .await?
            .ok_or(SignalProtocolError::InvalidKyberPreKeyId)?;
        lsp::KyberPreKeyRecord::deserialize(&record)
    }

    async fn save_kyber_pre_key(
        &mut self,
        id: lsp::KyberPreKeyId,
        record: &lsp::KyberPreKeyRecord,
    ) -> Result<()> {
        use lsp::GenericSignedPreKey as _;
        self.call("storeKyberPreKey", &[u32::from(id).into(), bytes(&record.serialize()?)])
            .await?;
        Ok(())
    }

    async fn mark_kyber_pre_key_used(
        &mut self,
        id: lsp::KyberPreKeyId,
        ec_prekey_id: lsp::SignedPreKeyId,
        base_key: &lsp::PublicKey,
    ) -> Result<()> {
        self.call(
            "markKyberPreKeyUsed",
            &[
                u32::from(id).into(),
                u32::from(ec_prekey_id).into(),
                bytes(&base_key.serialize()),
            ],
        )
        .await?;
        Ok(())
    }
}

#[async_trait(?Send)]
impl lsp::SenderKeyStore for JsStore {
    async fn store_sender_key(
        &mut self,
        sender: &lsp::ProtocolAddress,
        distribution_id: Uuid,
        record: &lsp::SenderKeyRecord,
    ) -> Result<()> {
        let [name, device_id] = address_args(sender);
        self.call(
            "storeSenderKey",
            &[
                name,
                device_id,
                bytes(distribution_id.as_bytes()),
                bytes(&record.serialize()?),
            ],
        )
        .await?;
        Ok(())
    }

    async fn load_sender_key(
        &mut self,
        sender: &lsp::ProtocolAddress,
        distribution_id: Uuid,
    ) -> Result<Option<lsp::SenderKeyRecord>> {
        let [name, device_id] = address_args(sender);
        self.load(
            "loadSenderKey",
            &[name, device_id, bytes(distribution_id.as_bytes())],
        )
        .await?
        .map(|record| lsp::SenderKeyRecord::deserialize(&record))
        .transpose()
    }
}
