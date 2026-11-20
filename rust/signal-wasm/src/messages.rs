//! Protocol messages, certificates and sealed sender content

use libsignal_protocol as lsp;
use wasm_bindgen::prelude::*;

use crate::error::{JsResult, ProtocolResultExt, protocol_error};
use crate::handles::*;
use crate::records::timestamp;

fn invalid_argument(message: String, operation: &str) -> JsValue {
    protocol_error(lsp::SignalProtocolError::InvalidArgument(message), operation)
}

fn uuid_bytes(uuid: uuid::Uuid) -> Vec<u8> {
    uuid.as_bytes().to_vec()
}

#[wasm_bindgen]
pub fn CiphertextMessage_Type(msg: &CiphertextMessage) -> u8 {
    msg.0.message_type() as u8
}

#[wasm_bindgen]
pub fn CiphertextMessage_Serialize(obj: &CiphertextMessage) -> Vec<u8> {
    obj.0.serialize().to_vec()
}

#[wasm_bindgen]
pub fn CiphertextMessage_FromPlaintextContent(m: &PlaintextContent) -> CiphertextMessage {
    CiphertextMessage(lsp::CiphertextMessage::PlaintextContent(m.0.clone()))
}

#[wasm_bindgen]
pub fn SignalMessage_Deserialize(data: &[u8]) -> JsResult<SignalMessage> {
    lsp::SignalMessage::try_from(data)
        .map(SignalMessage)
        .or_throw("SignalMessage_Deserialize")
}

#[wasm_bindgen]
pub fn SignalMessage_GetSerialized(obj: &SignalMessage) -> Vec<u8> {
    obj.0.serialized().to_vec()
}

#[wasm_bindgen]
pub fn SignalMessage_GetBody(obj: &SignalMessage) -> Vec<u8> {
    obj.0.body().to_vec()
}

#[wasm_bindgen]
pub fn SignalMessage_GetCounter(obj: &SignalMessage) -> u32 {
    obj.0.counter()
}

#[wasm_bindgen]
pub fn SignalMessage_GetMessageVersion(obj: &SignalMessage) -> u32 {
    obj.0.message_version().into()
}

#[wasm_bindgen]
pub fn PreKeySignalMessage_Deserialize(data: &[u8]) -> JsResult<PreKeySignalMessage> {
    lsp::PreKeySignalMessage::try_from(data)
        .map(PreKeySignalMessage)
        .or_throw("PreKeySignalMessage_Deserialize")
}

#[wasm_bindgen]
pub fn PreKeySignalMessage_Serialize(obj: &PreKeySignalMessage) -> Vec<u8> {
    obj.0.serialized().to_vec()
}

#[wasm_bindgen]
pub fn PreKeySignalMessage_GetRegistrationId(obj: &PreKeySignalMessage) -> u32 {
    obj.0.registration_id()
}

#[wasm_bindgen]
pub fn PreKeySignalMessage_GetSignedPreKeyId(obj: &PreKeySignalMessage) -> u32 {
    obj.0.signed_pre_key_id().into()
}

#[wasm_bindgen]
pub fn PreKeySignalMessage_GetPreKeyId(obj: &PreKeySignalMessage) -> Option<u32> {
    obj.0.pre_key_id().map(u32::from)
}

#[wasm_bindgen]
pub fn PreKeySignalMessage_GetVersion(obj: &PreKeySignalMessage) -> u32 {
    obj.0.message_version().into()
}

#[wasm_bindgen]
pub fn SenderKeyMessage_Deserialize(data: &[u8]) -> JsResult<SenderKeyMessage> {
    lsp::SenderKeyMessage::try_from(data)
        .map(SenderKeyMessage)
        .or_throw("SenderKeyMessage_Deserialize")
}

#[wasm_bindgen]
pub fn SenderKeyMessage_Serialize(obj: &SenderKeyMessage) -> Vec<u8> {
    obj.0.serialized().to_vec()
}

#[wasm_bindgen]
pub fn SenderKeyMessage_GetCipherText(obj: &SenderKeyMessage) -> Vec<u8> {
    obj.0.ciphertext().to_vec()
}

#[wasm_bindgen]
pub fn SenderKeyMessage_GetDistributionId(obj: &SenderKeyMessage) -> Vec<u8> {
    uuid_bytes(obj.0.distribution_id())
}

#[wasm_bindgen]
pub fn SenderKeyMessage_GetChainId(obj: &SenderKeyMessage) -> u32 {
    obj.0.chain_id()
}

#[wasm_bindgen]
pub fn SenderKeyMessage_GetIteration(obj: &SenderKeyMessage) -> u32 {
    obj.0.iteration()
}

#[wasm_bindgen]
pub fn SenderKeyMessage_VerifySignature(skm: &SenderKeyMessage, pubkey: &PublicKey) -> JsResult<bool> {
    skm.0
        .verify_signature(&pubkey.0)
        .or_throw("SenderKeyMessage_VerifySignature")
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_Deserialize(data: &[u8]) -> JsResult<SenderKeyDistributionMessage> {
    lsp::SenderKeyDistributionMessage::try_from(data)
        .map(SenderKeyDistributionMessage)
        .or_throw("SenderKeyDistributionMessage_Deserialize")
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_Serialize(obj: &SenderKeyDistributionMessage) -> Vec<u8> {
    obj.0.serialized().to_vec()
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_GetChainKey(obj: &SenderKeyDistributionMessage) -> JsResult<Vec<u8>> {
    obj.0
        .chain_key()
        .map(<[u8]>::to_vec)
        .or_throw("SenderKeyDistributionMessage_GetChainKey")
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_GetDistributionId(
    obj: &SenderKeyDistributionMessage,
) -> JsResult<Vec<u8>> {
    obj.0
        .distribution_id()
        .map(uuid_bytes)
        .or_throw("SenderKeyDistributionMessage_GetDistributionId")
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_GetChainId(obj: &SenderKeyDistributionMessage) -> JsResult<u32> {
    obj.0.chain_id().or_throw("SenderKeyDistributionMessage_GetChainId")
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_GetIteration(obj: &SenderKeyDistributionMessage) -> JsResult<u32> {
    obj.0.iteration().or_throw("SenderKeyDistributionMessage_GetIteration")
}

#[wasm_bindgen]
pub fn PlaintextContent_Deserialize(data: &[u8]) -> JsResult<PlaintextContent> {
    lsp::PlaintextContent::try_from(data)
        .map(PlaintextContent)
        .or_throw("PlaintextContent_Deserialize")
}

#[wasm_bindgen]
pub fn PlaintextContent_Serialize(obj: &PlaintextContent) -> Vec<u8> {
    obj.0.serialized().to_vec()
}

#[wasm_bindgen]
pub fn PlaintextContent_GetBody(obj: &PlaintextContent) -> Vec<u8> {
    obj.0.body().to_vec()
}

#[wasm_bindgen]
pub fn PlaintextContent_FromDecryptionErrorMessage(m: &DecryptionErrorMessage) -> PlaintextContent {
    PlaintextContent(m.0.clone().into())
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_Deserialize(data: &[u8]) -> JsResult<DecryptionErrorMessage> {
    lsp::DecryptionErrorMessage::try_from(data)
        .map(DecryptionErrorMessage)
        .or_throw("DecryptionErrorMessage_Deserialize")
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_Serialize(obj: &DecryptionErrorMessage) -> Vec<u8> {
    obj.0.serialized().to_vec()
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_GetTimestamp(obj: &DecryptionErrorMessage) -> f64 {
    obj.0.timestamp().epoch_millis() as f64
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_GetDeviceId(obj: &DecryptionErrorMessage) -> u32 {
    obj.0.device_id()
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_GetRatchetKey(m: &DecryptionErrorMessage) -> Option<PublicKey> {
    m.0.ratchet_key().copied().map(PublicKey)
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_ForOriginalMessage(
    original_bytes: &[u8],
    original_type: u8,
    original_timestamp: f64,
    original_sender_device_id: u32,
) -> JsResult<DecryptionErrorMessage> {
    let operation = "DecryptionErrorMessage_ForOriginalMessage";
    let original_type = lsp::CiphertextMessageType::try_from(original_type)
        .map_err(|_| invalid_argument(format!("unknown message type {original_type}"), operation))?;
    lsp::DecryptionErrorMessage::for_original(
        original_bytes,
        original_type,
        timestamp(original_timestamp),
        original_sender_device_id,
    )
    .map(DecryptionErrorMessage)
    .or_throw(operation)
}

#[wasm_bindgen]
pub fn DecryptionErrorMessage_ExtractFromSerializedContent(bytes: &[u8]) -> JsResult<DecryptionErrorMessage> {
    lsp::extract_decryption_error_message_from_serialized_content(bytes)
        .map(DecryptionErrorMessage)
        .or_throw("DecryptionErrorMessage_ExtractFromSerializedContent")
}

#[wasm_bindgen]
pub fn ServerCertificate_Deserialize(data: &[u8]) -> JsResult<ServerCertificate> {
    lsp::ServerCertificate::deserialize(data)
        .map(ServerCertificate)
        .or_throw("ServerCertificate_Deserialize")
}

#[wasm_bindgen]
pub fn ServerCertificate_GetSerialized(obj: &ServerCertificate) -> JsResult<Vec<u8>> {
    obj.0
        .serialized()
        .map(<[u8]>::to_vec)
        .or_throw("ServerCertificate_GetSerialized")
}

#[wasm_bindgen]
pub fn ServerCertificate_GetKeyId(obj: &ServerCertificate) -> JsResult<u32> {
    obj.0.key_id().or_throw("ServerCertificate_GetKeyId")
}

#[wasm_bindgen]
pub fn ServerCertificate_GetKey(obj: &ServerCertificate) -> JsResult<PublicKey> {
    obj.0.public_key().map(PublicKey).or_throw("ServerCertificate_GetKey")
}

#[wasm_bindgen]
pub fn SenderCertificate_Deserialize(data: &[u8]) -> JsResult<SenderCertificate> {
    lsp::SenderCertificate::deserialize(data)
        .map(SenderCertificate)
        .or_throw("SenderCertificate_Deserialize")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetSerialized(obj: &SenderCertificate) -> JsResult<Vec<u8>> {
    obj.0
        .serialized()
        .map(<[u8]>::to_vec)
        .or_throw("SenderCertificate_GetSerialized")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetSenderUuid(obj: &SenderCertificate) -> JsResult<String> {
    obj.0
        .sender_uuid()
        .map(str::to_owned)
        .or_throw("SenderCertificate_GetSenderUuid")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetSenderE164(obj: &SenderCertificate) -> JsResult<Option<String>> {
    obj.0
        .sender_e164()
        .map(|e164| e164.map(str::to_owned))
        .or_throw("SenderCertificate_GetSenderE164")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetDeviceId(obj: &SenderCertificate) -> JsResult<u32> {
    obj.0
        .sender_device_id()
        .map(u32::from)
        .or_throw("SenderCertificate_GetDeviceId")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetExpiration(obj: &SenderCertificate) -> JsResult<f64> {
    obj.0
        .expiration()
        .map(|t| t.epoch_millis() as f64)
        .or_throw("SenderCertificate_GetExpiration")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetKey(obj: &SenderCertificate) -> JsResult<PublicKey> {
    obj.0.key().map(PublicKey).or_throw("SenderCertificate_GetKey")
}

#[wasm_bindgen]
pub fn SenderCertificate_GetServerCertificate(cert: &SenderCertificate) -> JsResult<ServerCertificate> {
    cert.0
        .signer()
        .map(|signer| ServerCertificate(signer.clone()))
        .or_throw("SenderCertificate_GetServerCertificate")
}

/// `trust_roots` is an array of `PublicKey` handles.
#[wasm_bindgen]
pub fn SenderCertificate_Validate(cert: &SenderCertificate, trust_roots: Vec<PublicKey>, time: f64) -> bool {
    let roots: Vec<&lsp::PublicKey> = trust_roots.iter().map(|root| &root.0).collect();
    cert.0
        .validate_with_trust_roots(&roots, timestamp(time))
        .unwrap_or(false)
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_Deserialize(data: &[u8]) -> JsResult<UnidentifiedSenderMessageContent> {
    lsp::UnidentifiedSenderMessageContent::deserialize(data)
        .map(UnidentifiedSenderMessageContent)
        .or_throw("UnidentifiedSenderMessageContent_Deserialize")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_Serialize(obj: &UnidentifiedSenderMessageContent) -> JsResult<Vec<u8>> {
    obj.0
        .serialized()
        .map(<[u8]>::to_vec)
        .or_throw("UnidentifiedSenderMessageContent_Serialize")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_GetContents(obj: &UnidentifiedSenderMessageContent) -> JsResult<Vec<u8>> {
    obj.0
        .contents()
        .map(<[u8]>::to_vec)
        .or_throw("UnidentifiedSenderMessageContent_GetContents")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_GetGroupId(
    obj: &UnidentifiedSenderMessageContent,
) -> JsResult<Option<Vec<u8>>> {
    obj.0
        .group_id()
        .map(|group_id| group_id.map(<[u8]>::to_vec))
        .or_throw("UnidentifiedSenderMessageContent_GetGroupId")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_GetSenderCert(
    m: &UnidentifiedSenderMessageContent,
) -> JsResult<SenderCertificate> {
    m.0.sender()
        .map(|sender| SenderCertificate(sender.clone()))
        .or_throw("UnidentifiedSenderMessageContent_GetSenderCert")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_GetMsgType(m: &UnidentifiedSenderMessageContent) -> JsResult<u8> {
    m.0.msg_type()
        .map(|msg_type| msg_type as u8)
        .or_throw("UnidentifiedSenderMessageContent_GetMsgType")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_GetContentHint(m: &UnidentifiedSenderMessageContent) -> JsResult<u32> {
    m.0.content_hint()
        .map(u32::from)
        .or_throw("UnidentifiedSenderMessageContent_GetContentHint")
}

#[wasm_bindgen]
pub fn UnidentifiedSenderMessageContent_New(
    message: &CiphertextMessage,
    sender: &SenderCertificate,
    content_hint: u32,
    group_id: Option<Vec<u8>>,
) -> JsResult<UnidentifiedSenderMessageContent> {
    lsp::UnidentifiedSenderMessageContent::new(
        message.0.message_type(),
        sender.0.clone(),
        message.0.serialize().to_owned(),
        lsp::ContentHint::from(content_hint),
        group_id,
    )
    .map(UnidentifiedSenderMessageContent)
    .or_throw("UnidentifiedSenderMessageContent_New")
}

/// Extracts the only recipient's message from a multi-recipient sealed sender payload
#[wasm_bindgen]
pub fn SealedSender_MultiRecipientMessageForSingleRecipient(encoded: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "SealedSender_MultiRecipientMessageForSingleRecipient";
    let messages = lsp::SealedSenderV2SentMessage::parse(encoded).or_throw(operation)?;
    if messages.recipients.len() != 1 {
        return Err(invalid_argument(
            "only supports messages with exactly one recipient".to_owned(),
            operation,
        ));
    }
    Ok(messages
        .received_message_parts_for_recipient(&messages.recipients[0])
        .as_ref()
        .concat())
}

#[wasm_bindgen]
pub fn ServiceId_ParseFromServiceIdString(input: String) -> JsResult<Vec<u8>> {
    lsp::ServiceId::parse_from_service_id_string(&input)
        .map(|service_id| service_id.service_id_fixed_width_binary().to_vec())
        .ok_or_else(|| invalid_argument("invalid service ID".to_owned(), "ServiceId_ParseFromServiceIdString"))
}

#[wasm_bindgen]
pub fn ServiceId_ParseFromServiceIdBinary(input: &[u8]) -> JsResult<Vec<u8>> {
    lsp::ServiceId::parse_from_service_id_binary(input)
        .map(|service_id| service_id.service_id_fixed_width_binary().to_vec())
        .ok_or_else(|| invalid_argument("invalid service ID".to_owned(), "ServiceId_ParseFromServiceIdBinary"))
}

fn fixed_width_service_id(value: &[u8], operation: &str) -> JsResult<lsp::ServiceId> {
    let fixed: &[u8; 17] = value
        .try_into()
        .map_err(|_| invalid_argument("invalid service ID length".to_owned(), operation))?;
    lsp::ServiceId::parse_from_service_id_fixed_width_binary(fixed)
        .ok_or_else(|| invalid_argument("invalid service ID".to_owned(), operation))
}

#[wasm_bindgen]
pub fn ServiceId_ServiceIdBinary(value: &[u8]) -> JsResult<Vec<u8>> {
    Ok(fixed_width_service_id(value, "ServiceId_ServiceIdBinary")?.service_id_binary())
}

#[wasm_bindgen]
pub fn ServiceId_ServiceIdString(value: &[u8]) -> JsResult<String> {
    Ok(fixed_width_service_id(value, "ServiceId_ServiceIdString")?.service_id_string())
}

#[wasm_bindgen]
pub fn ServiceId_ServiceIdLog(value: &[u8]) -> JsResult<String> {
    Ok(format!("{}", fixed_width_service_id(value, "ServiceId_ServiceIdLog")?.service_id_string()))
}
