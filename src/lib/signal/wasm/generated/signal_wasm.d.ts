/* tslint:disable */
/* eslint-disable */

export class CiphertextMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

export function CiphertextMessage_FromPlaintextContent(m: PlaintextContent): CiphertextMessage;

export function CiphertextMessage_Serialize(obj: CiphertextMessage): Uint8Array;

export function CiphertextMessage_Type(msg: CiphertextMessage): number;

export class DecryptionErrorMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): DecryptionErrorMessage;
}

export function DecryptionErrorMessage_Deserialize(data: Uint8Array): DecryptionErrorMessage;

export function DecryptionErrorMessage_ExtractFromSerializedContent(bytes: Uint8Array): DecryptionErrorMessage;

export function DecryptionErrorMessage_ForOriginalMessage(original_bytes: Uint8Array, original_type: number, original_timestamp: number, original_sender_device_id: number): DecryptionErrorMessage;

export function DecryptionErrorMessage_GetDeviceId(obj: DecryptionErrorMessage): number;

export function DecryptionErrorMessage_GetRatchetKey(m: DecryptionErrorMessage): PublicKey | undefined;

export function DecryptionErrorMessage_GetTimestamp(obj: DecryptionErrorMessage): number;

export function DecryptionErrorMessage_Serialize(obj: DecryptionErrorMessage): Uint8Array;

export class Fingerprint {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): Fingerprint;
}

export function Fingerprint_DisplayString(obj: Fingerprint): string;

export function Fingerprint_New(iterations: number, version: number, local_identifier: Uint8Array, local_key: PublicKey, remote_identifier: Uint8Array, remote_key: PublicKey): Fingerprint;

export function Fingerprint_ScannableEncoding(obj: Fingerprint): Uint8Array;

export function GroupCipher_DecryptMessage(sender: ProtocolAddress, message: Uint8Array, store: any): Promise<any>;

export function GroupCipher_EncryptMessage(sender: ProtocolAddress, distribution_id: Uint8Array, message: Uint8Array, store: any): Promise<any>;

export function HKDF_DeriveSecrets(output_length: number, ikm: Uint8Array, label?: Uint8Array | null, salt?: Uint8Array | null): Uint8Array;

export function IdentityKeyPair_Deserialize(input: Uint8Array): Array<any>;

export function IdentityKeyPair_Serialize(public_key: PublicKey, private_key: PrivateKey): Uint8Array;

export function IdentityKeyPair_SignAlternateIdentity(public_key: PublicKey, private_key: PrivateKey, other_identity: PublicKey): Uint8Array;

export class KyberKeyPair {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): KyberKeyPair;
}

export function KyberKeyPair_Generate(): KyberKeyPair;

export function KyberKeyPair_GetPublicKey(key_pair: KyberKeyPair): KyberPublicKey;

export function KyberKeyPair_GetSecretKey(key_pair: KyberKeyPair): KyberSecretKey;

export class KyberPreKeyRecord {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): KyberPreKeyRecord;
}

export function KyberPreKeyRecord_Deserialize(data: Uint8Array): KyberPreKeyRecord;

export function KyberPreKeyRecord_GetId(obj: KyberPreKeyRecord): number;

export function KyberPreKeyRecord_GetKeyPair(obj: KyberPreKeyRecord): KyberKeyPair;

export function KyberPreKeyRecord_GetPublicKey(obj: KyberPreKeyRecord): KyberPublicKey;

export function KyberPreKeyRecord_GetSecretKey(obj: KyberPreKeyRecord): KyberSecretKey;

export function KyberPreKeyRecord_GetSignature(obj: KyberPreKeyRecord): Uint8Array;

export function KyberPreKeyRecord_GetTimestamp(obj: KyberPreKeyRecord): number;

export function KyberPreKeyRecord_New(id: number, timestamp_millis: number, key_pair: KyberKeyPair, signature: Uint8Array): KyberPreKeyRecord;

export function KyberPreKeyRecord_Serialize(obj: KyberPreKeyRecord): Uint8Array;

export class KyberPublicKey {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): KyberPublicKey;
}

export function KyberPublicKey_Deserialize(data: Uint8Array): KyberPublicKey;

export function KyberPublicKey_Equals(lhs: KyberPublicKey, rhs: KyberPublicKey): boolean;

export function KyberPublicKey_Serialize(obj: KyberPublicKey): Uint8Array;

export class KyberSecretKey {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): KyberSecretKey;
}

export function KyberSecretKey_Deserialize(data: Uint8Array): KyberSecretKey;

export function KyberSecretKey_Serialize(obj: KyberSecretKey): Uint8Array;

export class PlaintextContent {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): PlaintextContent;
}

export function PlaintextContent_Deserialize(data: Uint8Array): PlaintextContent;

export function PlaintextContent_FromDecryptionErrorMessage(m: DecryptionErrorMessage): PlaintextContent;

export function PlaintextContent_GetBody(obj: PlaintextContent): Uint8Array;

export function PlaintextContent_Serialize(obj: PlaintextContent): Uint8Array;

export class PreKeyBundle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): PreKeyBundle;
}

export function PreKeyBundle_GetDeviceId(obj: PreKeyBundle): number;

export function PreKeyBundle_GetIdentityKey(obj: PreKeyBundle): PublicKey;

export function PreKeyBundle_GetRegistrationId(obj: PreKeyBundle): number;

export function PreKeyBundle_New(registration_id: number, device_id: number, prekey_id: number | null | undefined, prekey: PublicKey | null | undefined, signed_prekey_id: number, signed_prekey: PublicKey, signed_prekey_signature: Uint8Array, identity_key: PublicKey, kyber_prekey_id: number, kyber_prekey: KyberPublicKey, kyber_prekey_signature: Uint8Array): PreKeyBundle;

export class PreKeyRecord {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): PreKeyRecord;
}

export function PreKeyRecord_Deserialize(data: Uint8Array): PreKeyRecord;

export function PreKeyRecord_GetId(obj: PreKeyRecord): number;

export function PreKeyRecord_GetPrivateKey(obj: PreKeyRecord): PrivateKey;

export function PreKeyRecord_GetPublicKey(obj: PreKeyRecord): PublicKey;

export function PreKeyRecord_New(id: number, pub_key: PublicKey, priv_key: PrivateKey): PreKeyRecord;

export function PreKeyRecord_Serialize(obj: PreKeyRecord): Uint8Array;

export class PreKeySignalMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): PreKeySignalMessage;
}

export function PreKeySignalMessage_Deserialize(data: Uint8Array): PreKeySignalMessage;

export function PreKeySignalMessage_GetPreKeyId(obj: PreKeySignalMessage): number | undefined;

export function PreKeySignalMessage_GetRegistrationId(obj: PreKeySignalMessage): number;

export function PreKeySignalMessage_GetSignedPreKeyId(obj: PreKeySignalMessage): number;

export function PreKeySignalMessage_GetVersion(obj: PreKeySignalMessage): number;

export function PreKeySignalMessage_Serialize(obj: PreKeySignalMessage): Uint8Array;

export class PrivateKey {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): PrivateKey;
}

export function PrivateKey_Agree(private_key: PrivateKey, public_key: PublicKey): Uint8Array;

export function PrivateKey_Deserialize(data: Uint8Array): PrivateKey;

export function PrivateKey_Generate(): PrivateKey;

export function PrivateKey_GetPublicKey(key: PrivateKey): PublicKey;

export function PrivateKey_Serialize(obj: PrivateKey): Uint8Array;

export function PrivateKey_Sign(key: PrivateKey, message: Uint8Array): Uint8Array;

export class ProtocolAddress {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): ProtocolAddress;
}

export function ProtocolAddress_DeviceId(obj: ProtocolAddress): number;

export function ProtocolAddress_Name(obj: ProtocolAddress): string;

export function ProtocolAddress_New(name: string, device_id: number): ProtocolAddress;

export class PublicKey {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): PublicKey;
}

export function PublicKey_Deserialize(data: Uint8Array): PublicKey;

export function PublicKey_Equals(lhs: PublicKey, rhs: PublicKey): boolean;

export function PublicKey_GetPublicKeyBytes(obj: PublicKey): Uint8Array;

export function PublicKey_Serialize(obj: PublicKey): Uint8Array;

export function PublicKey_Verify(key: PublicKey, message: Uint8Array, signature: Uint8Array): boolean;

export function ScannableFingerprint_Compare(fprint1: Uint8Array, fprint2: Uint8Array): boolean;

export function SealedSender_DecryptToUsmc(ctext: Uint8Array, identity_store: any): Promise<any>;

export function SealedSender_Encrypt(destination: ProtocolAddress, content: UnidentifiedSenderMessageContent, identity_key_store: any): Promise<any>;

/**
 * `excluded_recipients` is a concatenation of fixed-width service IDs.
 */
export function SealedSender_MultiRecipientEncrypt(recipients: ProtocolAddress[], recipient_sessions: SessionRecord[], excluded_recipients: Uint8Array, content: UnidentifiedSenderMessageContent, identity_key_store: any): Promise<any>;

/**
 * Extracts the only recipient's message from a multi-recipient sealed sender payload
 */
export function SealedSender_MultiRecipientMessageForSingleRecipient(encoded: Uint8Array): Uint8Array;

export class SenderCertificate {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SenderCertificate;
}

export function SenderCertificate_Deserialize(data: Uint8Array): SenderCertificate;

export function SenderCertificate_GetDeviceId(obj: SenderCertificate): number;

export function SenderCertificate_GetExpiration(obj: SenderCertificate): number;

export function SenderCertificate_GetKey(obj: SenderCertificate): PublicKey;

export function SenderCertificate_GetSenderE164(obj: SenderCertificate): string | undefined;

export function SenderCertificate_GetSenderUuid(obj: SenderCertificate): string;

export function SenderCertificate_GetSerialized(obj: SenderCertificate): Uint8Array;

export function SenderCertificate_GetServerCertificate(cert: SenderCertificate): ServerCertificate;

/**
 * `trust_roots` is an array of `PublicKey` handles.
 */
export function SenderCertificate_Validate(cert: SenderCertificate, trust_roots: PublicKey[], time: number): boolean;

export class SenderKeyDistributionMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SenderKeyDistributionMessage;
}

export function SenderKeyDistributionMessage_Create(sender: ProtocolAddress, distribution_id: Uint8Array, store: any): Promise<any>;

export function SenderKeyDistributionMessage_Deserialize(data: Uint8Array): SenderKeyDistributionMessage;

export function SenderKeyDistributionMessage_GetChainId(obj: SenderKeyDistributionMessage): number;

export function SenderKeyDistributionMessage_GetChainKey(obj: SenderKeyDistributionMessage): Uint8Array;

export function SenderKeyDistributionMessage_GetDistributionId(obj: SenderKeyDistributionMessage): Uint8Array;

export function SenderKeyDistributionMessage_GetIteration(obj: SenderKeyDistributionMessage): number;

export function SenderKeyDistributionMessage_Process(sender: ProtocolAddress, message: SenderKeyDistributionMessage, store: any): Promise<any>;

export function SenderKeyDistributionMessage_Serialize(obj: SenderKeyDistributionMessage): Uint8Array;

export class SenderKeyMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SenderKeyMessage;
}

export function SenderKeyMessage_Deserialize(data: Uint8Array): SenderKeyMessage;

export function SenderKeyMessage_GetChainId(obj: SenderKeyMessage): number;

export function SenderKeyMessage_GetCipherText(obj: SenderKeyMessage): Uint8Array;

export function SenderKeyMessage_GetDistributionId(obj: SenderKeyMessage): Uint8Array;

export function SenderKeyMessage_GetIteration(obj: SenderKeyMessage): number;

export function SenderKeyMessage_Serialize(obj: SenderKeyMessage): Uint8Array;

export function SenderKeyMessage_VerifySignature(skm: SenderKeyMessage, pubkey: PublicKey): boolean;

export class SenderKeyRecord {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SenderKeyRecord;
}

export function SenderKeyRecord_Deserialize(data: Uint8Array): SenderKeyRecord;

export function SenderKeyRecord_Serialize(obj: SenderKeyRecord): Uint8Array;

export class ServerCertificate {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): ServerCertificate;
}

export function ServerCertificate_Deserialize(data: Uint8Array): ServerCertificate;

export function ServerCertificate_GetKey(obj: ServerCertificate): PublicKey;

export function ServerCertificate_GetKeyId(obj: ServerCertificate): number;

export function ServerCertificate_GetSerialized(obj: ServerCertificate): Uint8Array;

export function ServiceId_ParseFromServiceIdBinary(input: Uint8Array): Uint8Array;

export function ServiceId_ParseFromServiceIdString(input: string): Uint8Array;

export function ServiceId_ServiceIdBinary(value: Uint8Array): Uint8Array;

export function ServiceId_ServiceIdLog(value: Uint8Array): string;

export function ServiceId_ServiceIdString(value: Uint8Array): string;

export function SessionBuilder_ProcessPreKeyBundle(bundle: PreKeyBundle, protocol_address: ProtocolAddress, local_address: ProtocolAddress, session_store: any, identity_key_store: any, now: number): Promise<any>;

export function SessionCipher_DecryptPreKeySignalMessage(message: PreKeySignalMessage, protocol_address: ProtocolAddress, local_address: ProtocolAddress, session_store: any, identity_key_store: any, prekey_store: any, signed_prekey_store: any, kyber_prekey_store: any): Promise<any>;

export function SessionCipher_DecryptSignalMessage(message: SignalMessage, protocol_address: ProtocolAddress, local_address: ProtocolAddress, session_store: any, identity_key_store: any): Promise<any>;

export function SessionCipher_EncryptMessage(ptext: Uint8Array, protocol_address: ProtocolAddress, local_address: ProtocolAddress, session_store: any, identity_key_store: any, now: number): Promise<any>;

export class SessionRecord {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SessionRecord;
}

export function SessionRecord_ArchiveCurrentState(obj: SessionRecord): void;

export function SessionRecord_CurrentRatchetKeyMatches(obj: SessionRecord, key: PublicKey): boolean;

export function SessionRecord_Deserialize(data: Uint8Array): SessionRecord;

export function SessionRecord_GetLocalRegistrationId(obj: SessionRecord): number;

export function SessionRecord_GetRemoteRegistrationId(obj: SessionRecord): number;

export function SessionRecord_HasUsableSenderChain(obj: SessionRecord, now: number): boolean;

export function SessionRecord_Serialize(obj: SessionRecord): Uint8Array;

export class SignalMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SignalMessage;
}

export function SignalMessage_Deserialize(data: Uint8Array): SignalMessage;

export function SignalMessage_GetBody(obj: SignalMessage): Uint8Array;

export function SignalMessage_GetCounter(obj: SignalMessage): number;

export function SignalMessage_GetMessageVersion(obj: SignalMessage): number;

export function SignalMessage_GetSerialized(obj: SignalMessage): Uint8Array;

export class SignedPreKeyRecord {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     */
    cloneHandle(): SignedPreKeyRecord;
}

export function SignedPreKeyRecord_Deserialize(data: Uint8Array): SignedPreKeyRecord;

export function SignedPreKeyRecord_GetId(obj: SignedPreKeyRecord): number;

export function SignedPreKeyRecord_GetPrivateKey(obj: SignedPreKeyRecord): PrivateKey;

export function SignedPreKeyRecord_GetPublicKey(obj: SignedPreKeyRecord): PublicKey;

export function SignedPreKeyRecord_GetSignature(obj: SignedPreKeyRecord): Uint8Array;

export function SignedPreKeyRecord_GetTimestamp(obj: SignedPreKeyRecord): number;

export function SignedPreKeyRecord_New(id: number, timestamp_millis: number, pub_key: PublicKey, priv_key: PrivateKey, signature: Uint8Array): SignedPreKeyRecord;

export function SignedPreKeyRecord_Serialize(obj: SignedPreKeyRecord): Uint8Array;

export class TlsClient {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Queues `close_notify`; call `takeOutgoing` afterwards
     */
    close(): void;
    isHandshaking(): boolean;
    /**
     * `trust_anchors` are DER certificates; only chains to them are accepted.
     */
    constructor(server_name: string, trust_anchors: Uint8Array[]);
    /**
     * Processes bytes from the peer and returns the decrypted application data
     */
    receive(data: Uint8Array): Uint8Array;
    /**
     * Queues application data; it is sent after the handshake completes
     */
    send(data: Uint8Array): void;
    /**
     * Returns TLS records to write to the tunnel
     */
    takeOutgoing(): Uint8Array;
}

export class UnidentifiedSenderMessageContent {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

export function UnidentifiedSenderMessageContent_Deserialize(data: Uint8Array): UnidentifiedSenderMessageContent;

export function UnidentifiedSenderMessageContent_GetContentHint(m: UnidentifiedSenderMessageContent): number;

export function UnidentifiedSenderMessageContent_GetContents(obj: UnidentifiedSenderMessageContent): Uint8Array;

export function UnidentifiedSenderMessageContent_GetGroupId(obj: UnidentifiedSenderMessageContent): Uint8Array | undefined;

export function UnidentifiedSenderMessageContent_GetMsgType(m: UnidentifiedSenderMessageContent): number;

export function UnidentifiedSenderMessageContent_GetSenderCert(m: UnidentifiedSenderMessageContent): SenderCertificate;

export function UnidentifiedSenderMessageContent_New(message: CiphertextMessage, sender: SenderCertificate, content_hint: number, group_id?: Uint8Array | null): UnidentifiedSenderMessageContent;

export function UnidentifiedSenderMessageContent_Serialize(obj: UnidentifiedSenderMessageContent): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly CiphertextMessage_FromPlaintextContent: (a: number) => number;
    readonly CiphertextMessage_Serialize: (a: number) => [number, number];
    readonly CiphertextMessage_Type: (a: number) => number;
    readonly DecryptionErrorMessage_Deserialize: (a: number, b: number) => [number, number, number];
    readonly DecryptionErrorMessage_ExtractFromSerializedContent: (a: number, b: number) => [number, number, number];
    readonly DecryptionErrorMessage_ForOriginalMessage: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly DecryptionErrorMessage_GetDeviceId: (a: number) => number;
    readonly DecryptionErrorMessage_GetRatchetKey: (a: number) => number;
    readonly DecryptionErrorMessage_GetTimestamp: (a: number) => number;
    readonly DecryptionErrorMessage_Serialize: (a: number) => [number, number];
    readonly Fingerprint_DisplayString: (a: number) => [number, number, number, number];
    readonly Fingerprint_New: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly Fingerprint_ScannableEncoding: (a: number) => [number, number, number, number];
    readonly GroupCipher_DecryptMessage: (a: number, b: number, c: number, d: any) => any;
    readonly GroupCipher_EncryptMessage: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly HKDF_DeriveSecrets: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly IdentityKeyPair_Deserialize: (a: number, b: number) => [number, number, number];
    readonly IdentityKeyPair_Serialize: (a: number, b: number) => [number, number];
    readonly IdentityKeyPair_SignAlternateIdentity: (a: number, b: number, c: number) => [number, number, number, number];
    readonly KyberKeyPair_Generate: () => number;
    readonly KyberKeyPair_GetPublicKey: (a: number) => number;
    readonly KyberKeyPair_GetSecretKey: (a: number) => number;
    readonly KyberPreKeyRecord_Deserialize: (a: number, b: number) => [number, number, number];
    readonly KyberPreKeyRecord_GetId: (a: number) => [number, number, number];
    readonly KyberPreKeyRecord_GetKeyPair: (a: number) => [number, number, number];
    readonly KyberPreKeyRecord_GetPublicKey: (a: number) => [number, number, number];
    readonly KyberPreKeyRecord_GetSecretKey: (a: number) => [number, number, number];
    readonly KyberPreKeyRecord_GetSignature: (a: number) => [number, number, number, number];
    readonly KyberPreKeyRecord_GetTimestamp: (a: number) => [number, number, number];
    readonly KyberPreKeyRecord_New: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly KyberPreKeyRecord_Serialize: (a: number) => [number, number, number, number];
    readonly KyberPublicKey_Deserialize: (a: number, b: number) => [number, number, number];
    readonly KyberPublicKey_Equals: (a: number, b: number) => number;
    readonly KyberPublicKey_Serialize: (a: number) => [number, number];
    readonly KyberSecretKey_Deserialize: (a: number, b: number) => [number, number, number];
    readonly PlaintextContent_Deserialize: (a: number, b: number) => [number, number, number];
    readonly PlaintextContent_FromDecryptionErrorMessage: (a: number) => number;
    readonly PlaintextContent_GetBody: (a: number) => [number, number];
    readonly PlaintextContent_Serialize: (a: number) => [number, number];
    readonly PreKeyBundle_GetDeviceId: (a: number) => [number, number, number];
    readonly PreKeyBundle_GetIdentityKey: (a: number) => [number, number, number];
    readonly PreKeyBundle_GetRegistrationId: (a: number) => [number, number, number];
    readonly PreKeyBundle_New: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly PreKeyRecord_Deserialize: (a: number, b: number) => [number, number, number];
    readonly PreKeyRecord_GetId: (a: number) => [number, number, number];
    readonly PreKeyRecord_GetPrivateKey: (a: number) => [number, number, number];
    readonly PreKeyRecord_GetPublicKey: (a: number) => [number, number, number];
    readonly PreKeyRecord_New: (a: number, b: number, c: number) => number;
    readonly PreKeyRecord_Serialize: (a: number) => [number, number, number, number];
    readonly PreKeySignalMessage_Deserialize: (a: number, b: number) => [number, number, number];
    readonly PreKeySignalMessage_GetPreKeyId: (a: number) => number;
    readonly PreKeySignalMessage_GetRegistrationId: (a: number) => number;
    readonly PreKeySignalMessage_GetSignedPreKeyId: (a: number) => number;
    readonly PreKeySignalMessage_GetVersion: (a: number) => number;
    readonly PreKeySignalMessage_Serialize: (a: number) => [number, number];
    readonly PrivateKey_Agree: (a: number, b: number) => [number, number, number, number];
    readonly PrivateKey_Deserialize: (a: number, b: number) => [number, number, number];
    readonly PrivateKey_Generate: () => number;
    readonly PrivateKey_GetPublicKey: (a: number) => [number, number, number];
    readonly PrivateKey_Serialize: (a: number) => [number, number];
    readonly PrivateKey_Sign: (a: number, b: number, c: number) => [number, number, number, number];
    readonly ProtocolAddress_DeviceId: (a: number) => number;
    readonly ProtocolAddress_Name: (a: number) => [number, number];
    readonly ProtocolAddress_New: (a: number, b: number, c: number) => [number, number, number];
    readonly PublicKey_Deserialize: (a: number, b: number) => [number, number, number];
    readonly PublicKey_Equals: (a: number, b: number) => number;
    readonly PublicKey_GetPublicKeyBytes: (a: number) => [number, number];
    readonly PublicKey_Serialize: (a: number) => [number, number];
    readonly PublicKey_Verify: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly ScannableFingerprint_Compare: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly SealedSender_DecryptToUsmc: (a: number, b: number, c: any) => any;
    readonly SealedSender_Encrypt: (a: number, b: number, c: any) => [number, number, number];
    readonly SealedSender_MultiRecipientEncrypt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => [number, number, number];
    readonly SealedSender_MultiRecipientMessageForSingleRecipient: (a: number, b: number) => [number, number, number, number];
    readonly SenderCertificate_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SenderCertificate_GetDeviceId: (a: number) => [number, number, number];
    readonly SenderCertificate_GetExpiration: (a: number) => [number, number, number];
    readonly SenderCertificate_GetKey: (a: number) => [number, number, number];
    readonly SenderCertificate_GetSenderE164: (a: number) => [number, number, number, number];
    readonly SenderCertificate_GetSenderUuid: (a: number) => [number, number, number, number];
    readonly SenderCertificate_GetSerialized: (a: number) => [number, number, number, number];
    readonly SenderCertificate_GetServerCertificate: (a: number) => [number, number, number];
    readonly SenderCertificate_Validate: (a: number, b: number, c: number, d: number) => number;
    readonly SenderKeyDistributionMessage_Create: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly SenderKeyDistributionMessage_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SenderKeyDistributionMessage_GetChainId: (a: number) => [number, number, number];
    readonly SenderKeyDistributionMessage_GetChainKey: (a: number) => [number, number, number, number];
    readonly SenderKeyDistributionMessage_GetDistributionId: (a: number) => [number, number, number, number];
    readonly SenderKeyDistributionMessage_GetIteration: (a: number) => [number, number, number];
    readonly SenderKeyDistributionMessage_Process: (a: number, b: number, c: any) => any;
    readonly SenderKeyDistributionMessage_Serialize: (a: number) => [number, number];
    readonly SenderKeyMessage_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SenderKeyMessage_GetChainId: (a: number) => number;
    readonly SenderKeyMessage_GetCipherText: (a: number) => [number, number];
    readonly SenderKeyMessage_GetDistributionId: (a: number) => [number, number];
    readonly SenderKeyMessage_GetIteration: (a: number) => number;
    readonly SenderKeyMessage_Serialize: (a: number) => [number, number];
    readonly SenderKeyMessage_VerifySignature: (a: number, b: number) => [number, number, number];
    readonly SenderKeyRecord_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SenderKeyRecord_Serialize: (a: number) => [number, number, number, number];
    readonly ServerCertificate_Deserialize: (a: number, b: number) => [number, number, number];
    readonly ServerCertificate_GetKey: (a: number) => [number, number, number];
    readonly ServerCertificate_GetKeyId: (a: number) => [number, number, number];
    readonly ServerCertificate_GetSerialized: (a: number) => [number, number, number, number];
    readonly ServiceId_ParseFromServiceIdBinary: (a: number, b: number) => [number, number, number, number];
    readonly ServiceId_ParseFromServiceIdString: (a: number, b: number) => [number, number, number, number];
    readonly ServiceId_ServiceIdBinary: (a: number, b: number) => [number, number, number, number];
    readonly ServiceId_ServiceIdLog: (a: number, b: number) => [number, number, number, number];
    readonly ServiceId_ServiceIdString: (a: number, b: number) => [number, number, number, number];
    readonly SessionBuilder_ProcessPreKeyBundle: (a: number, b: number, c: number, d: any, e: any, f: number) => any;
    readonly SessionCipher_DecryptPreKeySignalMessage: (a: number, b: number, c: number, d: any, e: any, f: any, g: any, h: any) => any;
    readonly SessionCipher_DecryptSignalMessage: (a: number, b: number, c: number, d: any, e: any) => any;
    readonly SessionCipher_EncryptMessage: (a: number, b: number, c: number, d: number, e: any, f: any, g: number) => any;
    readonly SessionRecord_ArchiveCurrentState: (a: number) => [number, number];
    readonly SessionRecord_CurrentRatchetKeyMatches: (a: number, b: number) => [number, number, number];
    readonly SessionRecord_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SessionRecord_GetLocalRegistrationId: (a: number) => [number, number, number];
    readonly SessionRecord_GetRemoteRegistrationId: (a: number) => [number, number, number];
    readonly SessionRecord_HasUsableSenderChain: (a: number, b: number) => [number, number, number];
    readonly SessionRecord_Serialize: (a: number) => [number, number, number, number];
    readonly SignalMessage_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SignalMessage_GetBody: (a: number) => [number, number];
    readonly SignalMessage_GetCounter: (a: number) => number;
    readonly SignalMessage_GetMessageVersion: (a: number) => number;
    readonly SignalMessage_GetSerialized: (a: number) => [number, number];
    readonly SignedPreKeyRecord_Deserialize: (a: number, b: number) => [number, number, number];
    readonly SignedPreKeyRecord_GetId: (a: number) => [number, number, number];
    readonly SignedPreKeyRecord_GetPrivateKey: (a: number) => [number, number, number];
    readonly SignedPreKeyRecord_GetPublicKey: (a: number) => [number, number, number];
    readonly SignedPreKeyRecord_GetSignature: (a: number) => [number, number, number, number];
    readonly SignedPreKeyRecord_GetTimestamp: (a: number) => [number, number, number];
    readonly SignedPreKeyRecord_New: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly SignedPreKeyRecord_Serialize: (a: number) => [number, number, number, number];
    readonly UnidentifiedSenderMessageContent_Deserialize: (a: number, b: number) => [number, number, number];
    readonly UnidentifiedSenderMessageContent_GetContentHint: (a: number) => [number, number, number];
    readonly UnidentifiedSenderMessageContent_GetContents: (a: number) => [number, number, number, number];
    readonly UnidentifiedSenderMessageContent_GetGroupId: (a: number) => [number, number, number, number];
    readonly UnidentifiedSenderMessageContent_GetMsgType: (a: number) => [number, number, number];
    readonly UnidentifiedSenderMessageContent_GetSenderCert: (a: number) => [number, number, number];
    readonly UnidentifiedSenderMessageContent_New: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly UnidentifiedSenderMessageContent_Serialize: (a: number) => [number, number, number, number];
    readonly __wbg_ciphertextmessage_free: (a: number, b: number) => void;
    readonly __wbg_decryptionerrormessage_free: (a: number, b: number) => void;
    readonly __wbg_fingerprint_free: (a: number, b: number) => void;
    readonly __wbg_kyberkeypair_free: (a: number, b: number) => void;
    readonly __wbg_kyberprekeyrecord_free: (a: number, b: number) => void;
    readonly __wbg_kyberpublickey_free: (a: number, b: number) => void;
    readonly __wbg_prekeybundle_free: (a: number, b: number) => void;
    readonly __wbg_prekeyrecord_free: (a: number, b: number) => void;
    readonly __wbg_prekeysignalmessage_free: (a: number, b: number) => void;
    readonly __wbg_privatekey_free: (a: number, b: number) => void;
    readonly __wbg_protocoladdress_free: (a: number, b: number) => void;
    readonly __wbg_publickey_free: (a: number, b: number) => void;
    readonly __wbg_sendercertificate_free: (a: number, b: number) => void;
    readonly __wbg_senderkeydistributionmessage_free: (a: number, b: number) => void;
    readonly __wbg_senderkeymessage_free: (a: number, b: number) => void;
    readonly __wbg_senderkeyrecord_free: (a: number, b: number) => void;
    readonly __wbg_servercertificate_free: (a: number, b: number) => void;
    readonly __wbg_sessionrecord_free: (a: number, b: number) => void;
    readonly __wbg_signalmessage_free: (a: number, b: number) => void;
    readonly __wbg_tlsclient_free: (a: number, b: number) => void;
    readonly __wbg_unidentifiedsendermessagecontent_free: (a: number, b: number) => void;
    readonly decryptionerrormessage_cloneHandle: (a: number) => number;
    readonly fingerprint_cloneHandle: (a: number) => number;
    readonly kyberkeypair_cloneHandle: (a: number) => number;
    readonly kyberprekeyrecord_cloneHandle: (a: number) => number;
    readonly kyberpublickey_cloneHandle: (a: number) => number;
    readonly prekeybundle_cloneHandle: (a: number) => number;
    readonly prekeyrecord_cloneHandle: (a: number) => number;
    readonly prekeysignalmessage_cloneHandle: (a: number) => number;
    readonly privatekey_cloneHandle: (a: number) => number;
    readonly protocoladdress_cloneHandle: (a: number) => number;
    readonly sendercertificate_cloneHandle: (a: number) => number;
    readonly senderkeydistributionmessage_cloneHandle: (a: number) => number;
    readonly senderkeymessage_cloneHandle: (a: number) => number;
    readonly senderkeyrecord_cloneHandle: (a: number) => number;
    readonly servercertificate_cloneHandle: (a: number) => number;
    readonly sessionrecord_cloneHandle: (a: number) => number;
    readonly signalmessage_cloneHandle: (a: number) => number;
    readonly tlsclient_close: (a: number) => void;
    readonly tlsclient_isHandshaking: (a: number) => number;
    readonly tlsclient_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly tlsclient_receive: (a: number, b: number, c: number) => [number, number, number, number];
    readonly tlsclient_send: (a: number, b: number, c: number) => [number, number];
    readonly tlsclient_takeOutgoing: (a: number) => [number, number, number, number];
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbg_kybersecretkey_free: (a: number, b: number) => void;
    readonly __wbg_plaintextcontent_free: (a: number, b: number) => void;
    readonly __wbg_signedprekeyrecord_free: (a: number, b: number) => void;
    readonly kybersecretkey_cloneHandle: (a: number) => number;
    readonly KyberSecretKey_Serialize: (a: number) => [number, number];
    readonly plaintextcontent_cloneHandle: (a: number) => number;
    readonly publickey_cloneHandle: (a: number) => number;
    readonly signedprekeyrecord_cloneHandle: (a: number) => number;
    readonly wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___wasm_bindgen_97461482e016b7d2___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_97461482e016b7d2___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___js_sys_1462b0d19075b55d___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined___js_sys_1462b0d19075b55d___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
