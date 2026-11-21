/* @ts-self-types="./signal_wasm.d.ts" */

/**
 * @param {string} account_entropy
 * @returns {Uint8Array}
 */
export function AccountEntropyPool_DeriveSvrKey(account_entropy) {
    const ptr0 = passStringToWasm0(account_entropy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.AccountEntropyPool_DeriveSvrKey(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {string}
 */
export function AccountEntropyPool_Generate() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.AccountEntropyPool_Generate();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {Uint8Array} backup_key_bytes
 * @param {Uint8Array} aci_bytes
 * @returns {Uint8Array}
 */
export function BackupKey_DeriveBackupId(backup_key_bytes, aci_bytes) {
    const ptr0 = passArray8ToWasm0(backup_key_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(aci_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.BackupKey_DeriveBackupId(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} mrenclave
 * @param {Uint8Array} attestation_msg
 * @param {number} current_timestamp
 * @returns {SgxClientState}
 */
export function Cds2ClientState_New(mrenclave, attestation_msg, current_timestamp) {
    const ptr0 = passArray8ToWasm0(mrenclave, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(attestation_msg, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.Cds2ClientState_New(ptr0, len0, ptr1, len1, current_timestamp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SgxClientState.__wrap(ret[0]);
}

export class CiphertextMessage {
    static __wrap(ptr) {
        const obj = Object.create(CiphertextMessage.prototype);
        obj.__wbg_ptr = ptr;
        CiphertextMessageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CiphertextMessageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ciphertextmessage_free(ptr, 0);
    }
}
if (Symbol.dispose) CiphertextMessage.prototype[Symbol.dispose] = CiphertextMessage.prototype.free;

/**
 * @param {PlaintextContent} m
 * @returns {CiphertextMessage}
 */
export function CiphertextMessage_FromPlaintextContent(m) {
    _assertClass(m, PlaintextContent);
    const ret = wasm.CiphertextMessage_FromPlaintextContent(m.__wbg_ptr);
    return CiphertextMessage.__wrap(ret);
}

/**
 * @param {CiphertextMessage} obj
 * @returns {Uint8Array}
 */
export function CiphertextMessage_Serialize(obj) {
    _assertClass(obj, CiphertextMessage);
    const ret = wasm.CiphertextMessage_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {CiphertextMessage} msg
 * @returns {number}
 */
export function CiphertextMessage_Type(msg) {
    _assertClass(msg, CiphertextMessage);
    const ret = wasm.CiphertextMessage_Type(msg.__wbg_ptr);
    return ret;
}

export class DecryptionErrorMessage {
    static __wrap(ptr) {
        const obj = Object.create(DecryptionErrorMessage.prototype);
        obj.__wbg_ptr = ptr;
        DecryptionErrorMessageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DecryptionErrorMessageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_decryptionerrormessage_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {DecryptionErrorMessage}
     */
    cloneHandle() {
        const ret = wasm.decryptionerrormessage_cloneHandle(this.__wbg_ptr);
        return DecryptionErrorMessage.__wrap(ret);
    }
}
if (Symbol.dispose) DecryptionErrorMessage.prototype[Symbol.dispose] = DecryptionErrorMessage.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {DecryptionErrorMessage}
 */
export function DecryptionErrorMessage_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.DecryptionErrorMessage_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return DecryptionErrorMessage.__wrap(ret[0]);
}

/**
 * @param {Uint8Array} bytes
 * @returns {DecryptionErrorMessage}
 */
export function DecryptionErrorMessage_ExtractFromSerializedContent(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.DecryptionErrorMessage_ExtractFromSerializedContent(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return DecryptionErrorMessage.__wrap(ret[0]);
}

/**
 * @param {Uint8Array} original_bytes
 * @param {number} original_type
 * @param {number} original_timestamp
 * @param {number} original_sender_device_id
 * @returns {DecryptionErrorMessage}
 */
export function DecryptionErrorMessage_ForOriginalMessage(original_bytes, original_type, original_timestamp, original_sender_device_id) {
    const ptr0 = passArray8ToWasm0(original_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.DecryptionErrorMessage_ForOriginalMessage(ptr0, len0, original_type, original_timestamp, original_sender_device_id);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return DecryptionErrorMessage.__wrap(ret[0]);
}

/**
 * @param {DecryptionErrorMessage} obj
 * @returns {number}
 */
export function DecryptionErrorMessage_GetDeviceId(obj) {
    _assertClass(obj, DecryptionErrorMessage);
    const ret = wasm.DecryptionErrorMessage_GetDeviceId(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {DecryptionErrorMessage} m
 * @returns {PublicKey | undefined}
 */
export function DecryptionErrorMessage_GetRatchetKey(m) {
    _assertClass(m, DecryptionErrorMessage);
    const ret = wasm.DecryptionErrorMessage_GetRatchetKey(m.__wbg_ptr);
    return ret === 0 ? undefined : PublicKey.__wrap(ret);
}

/**
 * @param {DecryptionErrorMessage} obj
 * @returns {number}
 */
export function DecryptionErrorMessage_GetTimestamp(obj) {
    _assertClass(obj, DecryptionErrorMessage);
    const ret = wasm.DecryptionErrorMessage_GetTimestamp(obj.__wbg_ptr);
    return ret;
}

/**
 * @param {DecryptionErrorMessage} obj
 * @returns {Uint8Array}
 */
export function DecryptionErrorMessage_Serialize(obj) {
    _assertClass(obj, DecryptionErrorMessage);
    const ret = wasm.DecryptionErrorMessage_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Returns seconds since the epoch
 * @param {Uint8Array} credential
 * @returns {number}
 */
export function ExpiringProfileKeyCredential_GetExpirationTime(credential) {
    const ptr0 = passArray8ToWasm0(credential, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ExpiringProfileKeyCredential_GetExpirationTime(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

export class Fingerprint {
    static __wrap(ptr) {
        const obj = Object.create(Fingerprint.prototype);
        obj.__wbg_ptr = ptr;
        FingerprintFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FingerprintFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fingerprint_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {Fingerprint}
     */
    cloneHandle() {
        const ret = wasm.fingerprint_cloneHandle(this.__wbg_ptr);
        return Fingerprint.__wrap(ret);
    }
}
if (Symbol.dispose) Fingerprint.prototype[Symbol.dispose] = Fingerprint.prototype.free;

/**
 * @param {Fingerprint} obj
 * @returns {string}
 */
export function Fingerprint_DisplayString(obj) {
    let deferred2_0;
    let deferred2_1;
    try {
        _assertClass(obj, Fingerprint);
        const ret = wasm.Fingerprint_DisplayString(obj.__wbg_ptr);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {number} iterations
 * @param {number} version
 * @param {Uint8Array} local_identifier
 * @param {PublicKey} local_key
 * @param {Uint8Array} remote_identifier
 * @param {PublicKey} remote_key
 * @returns {Fingerprint}
 */
export function Fingerprint_New(iterations, version, local_identifier, local_key, remote_identifier, remote_key) {
    const ptr0 = passArray8ToWasm0(local_identifier, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(local_key, PublicKey);
    const ptr1 = passArray8ToWasm0(remote_identifier, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    _assertClass(remote_key, PublicKey);
    const ret = wasm.Fingerprint_New(iterations, version, ptr0, len0, local_key.__wbg_ptr, ptr1, len1, remote_key.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Fingerprint.__wrap(ret[0]);
}

/**
 * @param {Fingerprint} obj
 * @returns {Uint8Array}
 */
export function Fingerprint_ScannableEncoding(obj) {
    _assertClass(obj, Fingerprint);
    const ret = wasm.Fingerprint_ScannableEncoding(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {ProtocolAddress} sender
 * @param {Uint8Array} message
 * @param {any} store
 * @returns {Promise<any>}
 */
export function GroupCipher_DecryptMessage(sender, message, store) {
    _assertClass(sender, ProtocolAddress);
    const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupCipher_DecryptMessage(sender.__wbg_ptr, ptr0, len0, store);
    return ret;
}

/**
 * @param {ProtocolAddress} sender
 * @param {Uint8Array} distribution_id
 * @param {Uint8Array} message
 * @param {any} store
 * @returns {Promise<any>}
 */
export function GroupCipher_EncryptMessage(sender, distribution_id, message, store) {
    _assertClass(sender, ProtocolAddress);
    const ptr0 = passArray8ToWasm0(distribution_id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.GroupCipher_EncryptMessage(sender.__wbg_ptr, ptr0, len0, ptr1, len1, store);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Uint8Array} params
 * @returns {Uint8Array}
 */
export function GroupPublicParams_GetGroupIdentifier(params) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupPublicParams_GetGroupIdentifier(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} params
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array}
 */
export function GroupSecretParams_DecryptBlobWithPadding(params, ciphertext) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_DecryptBlobWithPadding(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} params
 * @param {Uint8Array} ciphertext
 * @param {Uint8Array} user_id
 * @returns {Uint8Array}
 */
export function GroupSecretParams_DecryptProfileKey(params, ciphertext, user_id) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(user_id, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_DecryptProfileKey(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Returns the fixed-width service ID binary
 * @param {Uint8Array} params
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array}
 */
export function GroupSecretParams_DecryptServiceId(params, ciphertext) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_DecryptServiceId(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} master_key
 * @returns {Uint8Array}
 */
export function GroupSecretParams_DeriveFromMasterKey(master_key) {
    const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_DeriveFromMasterKey(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} params
 * @param {Uint8Array} randomness_bytes
 * @param {Uint8Array} plaintext
 * @param {number} padding_len
 * @returns {Uint8Array}
 */
export function GroupSecretParams_EncryptBlobWithPaddingDeterministic(params, randomness_bytes, plaintext, padding_len) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(randomness_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_EncryptBlobWithPaddingDeterministic(ptr0, len0, ptr1, len1, ptr2, len2, padding_len);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * @param {Uint8Array} params
 * @param {Uint8Array} profile_key
 * @param {Uint8Array} user_id
 * @returns {Uint8Array}
 */
export function GroupSecretParams_EncryptProfileKey(params, profile_key, user_id) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(profile_key, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(user_id, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_EncryptProfileKey(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * @param {Uint8Array} params
 * @param {Uint8Array} service_id_bytes
 * @returns {Uint8Array}
 */
export function GroupSecretParams_EncryptServiceId(params, service_id_bytes) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(service_id_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_EncryptServiceId(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} randomness_bytes
 * @returns {Uint8Array}
 */
export function GroupSecretParams_GenerateDeterministic(randomness_bytes) {
    const ptr0 = passArray8ToWasm0(randomness_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_GenerateDeterministic(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} params
 * @returns {Uint8Array}
 */
export function GroupSecretParams_GetMasterKey(params) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_GetMasterKey(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} params
 * @returns {Uint8Array}
 */
export function GroupSecretParams_GetPublicParams(params) {
    const ptr0 = passArray8ToWasm0(params, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSecretParams_GetPublicParams(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array[]} endorsements
 * @returns {Uint8Array}
 */
export function GroupSendEndorsement_Combine(endorsements) {
    const ptr0 = passArrayJsValueToWasm0(endorsements, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSendEndorsement_Combine(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} endorsement
 * @param {Uint8Array} to_remove
 * @returns {Uint8Array}
 */
export function GroupSendEndorsement_Remove(endorsement, to_remove) {
    const ptr0 = passArray8ToWasm0(endorsement, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(to_remove, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSendEndorsement_Remove(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} endorsement
 * @param {Uint8Array} group_params
 * @returns {Uint8Array}
 */
export function GroupSendEndorsement_ToToken(endorsement, group_params) {
    const ptr0 = passArray8ToWasm0(endorsement, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(group_params, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSendEndorsement_ToToken(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Returns seconds since the epoch
 * @param {Uint8Array} response
 * @returns {number}
 */
export function GroupSendEndorsementsResponse_GetExpiration(response) {
    const ptr0 = passArray8ToWasm0(response, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSendEndorsementsResponse_GetExpiration(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * Verifies the endorsements of `group_members` (concatenated service IDs that include `local_user`) at
 * `now` in seconds. Returns each member's endorsement in the order of `group_members`, then the combined
 * endorsement of everyone but `local_user`.
 * @param {Uint8Array} response
 * @param {Uint8Array} group_members
 * @param {Uint8Array} local_user
 * @param {number} now
 * @param {Uint8Array} group_params
 * @param {ServerPublicParams} server_params
 * @returns {Uint8Array[]}
 */
export function GroupSendEndorsementsResponse_ReceiveAndCombineWithServiceIds(response, group_members, local_user, now, group_params, server_params) {
    const ptr0 = passArray8ToWasm0(response, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(group_members, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(local_user, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(group_params, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    _assertClass(server_params, ServerPublicParams);
    const ret = wasm.GroupSendEndorsementsResponse_ReceiveAndCombineWithServiceIds(ptr0, len0, ptr1, len1, ptr2, len2, now, ptr3, len3, server_params.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v5;
}

/**
 * `expiration` is in seconds
 * @param {Uint8Array} token
 * @param {number} expiration
 * @returns {Uint8Array}
 */
export function GroupSendToken_ToFullToken(token, expiration) {
    const ptr0 = passArray8ToWasm0(token, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.GroupSendToken_ToFullToken(ptr0, len0, expiration);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {number} output_length
 * @param {Uint8Array} ikm
 * @param {Uint8Array | null} [label]
 * @param {Uint8Array | null} [salt]
 * @returns {Uint8Array}
 */
export function HKDF_DeriveSecrets(output_length, ikm, label, salt) {
    const ptr0 = passArray8ToWasm0(ikm, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(label) ? 0 : passArray8ToWasm0(label, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(salt) ? 0 : passArray8ToWasm0(salt, wasm.__wbindgen_malloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.HKDF_DeriveSecrets(output_length, ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * @param {Uint8Array} input
 * @returns {Array<any>}
 */
export function IdentityKeyPair_Deserialize(input) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.IdentityKeyPair_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {PublicKey} public_key
 * @param {PrivateKey} private_key
 * @returns {Uint8Array}
 */
export function IdentityKeyPair_Serialize(public_key, private_key) {
    _assertClass(public_key, PublicKey);
    _assertClass(private_key, PrivateKey);
    const ret = wasm.IdentityKeyPair_Serialize(public_key.__wbg_ptr, private_key.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {PublicKey} public_key
 * @param {PrivateKey} private_key
 * @param {PublicKey} other_identity
 * @returns {Uint8Array}
 */
export function IdentityKeyPair_SignAlternateIdentity(public_key, private_key, other_identity) {
    _assertClass(public_key, PublicKey);
    _assertClass(private_key, PrivateKey);
    _assertClass(other_identity, PublicKey);
    const ret = wasm.IdentityKeyPair_SignAlternateIdentity(public_key.__wbg_ptr, private_key.__wbg_ptr, other_identity.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class KyberKeyPair {
    static __wrap(ptr) {
        const obj = Object.create(KyberKeyPair.prototype);
        obj.__wbg_ptr = ptr;
        KyberKeyPairFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KyberKeyPairFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kyberkeypair_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {KyberKeyPair}
     */
    cloneHandle() {
        const ret = wasm.kyberkeypair_cloneHandle(this.__wbg_ptr);
        return KyberKeyPair.__wrap(ret);
    }
}
if (Symbol.dispose) KyberKeyPair.prototype[Symbol.dispose] = KyberKeyPair.prototype.free;

/**
 * @returns {KyberKeyPair}
 */
export function KyberKeyPair_Generate() {
    const ret = wasm.KyberKeyPair_Generate();
    return KyberKeyPair.__wrap(ret);
}

/**
 * @param {KyberKeyPair} key_pair
 * @returns {KyberPublicKey}
 */
export function KyberKeyPair_GetPublicKey(key_pair) {
    _assertClass(key_pair, KyberKeyPair);
    const ret = wasm.KyberKeyPair_GetPublicKey(key_pair.__wbg_ptr);
    return KyberPublicKey.__wrap(ret);
}

/**
 * @param {KyberKeyPair} key_pair
 * @returns {KyberSecretKey}
 */
export function KyberKeyPair_GetSecretKey(key_pair) {
    _assertClass(key_pair, KyberKeyPair);
    const ret = wasm.KyberKeyPair_GetSecretKey(key_pair.__wbg_ptr);
    return KyberSecretKey.__wrap(ret);
}

export class KyberPreKeyRecord {
    static __wrap(ptr) {
        const obj = Object.create(KyberPreKeyRecord.prototype);
        obj.__wbg_ptr = ptr;
        KyberPreKeyRecordFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KyberPreKeyRecordFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kyberprekeyrecord_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {KyberPreKeyRecord}
     */
    cloneHandle() {
        const ret = wasm.kyberprekeyrecord_cloneHandle(this.__wbg_ptr);
        return KyberPreKeyRecord.__wrap(ret);
    }
}
if (Symbol.dispose) KyberPreKeyRecord.prototype[Symbol.dispose] = KyberPreKeyRecord.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {KyberPreKeyRecord}
 */
export function KyberPreKeyRecord_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.KyberPreKeyRecord_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KyberPreKeyRecord.__wrap(ret[0]);
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {number}
 */
export function KyberPreKeyRecord_GetId(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_GetId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {KyberKeyPair}
 */
export function KyberPreKeyRecord_GetKeyPair(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_GetKeyPair(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KyberKeyPair.__wrap(ret[0]);
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {KyberPublicKey}
 */
export function KyberPreKeyRecord_GetPublicKey(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_GetPublicKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KyberPublicKey.__wrap(ret[0]);
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {KyberSecretKey}
 */
export function KyberPreKeyRecord_GetSecretKey(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_GetSecretKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KyberSecretKey.__wrap(ret[0]);
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {Uint8Array}
 */
export function KyberPreKeyRecord_GetSignature(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_GetSignature(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {number}
 */
export function KyberPreKeyRecord_GetTimestamp(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_GetTimestamp(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} id
 * @param {number} timestamp_millis
 * @param {KyberKeyPair} key_pair
 * @param {Uint8Array} signature
 * @returns {KyberPreKeyRecord}
 */
export function KyberPreKeyRecord_New(id, timestamp_millis, key_pair, signature) {
    _assertClass(key_pair, KyberKeyPair);
    const ptr0 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.KyberPreKeyRecord_New(id, timestamp_millis, key_pair.__wbg_ptr, ptr0, len0);
    return KyberPreKeyRecord.__wrap(ret);
}

/**
 * @param {KyberPreKeyRecord} obj
 * @returns {Uint8Array}
 */
export function KyberPreKeyRecord_Serialize(obj) {
    _assertClass(obj, KyberPreKeyRecord);
    const ret = wasm.KyberPreKeyRecord_Serialize(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class KyberPublicKey {
    static __wrap(ptr) {
        const obj = Object.create(KyberPublicKey.prototype);
        obj.__wbg_ptr = ptr;
        KyberPublicKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KyberPublicKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kyberpublickey_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {KyberPublicKey}
     */
    cloneHandle() {
        const ret = wasm.kyberpublickey_cloneHandle(this.__wbg_ptr);
        return KyberPublicKey.__wrap(ret);
    }
}
if (Symbol.dispose) KyberPublicKey.prototype[Symbol.dispose] = KyberPublicKey.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {KyberPublicKey}
 */
export function KyberPublicKey_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.KyberPublicKey_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KyberPublicKey.__wrap(ret[0]);
}

/**
 * @param {KyberPublicKey} lhs
 * @param {KyberPublicKey} rhs
 * @returns {boolean}
 */
export function KyberPublicKey_Equals(lhs, rhs) {
    _assertClass(lhs, KyberPublicKey);
    _assertClass(rhs, KyberPublicKey);
    const ret = wasm.KyberPublicKey_Equals(lhs.__wbg_ptr, rhs.__wbg_ptr);
    return ret !== 0;
}

/**
 * @param {KyberPublicKey} obj
 * @returns {Uint8Array}
 */
export function KyberPublicKey_Serialize(obj) {
    _assertClass(obj, KyberPublicKey);
    const ret = wasm.KyberPublicKey_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class KyberSecretKey {
    static __wrap(ptr) {
        const obj = Object.create(KyberSecretKey.prototype);
        obj.__wbg_ptr = ptr;
        KyberSecretKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KyberSecretKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kybersecretkey_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {KyberSecretKey}
     */
    cloneHandle() {
        const ret = wasm.kybersecretkey_cloneHandle(this.__wbg_ptr);
        return KyberSecretKey.__wrap(ret);
    }
}
if (Symbol.dispose) KyberSecretKey.prototype[Symbol.dispose] = KyberSecretKey.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {KyberSecretKey}
 */
export function KyberSecretKey_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.KyberSecretKey_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return KyberSecretKey.__wrap(ret[0]);
}

/**
 * @param {KyberSecretKey} obj
 * @returns {Uint8Array}
 */
export function KyberSecretKey_Serialize(obj) {
    _assertClass(obj, KyberSecretKey);
    const ret = wasm.KyberSecretKey_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class MessageBackupKey {
    static __wrap(ptr) {
        const obj = Object.create(MessageBackupKey.prototype);
        obj.__wbg_ptr = ptr;
        MessageBackupKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MessageBackupKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_messagebackupkey_free(ptr, 0);
    }
}
if (Symbol.dispose) MessageBackupKey.prototype[Symbol.dispose] = MessageBackupKey.prototype.free;

/**
 * @param {Uint8Array} backup_key_bytes
 * @param {Uint8Array} backup_id
 * @param {Uint8Array | null} [forward_secrecy_token]
 * @returns {MessageBackupKey}
 */
export function MessageBackupKey_FromBackupKeyAndBackupId(backup_key_bytes, backup_id, forward_secrecy_token) {
    const ptr0 = passArray8ToWasm0(backup_key_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(backup_id, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(forward_secrecy_token) ? 0 : passArray8ToWasm0(forward_secrecy_token, wasm.__wbindgen_malloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.MessageBackupKey_FromBackupKeyAndBackupId(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return MessageBackupKey.__wrap(ret[0]);
}

/**
 * @param {MessageBackupKey} key
 * @returns {Uint8Array}
 */
export function MessageBackupKey_GetAesKey(key) {
    _assertClass(key, MessageBackupKey);
    const ret = wasm.MessageBackupKey_GetAesKey(key.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {MessageBackupKey} key
 * @returns {Uint8Array}
 */
export function MessageBackupKey_GetHmacKey(key) {
    _assertClass(key, MessageBackupKey);
    const ret = wasm.MessageBackupKey_GetHmacKey(key.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class PinHash {
    static __wrap(ptr) {
        const obj = Object.create(PinHash.prototype);
        obj.__wbg_ptr = ptr;
        PinHashFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PinHashFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pinhash_free(ptr, 0);
    }
}
if (Symbol.dispose) PinHash.prototype[Symbol.dispose] = PinHash.prototype.free;

/**
 * @param {PinHash} ph
 * @returns {Uint8Array}
 */
export function PinHash_AccessKey(ph) {
    _assertClass(ph, PinHash);
    const ret = wasm.PinHash_AccessKey(ph.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Decrypts the master key that SVR2 restored, as libsignal-net `Svr2_RestoreMasterKey` does
 * @param {PinHash} ph
 * @param {Uint8Array} encoded
 * @returns {Uint8Array}
 */
export function PinHash_DecodeMasterKey(ph, encoded) {
    _assertClass(ph, PinHash);
    const ptr0 = passArray8ToWasm0(encoded, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PinHash_DecodeMasterKey(ph.__wbg_ptr, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Encrypts the master key for SVR2 storage as libsignal-net `Svr2_StartMasterKeyBackup` does
 * @param {PinHash} ph
 * @param {Uint8Array} master_key
 * @returns {Uint8Array}
 */
export function PinHash_EncodeMasterKey(ph, master_key) {
    _assertClass(ph, PinHash);
    const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PinHash_EncodeMasterKey(ph.__wbg_ptr, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Hashes a normalized PIN with the salt of the SVR2 enclave's group and the SVR2 username
 * @param {Uint8Array} pin
 * @param {string} username
 * @param {Uint8Array} mrenclave
 * @returns {PinHash}
 */
export function PinHash_FromUsernameMrenclave(pin, username, mrenclave) {
    const ptr0 = passArray8ToWasm0(pin, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(username, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(mrenclave, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.PinHash_FromUsernameMrenclave(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PinHash.__wrap(ret[0]);
}

export class PlaintextContent {
    static __wrap(ptr) {
        const obj = Object.create(PlaintextContent.prototype);
        obj.__wbg_ptr = ptr;
        PlaintextContentFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PlaintextContentFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_plaintextcontent_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {PlaintextContent}
     */
    cloneHandle() {
        const ret = wasm.plaintextcontent_cloneHandle(this.__wbg_ptr);
        return PlaintextContent.__wrap(ret);
    }
}
if (Symbol.dispose) PlaintextContent.prototype[Symbol.dispose] = PlaintextContent.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {PlaintextContent}
 */
export function PlaintextContent_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PlaintextContent_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PlaintextContent.__wrap(ret[0]);
}

/**
 * @param {DecryptionErrorMessage} m
 * @returns {PlaintextContent}
 */
export function PlaintextContent_FromDecryptionErrorMessage(m) {
    _assertClass(m, DecryptionErrorMessage);
    const ret = wasm.PlaintextContent_FromDecryptionErrorMessage(m.__wbg_ptr);
    return PlaintextContent.__wrap(ret);
}

/**
 * @param {PlaintextContent} obj
 * @returns {Uint8Array}
 */
export function PlaintextContent_GetBody(obj) {
    _assertClass(obj, PlaintextContent);
    const ret = wasm.PlaintextContent_GetBody(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {PlaintextContent} obj
 * @returns {Uint8Array}
 */
export function PlaintextContent_Serialize(obj) {
    _assertClass(obj, PlaintextContent);
    const ret = wasm.PlaintextContent_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class PreKeyBundle {
    static __wrap(ptr) {
        const obj = Object.create(PreKeyBundle.prototype);
        obj.__wbg_ptr = ptr;
        PreKeyBundleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PreKeyBundleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_prekeybundle_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {PreKeyBundle}
     */
    cloneHandle() {
        const ret = wasm.prekeybundle_cloneHandle(this.__wbg_ptr);
        return PreKeyBundle.__wrap(ret);
    }
}
if (Symbol.dispose) PreKeyBundle.prototype[Symbol.dispose] = PreKeyBundle.prototype.free;

/**
 * @param {PreKeyBundle} obj
 * @returns {number}
 */
export function PreKeyBundle_GetDeviceId(obj) {
    _assertClass(obj, PreKeyBundle);
    const ret = wasm.PreKeyBundle_GetDeviceId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {PreKeyBundle} obj
 * @returns {PublicKey}
 */
export function PreKeyBundle_GetIdentityKey(obj) {
    _assertClass(obj, PreKeyBundle);
    const ret = wasm.PreKeyBundle_GetIdentityKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {PreKeyBundle} obj
 * @returns {number}
 */
export function PreKeyBundle_GetRegistrationId(obj) {
    _assertClass(obj, PreKeyBundle);
    const ret = wasm.PreKeyBundle_GetRegistrationId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} registration_id
 * @param {number} device_id
 * @param {number | null | undefined} prekey_id
 * @param {PublicKey | null | undefined} prekey
 * @param {number} signed_prekey_id
 * @param {PublicKey} signed_prekey
 * @param {Uint8Array} signed_prekey_signature
 * @param {PublicKey} identity_key
 * @param {number} kyber_prekey_id
 * @param {KyberPublicKey} kyber_prekey
 * @param {Uint8Array} kyber_prekey_signature
 * @returns {PreKeyBundle}
 */
export function PreKeyBundle_New(registration_id, device_id, prekey_id, prekey, signed_prekey_id, signed_prekey, signed_prekey_signature, identity_key, kyber_prekey_id, kyber_prekey, kyber_prekey_signature) {
    let ptr0 = 0;
    if (!isLikeNone(prekey)) {
        _assertClass(prekey, PublicKey);
        ptr0 = prekey.__destroy_into_raw();
    }
    _assertClass(signed_prekey, PublicKey);
    const ptr1 = passArray8ToWasm0(signed_prekey_signature, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    _assertClass(identity_key, PublicKey);
    _assertClass(kyber_prekey, KyberPublicKey);
    const ptr2 = passArray8ToWasm0(kyber_prekey_signature, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.PreKeyBundle_New(registration_id, device_id, isLikeNone(prekey_id) ? Number.MAX_SAFE_INTEGER : (prekey_id) >>> 0, ptr0, signed_prekey_id, signed_prekey.__wbg_ptr, ptr1, len1, identity_key.__wbg_ptr, kyber_prekey_id, kyber_prekey.__wbg_ptr, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PreKeyBundle.__wrap(ret[0]);
}

export class PreKeyRecord {
    static __wrap(ptr) {
        const obj = Object.create(PreKeyRecord.prototype);
        obj.__wbg_ptr = ptr;
        PreKeyRecordFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PreKeyRecordFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_prekeyrecord_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {PreKeyRecord}
     */
    cloneHandle() {
        const ret = wasm.prekeyrecord_cloneHandle(this.__wbg_ptr);
        return PreKeyRecord.__wrap(ret);
    }
}
if (Symbol.dispose) PreKeyRecord.prototype[Symbol.dispose] = PreKeyRecord.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {PreKeyRecord}
 */
export function PreKeyRecord_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PreKeyRecord_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PreKeyRecord.__wrap(ret[0]);
}

/**
 * @param {PreKeyRecord} obj
 * @returns {number}
 */
export function PreKeyRecord_GetId(obj) {
    _assertClass(obj, PreKeyRecord);
    const ret = wasm.PreKeyRecord_GetId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {PreKeyRecord} obj
 * @returns {PrivateKey}
 */
export function PreKeyRecord_GetPrivateKey(obj) {
    _assertClass(obj, PreKeyRecord);
    const ret = wasm.PreKeyRecord_GetPrivateKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PrivateKey.__wrap(ret[0]);
}

/**
 * @param {PreKeyRecord} obj
 * @returns {PublicKey}
 */
export function PreKeyRecord_GetPublicKey(obj) {
    _assertClass(obj, PreKeyRecord);
    const ret = wasm.PreKeyRecord_GetPublicKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {number} id
 * @param {PublicKey} pub_key
 * @param {PrivateKey} priv_key
 * @returns {PreKeyRecord}
 */
export function PreKeyRecord_New(id, pub_key, priv_key) {
    _assertClass(pub_key, PublicKey);
    _assertClass(priv_key, PrivateKey);
    const ret = wasm.PreKeyRecord_New(id, pub_key.__wbg_ptr, priv_key.__wbg_ptr);
    return PreKeyRecord.__wrap(ret);
}

/**
 * @param {PreKeyRecord} obj
 * @returns {Uint8Array}
 */
export function PreKeyRecord_Serialize(obj) {
    _assertClass(obj, PreKeyRecord);
    const ret = wasm.PreKeyRecord_Serialize(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class PreKeySignalMessage {
    static __wrap(ptr) {
        const obj = Object.create(PreKeySignalMessage.prototype);
        obj.__wbg_ptr = ptr;
        PreKeySignalMessageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PreKeySignalMessageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_prekeysignalmessage_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {PreKeySignalMessage}
     */
    cloneHandle() {
        const ret = wasm.prekeysignalmessage_cloneHandle(this.__wbg_ptr);
        return PreKeySignalMessage.__wrap(ret);
    }
}
if (Symbol.dispose) PreKeySignalMessage.prototype[Symbol.dispose] = PreKeySignalMessage.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {PreKeySignalMessage}
 */
export function PreKeySignalMessage_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PreKeySignalMessage_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PreKeySignalMessage.__wrap(ret[0]);
}

/**
 * @param {PreKeySignalMessage} obj
 * @returns {number | undefined}
 */
export function PreKeySignalMessage_GetPreKeyId(obj) {
    _assertClass(obj, PreKeySignalMessage);
    const ret = wasm.PreKeySignalMessage_GetPreKeyId(obj.__wbg_ptr);
    return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
}

/**
 * @param {PreKeySignalMessage} obj
 * @returns {number}
 */
export function PreKeySignalMessage_GetRegistrationId(obj) {
    _assertClass(obj, PreKeySignalMessage);
    const ret = wasm.PreKeySignalMessage_GetRegistrationId(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {PreKeySignalMessage} obj
 * @returns {number}
 */
export function PreKeySignalMessage_GetSignedPreKeyId(obj) {
    _assertClass(obj, PreKeySignalMessage);
    const ret = wasm.PreKeySignalMessage_GetSignedPreKeyId(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {PreKeySignalMessage} obj
 * @returns {number}
 */
export function PreKeySignalMessage_GetVersion(obj) {
    _assertClass(obj, PreKeySignalMessage);
    const ret = wasm.PreKeySignalMessage_GetVersion(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {PreKeySignalMessage} obj
 * @returns {Uint8Array}
 */
export function PreKeySignalMessage_Serialize(obj) {
    _assertClass(obj, PreKeySignalMessage);
    const ret = wasm.PreKeySignalMessage_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class PrivateKey {
    static __wrap(ptr) {
        const obj = Object.create(PrivateKey.prototype);
        obj.__wbg_ptr = ptr;
        PrivateKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PrivateKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_privatekey_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {PrivateKey}
     */
    cloneHandle() {
        const ret = wasm.privatekey_cloneHandle(this.__wbg_ptr);
        return PrivateKey.__wrap(ret);
    }
}
if (Symbol.dispose) PrivateKey.prototype[Symbol.dispose] = PrivateKey.prototype.free;

/**
 * @param {PrivateKey} private_key
 * @param {PublicKey} public_key
 * @returns {Uint8Array}
 */
export function PrivateKey_Agree(private_key, public_key) {
    _assertClass(private_key, PrivateKey);
    _assertClass(public_key, PublicKey);
    const ret = wasm.PrivateKey_Agree(private_key.__wbg_ptr, public_key.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {Uint8Array} data
 * @returns {PrivateKey}
 */
export function PrivateKey_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PrivateKey_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PrivateKey.__wrap(ret[0]);
}

/**
 * @returns {PrivateKey}
 */
export function PrivateKey_Generate() {
    const ret = wasm.PrivateKey_Generate();
    return PrivateKey.__wrap(ret);
}

/**
 * @param {PrivateKey} key
 * @returns {PublicKey}
 */
export function PrivateKey_GetPublicKey(key) {
    _assertClass(key, PrivateKey);
    const ret = wasm.PrivateKey_GetPublicKey(key.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {PrivateKey} obj
 * @returns {Uint8Array}
 */
export function PrivateKey_Serialize(obj) {
    _assertClass(obj, PrivateKey);
    const ret = wasm.PrivateKey_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {PrivateKey} key
 * @param {Uint8Array} message
 * @returns {Uint8Array}
 */
export function PrivateKey_Sign(key, message) {
    _assertClass(key, PrivateKey);
    const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PrivateKey_Sign(key.__wbg_ptr, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} context
 * @returns {Uint8Array}
 */
export function ProfileKeyCredentialRequestContext_GetRequest(context) {
    const ptr0 = passArray8ToWasm0(context, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ProfileKeyCredentialRequestContext_GetRequest(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} profile_key
 * @returns {Uint8Array}
 */
export function ProfileKey_DeriveAccessKey(profile_key) {
    const ptr0 = passArray8ToWasm0(profile_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ProfileKey_DeriveAccessKey(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} profile_key
 * @param {Uint8Array} user_id
 * @returns {Uint8Array}
 */
export function ProfileKey_GetCommitment(profile_key, user_id) {
    const ptr0 = passArray8ToWasm0(profile_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(user_id, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ProfileKey_GetCommitment(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Returns the version as ASCII hex, the form used in `GET /v1/profile/{aci}/{version}`
 * @param {Uint8Array} profile_key
 * @param {Uint8Array} user_id
 * @returns {Uint8Array}
 */
export function ProfileKey_GetProfileKeyVersion(profile_key, user_id) {
    const ptr0 = passArray8ToWasm0(profile_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(user_id, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ProfileKey_GetProfileKeyVersion(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

export class ProtocolAddress {
    static __wrap(ptr) {
        const obj = Object.create(ProtocolAddress.prototype);
        obj.__wbg_ptr = ptr;
        ProtocolAddressFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof ProtocolAddress)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProtocolAddressFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_protocoladdress_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {ProtocolAddress}
     */
    cloneHandle() {
        const ret = wasm.protocoladdress_cloneHandle(this.__wbg_ptr);
        return ProtocolAddress.__wrap(ret);
    }
}
if (Symbol.dispose) ProtocolAddress.prototype[Symbol.dispose] = ProtocolAddress.prototype.free;

/**
 * @param {ProtocolAddress} obj
 * @returns {number}
 */
export function ProtocolAddress_DeviceId(obj) {
    _assertClass(obj, ProtocolAddress);
    const ret = wasm.ProtocolAddress_DeviceId(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {ProtocolAddress} obj
 * @returns {string}
 */
export function ProtocolAddress_Name(obj) {
    let deferred1_0;
    let deferred1_1;
    try {
        _assertClass(obj, ProtocolAddress);
        const ret = wasm.ProtocolAddress_Name(obj.__wbg_ptr);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {string} name
 * @param {number} device_id
 * @returns {ProtocolAddress}
 */
export function ProtocolAddress_New(name, device_id) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ProtocolAddress_New(ptr0, len0, device_id);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ProtocolAddress.__wrap(ret[0]);
}

export class PublicKey {
    static __wrap(ptr) {
        const obj = Object.create(PublicKey.prototype);
        obj.__wbg_ptr = ptr;
        PublicKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof PublicKey)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PublicKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_publickey_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {PublicKey}
     */
    cloneHandle() {
        const ret = wasm.publickey_cloneHandle(this.__wbg_ptr);
        return PublicKey.__wrap(ret);
    }
}
if (Symbol.dispose) PublicKey.prototype[Symbol.dispose] = PublicKey.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {PublicKey}
 */
export function PublicKey_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.PublicKey_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {PublicKey} lhs
 * @param {PublicKey} rhs
 * @returns {boolean}
 */
export function PublicKey_Equals(lhs, rhs) {
    _assertClass(lhs, PublicKey);
    _assertClass(rhs, PublicKey);
    const ret = wasm.PublicKey_Equals(lhs.__wbg_ptr, rhs.__wbg_ptr);
    return ret !== 0;
}

/**
 * @param {PublicKey} obj
 * @returns {Uint8Array}
 */
export function PublicKey_GetPublicKeyBytes(obj) {
    _assertClass(obj, PublicKey);
    const ret = wasm.PublicKey_GetPublicKeyBytes(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {PublicKey} obj
 * @returns {Uint8Array}
 */
export function PublicKey_Serialize(obj) {
    _assertClass(obj, PublicKey);
    const ret = wasm.PublicKey_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {PublicKey} key
 * @param {Uint8Array} message
 * @param {Uint8Array} signature
 * @returns {boolean}
 */
export function PublicKey_Verify(key, message, signature) {
    _assertClass(key, PublicKey);
    const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.PublicKey_Verify(key.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * @param {Uint8Array} fprint1
 * @param {Uint8Array} fprint2
 * @returns {boolean}
 */
export function ScannableFingerprint_Compare(fprint1, fprint2) {
    const ptr0 = passArray8ToWasm0(fprint1, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(fprint2, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ScannableFingerprint_Compare(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {Uint8Array} ctext
 * @param {any} identity_store
 * @returns {Promise<any>}
 */
export function SealedSender_DecryptToUsmc(ctext, identity_store) {
    const ptr0 = passArray8ToWasm0(ctext, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SealedSender_DecryptToUsmc(ptr0, len0, identity_store);
    return ret;
}

/**
 * @param {ProtocolAddress} destination
 * @param {UnidentifiedSenderMessageContent} content
 * @param {any} identity_key_store
 * @returns {Promise<any>}
 */
export function SealedSender_Encrypt(destination, content, identity_key_store) {
    _assertClass(destination, ProtocolAddress);
    _assertClass(content, UnidentifiedSenderMessageContent);
    const ret = wasm.SealedSender_Encrypt(destination.__wbg_ptr, content.__wbg_ptr, identity_key_store);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `excluded_recipients` is a concatenation of fixed-width service IDs.
 * @param {ProtocolAddress[]} recipients
 * @param {SessionRecord[]} recipient_sessions
 * @param {Uint8Array} excluded_recipients
 * @param {UnidentifiedSenderMessageContent} content
 * @param {any} identity_key_store
 * @returns {Promise<any>}
 */
export function SealedSender_MultiRecipientEncrypt(recipients, recipient_sessions, excluded_recipients, content, identity_key_store) {
    const ptr0 = passArrayJsValueToWasm0(recipients, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(recipient_sessions, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(excluded_recipients, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    _assertClass(content, UnidentifiedSenderMessageContent);
    const ret = wasm.SealedSender_MultiRecipientEncrypt(ptr0, len0, ptr1, len1, ptr2, len2, content.__wbg_ptr, identity_key_store);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Extracts the only recipient's message from a multi-recipient sealed sender payload
 * @param {Uint8Array} encoded
 * @returns {Uint8Array}
 */
export function SealedSender_MultiRecipientMessageForSingleRecipient(encoded) {
    const ptr0 = passArray8ToWasm0(encoded, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SealedSender_MultiRecipientMessageForSingleRecipient(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

export class SenderCertificate {
    static __wrap(ptr) {
        const obj = Object.create(SenderCertificate.prototype);
        obj.__wbg_ptr = ptr;
        SenderCertificateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SenderCertificateFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sendercertificate_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SenderCertificate}
     */
    cloneHandle() {
        const ret = wasm.sendercertificate_cloneHandle(this.__wbg_ptr);
        return SenderCertificate.__wrap(ret);
    }
}
if (Symbol.dispose) SenderCertificate.prototype[Symbol.dispose] = SenderCertificate.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {SenderCertificate}
 */
export function SenderCertificate_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SenderCertificate_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SenderCertificate.__wrap(ret[0]);
}

/**
 * @param {SenderCertificate} obj
 * @returns {number}
 */
export function SenderCertificate_GetDeviceId(obj) {
    _assertClass(obj, SenderCertificate);
    const ret = wasm.SenderCertificate_GetDeviceId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {SenderCertificate} obj
 * @returns {number}
 */
export function SenderCertificate_GetExpiration(obj) {
    _assertClass(obj, SenderCertificate);
    const ret = wasm.SenderCertificate_GetExpiration(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {SenderCertificate} obj
 * @returns {PublicKey}
 */
export function SenderCertificate_GetKey(obj) {
    _assertClass(obj, SenderCertificate);
    const ret = wasm.SenderCertificate_GetKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {SenderCertificate} obj
 * @returns {string | undefined}
 */
export function SenderCertificate_GetSenderE164(obj) {
    _assertClass(obj, SenderCertificate);
    const ret = wasm.SenderCertificate_GetSenderE164(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * @param {SenderCertificate} obj
 * @returns {string}
 */
export function SenderCertificate_GetSenderUuid(obj) {
    let deferred2_0;
    let deferred2_1;
    try {
        _assertClass(obj, SenderCertificate);
        const ret = wasm.SenderCertificate_GetSenderUuid(obj.__wbg_ptr);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {SenderCertificate} obj
 * @returns {Uint8Array}
 */
export function SenderCertificate_GetSerialized(obj) {
    _assertClass(obj, SenderCertificate);
    const ret = wasm.SenderCertificate_GetSerialized(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SenderCertificate} cert
 * @returns {ServerCertificate}
 */
export function SenderCertificate_GetServerCertificate(cert) {
    _assertClass(cert, SenderCertificate);
    const ret = wasm.SenderCertificate_GetServerCertificate(cert.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ServerCertificate.__wrap(ret[0]);
}

/**
 * `trust_roots` is an array of `PublicKey` handles.
 * @param {SenderCertificate} cert
 * @param {PublicKey[]} trust_roots
 * @param {number} time
 * @returns {boolean}
 */
export function SenderCertificate_Validate(cert, trust_roots, time) {
    _assertClass(cert, SenderCertificate);
    const ptr0 = passArrayJsValueToWasm0(trust_roots, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SenderCertificate_Validate(cert.__wbg_ptr, ptr0, len0, time);
    return ret !== 0;
}

export class SenderKeyDistributionMessage {
    static __wrap(ptr) {
        const obj = Object.create(SenderKeyDistributionMessage.prototype);
        obj.__wbg_ptr = ptr;
        SenderKeyDistributionMessageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SenderKeyDistributionMessageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_senderkeydistributionmessage_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SenderKeyDistributionMessage}
     */
    cloneHandle() {
        const ret = wasm.senderkeydistributionmessage_cloneHandle(this.__wbg_ptr);
        return SenderKeyDistributionMessage.__wrap(ret);
    }
}
if (Symbol.dispose) SenderKeyDistributionMessage.prototype[Symbol.dispose] = SenderKeyDistributionMessage.prototype.free;

/**
 * @param {ProtocolAddress} sender
 * @param {Uint8Array} distribution_id
 * @param {any} store
 * @returns {Promise<any>}
 */
export function SenderKeyDistributionMessage_Create(sender, distribution_id, store) {
    _assertClass(sender, ProtocolAddress);
    const ptr0 = passArray8ToWasm0(distribution_id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SenderKeyDistributionMessage_Create(sender.__wbg_ptr, ptr0, len0, store);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Uint8Array} data
 * @returns {SenderKeyDistributionMessage}
 */
export function SenderKeyDistributionMessage_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SenderKeyDistributionMessage_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SenderKeyDistributionMessage.__wrap(ret[0]);
}

/**
 * @param {SenderKeyDistributionMessage} obj
 * @returns {number}
 */
export function SenderKeyDistributionMessage_GetChainId(obj) {
    _assertClass(obj, SenderKeyDistributionMessage);
    const ret = wasm.SenderKeyDistributionMessage_GetChainId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {SenderKeyDistributionMessage} obj
 * @returns {Uint8Array}
 */
export function SenderKeyDistributionMessage_GetChainKey(obj) {
    _assertClass(obj, SenderKeyDistributionMessage);
    const ret = wasm.SenderKeyDistributionMessage_GetChainKey(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SenderKeyDistributionMessage} obj
 * @returns {Uint8Array}
 */
export function SenderKeyDistributionMessage_GetDistributionId(obj) {
    _assertClass(obj, SenderKeyDistributionMessage);
    const ret = wasm.SenderKeyDistributionMessage_GetDistributionId(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SenderKeyDistributionMessage} obj
 * @returns {number}
 */
export function SenderKeyDistributionMessage_GetIteration(obj) {
    _assertClass(obj, SenderKeyDistributionMessage);
    const ret = wasm.SenderKeyDistributionMessage_GetIteration(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {ProtocolAddress} sender
 * @param {SenderKeyDistributionMessage} message
 * @param {any} store
 * @returns {Promise<any>}
 */
export function SenderKeyDistributionMessage_Process(sender, message, store) {
    _assertClass(sender, ProtocolAddress);
    _assertClass(message, SenderKeyDistributionMessage);
    const ret = wasm.SenderKeyDistributionMessage_Process(sender.__wbg_ptr, message.__wbg_ptr, store);
    return ret;
}

/**
 * @param {SenderKeyDistributionMessage} obj
 * @returns {Uint8Array}
 */
export function SenderKeyDistributionMessage_Serialize(obj) {
    _assertClass(obj, SenderKeyDistributionMessage);
    const ret = wasm.SenderKeyDistributionMessage_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class SenderKeyMessage {
    static __wrap(ptr) {
        const obj = Object.create(SenderKeyMessage.prototype);
        obj.__wbg_ptr = ptr;
        SenderKeyMessageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SenderKeyMessageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_senderkeymessage_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SenderKeyMessage}
     */
    cloneHandle() {
        const ret = wasm.senderkeymessage_cloneHandle(this.__wbg_ptr);
        return SenderKeyMessage.__wrap(ret);
    }
}
if (Symbol.dispose) SenderKeyMessage.prototype[Symbol.dispose] = SenderKeyMessage.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {SenderKeyMessage}
 */
export function SenderKeyMessage_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SenderKeyMessage_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SenderKeyMessage.__wrap(ret[0]);
}

/**
 * @param {SenderKeyMessage} obj
 * @returns {number}
 */
export function SenderKeyMessage_GetChainId(obj) {
    _assertClass(obj, SenderKeyMessage);
    const ret = wasm.SenderKeyMessage_GetChainId(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {SenderKeyMessage} obj
 * @returns {Uint8Array}
 */
export function SenderKeyMessage_GetCipherText(obj) {
    _assertClass(obj, SenderKeyMessage);
    const ret = wasm.SenderKeyMessage_GetCipherText(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SenderKeyMessage} obj
 * @returns {Uint8Array}
 */
export function SenderKeyMessage_GetDistributionId(obj) {
    _assertClass(obj, SenderKeyMessage);
    const ret = wasm.SenderKeyMessage_GetDistributionId(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SenderKeyMessage} obj
 * @returns {number}
 */
export function SenderKeyMessage_GetIteration(obj) {
    _assertClass(obj, SenderKeyMessage);
    const ret = wasm.SenderKeyMessage_GetIteration(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {SenderKeyMessage} obj
 * @returns {Uint8Array}
 */
export function SenderKeyMessage_Serialize(obj) {
    _assertClass(obj, SenderKeyMessage);
    const ret = wasm.SenderKeyMessage_Serialize(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SenderKeyMessage} skm
 * @param {PublicKey} pubkey
 * @returns {boolean}
 */
export function SenderKeyMessage_VerifySignature(skm, pubkey) {
    _assertClass(skm, SenderKeyMessage);
    _assertClass(pubkey, PublicKey);
    const ret = wasm.SenderKeyMessage_VerifySignature(skm.__wbg_ptr, pubkey.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

export class SenderKeyRecord {
    static __wrap(ptr) {
        const obj = Object.create(SenderKeyRecord.prototype);
        obj.__wbg_ptr = ptr;
        SenderKeyRecordFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SenderKeyRecordFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_senderkeyrecord_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SenderKeyRecord}
     */
    cloneHandle() {
        const ret = wasm.senderkeyrecord_cloneHandle(this.__wbg_ptr);
        return SenderKeyRecord.__wrap(ret);
    }
}
if (Symbol.dispose) SenderKeyRecord.prototype[Symbol.dispose] = SenderKeyRecord.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {SenderKeyRecord}
 */
export function SenderKeyRecord_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SenderKeyRecord_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SenderKeyRecord.__wrap(ret[0]);
}

/**
 * @param {SenderKeyRecord} obj
 * @returns {Uint8Array}
 */
export function SenderKeyRecord_Serialize(obj) {
    _assertClass(obj, SenderKeyRecord);
    const ret = wasm.SenderKeyRecord_Serialize(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class ServerCertificate {
    static __wrap(ptr) {
        const obj = Object.create(ServerCertificate.prototype);
        obj.__wbg_ptr = ptr;
        ServerCertificateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ServerCertificateFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_servercertificate_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {ServerCertificate}
     */
    cloneHandle() {
        const ret = wasm.servercertificate_cloneHandle(this.__wbg_ptr);
        return ServerCertificate.__wrap(ret);
    }
}
if (Symbol.dispose) ServerCertificate.prototype[Symbol.dispose] = ServerCertificate.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {ServerCertificate}
 */
export function ServerCertificate_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ServerCertificate_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ServerCertificate.__wrap(ret[0]);
}

/**
 * @param {ServerCertificate} obj
 * @returns {PublicKey}
 */
export function ServerCertificate_GetKey(obj) {
    _assertClass(obj, ServerCertificate);
    const ret = wasm.ServerCertificate_GetKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {ServerCertificate} obj
 * @returns {number}
 */
export function ServerCertificate_GetKeyId(obj) {
    _assertClass(obj, ServerCertificate);
    const ret = wasm.ServerCertificate_GetKeyId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {ServerCertificate} obj
 * @returns {Uint8Array}
 */
export function ServerCertificate_GetSerialized(obj) {
    _assertClass(obj, ServerCertificate);
    const ret = wasm.ServerCertificate_GetSerialized(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class ServerPublicParams {
    static __wrap(ptr) {
        const obj = Object.create(ServerPublicParams.prototype);
        obj.__wbg_ptr = ptr;
        ServerPublicParamsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ServerPublicParamsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_serverpublicparams_free(ptr, 0);
    }
}
if (Symbol.dispose) ServerPublicParams.prototype[Symbol.dispose] = ServerPublicParams.prototype.free;

/**
 * @param {ServerPublicParams} params
 * @param {Uint8Array} randomness_bytes
 * @param {Uint8Array} group_secret_params
 * @param {Uint8Array} auth_credential
 * @returns {Uint8Array}
 */
export function ServerPublicParams_CreateAuthCredentialWithPniPresentationDeterministic(params, randomness_bytes, group_secret_params, auth_credential) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(randomness_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(group_secret_params, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(auth_credential, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_CreateAuthCredentialWithPniPresentationDeterministic(params.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * @param {ServerPublicParams} params
 * @param {Uint8Array} randomness_bytes
 * @param {Uint8Array} group_secret_params
 * @param {Uint8Array} credential
 * @returns {Uint8Array}
 */
export function ServerPublicParams_CreateExpiringProfileKeyCredentialPresentationDeterministic(params, randomness_bytes, group_secret_params, credential) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(randomness_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(group_secret_params, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(credential, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_CreateExpiringProfileKeyCredentialPresentationDeterministic(params.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * @param {ServerPublicParams} params
 * @param {Uint8Array} randomness_bytes
 * @param {Uint8Array} user_id
 * @param {Uint8Array} profile_key
 * @returns {Uint8Array}
 */
export function ServerPublicParams_CreateProfileKeyCredentialRequestContextDeterministic(params, randomness_bytes, user_id, profile_key) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(randomness_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(user_id, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(profile_key, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_CreateProfileKeyCredentialRequestContextDeterministic(params.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * @param {Uint8Array} data
 * @returns {ServerPublicParams}
 */
export function ServerPublicParams_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ServerPublicParams.__wrap(ret[0]);
}

/**
 * `redemption_time` is in seconds, as in `GET /v1/certificate/auth/group`
 * @param {ServerPublicParams} params
 * @param {Uint8Array} aci_bytes
 * @param {Uint8Array} pni_bytes
 * @param {number} redemption_time
 * @param {Uint8Array} response
 * @returns {Uint8Array}
 */
export function ServerPublicParams_ReceiveAuthCredentialWithPniAsServiceId(params, aci_bytes, pni_bytes, redemption_time, response) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(aci_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(pni_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(response, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_ReceiveAuthCredentialWithPniAsServiceId(params.__wbg_ptr, ptr0, len0, ptr1, len1, redemption_time, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * For accounts without a phone number: the credential is bound to the provisioning message's
 * auth credential salt instead of a PNI
 * @param {ServerPublicParams} params
 * @param {Uint8Array} aci_bytes
 * @param {Uint8Array} salt
 * @param {number} redemption_time
 * @param {Uint8Array} response
 * @returns {Uint8Array}
 */
export function ServerPublicParams_ReceiveAuthCredentialZkcWithoutPni(params, aci_bytes, salt, redemption_time, response) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(aci_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(salt, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(response, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_ReceiveAuthCredentialZkcWithoutPni(params.__wbg_ptr, ptr0, len0, ptr1, len1, redemption_time, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * `current_time` is in seconds
 * @param {ServerPublicParams} params
 * @param {Uint8Array} request_context
 * @param {Uint8Array} response
 * @param {number} current_time
 * @returns {Uint8Array}
 */
export function ServerPublicParams_ReceiveExpiringProfileKeyCredential(params, request_context, response, current_time) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(request_context, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(response, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_ReceiveExpiringProfileKeyCredential(params.__wbg_ptr, ptr0, len0, ptr1, len1, current_time);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Verifies the server's notary signature, such as `GroupChange.serverSignature` over its actions
 * @param {ServerPublicParams} params
 * @param {Uint8Array} message
 * @param {Uint8Array} notary_signature
 */
export function ServerPublicParams_VerifySignature(params, message, notary_signature) {
    _assertClass(params, ServerPublicParams);
    const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(notary_signature, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ServerPublicParams_VerifySignature(params.__wbg_ptr, ptr0, len0, ptr1, len1);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
export function ServiceId_ParseFromServiceIdBinary(input) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ServiceId_ParseFromServiceIdBinary(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {string} input
 * @returns {Uint8Array}
 */
export function ServiceId_ParseFromServiceIdString(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ServiceId_ParseFromServiceIdString(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} value
 * @returns {Uint8Array}
 */
export function ServiceId_ServiceIdBinary(value) {
    const ptr0 = passArray8ToWasm0(value, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ServiceId_ServiceIdBinary(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} value
 * @returns {string}
 */
export function ServiceId_ServiceIdLog(value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(value, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ServiceId_ServiceIdLog(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * @param {Uint8Array} value
 * @returns {string}
 */
export function ServiceId_ServiceIdString(value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(value, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ServiceId_ServiceIdString(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * @param {PreKeyBundle} bundle
 * @param {ProtocolAddress} protocol_address
 * @param {ProtocolAddress} local_address
 * @param {any} session_store
 * @param {any} identity_key_store
 * @param {number} now
 * @returns {Promise<any>}
 */
export function SessionBuilder_ProcessPreKeyBundle(bundle, protocol_address, local_address, session_store, identity_key_store, now) {
    _assertClass(bundle, PreKeyBundle);
    _assertClass(protocol_address, ProtocolAddress);
    _assertClass(local_address, ProtocolAddress);
    const ret = wasm.SessionBuilder_ProcessPreKeyBundle(bundle.__wbg_ptr, protocol_address.__wbg_ptr, local_address.__wbg_ptr, session_store, identity_key_store, now);
    return ret;
}

/**
 * @param {PreKeySignalMessage} message
 * @param {ProtocolAddress} protocol_address
 * @param {ProtocolAddress} local_address
 * @param {any} session_store
 * @param {any} identity_key_store
 * @param {any} prekey_store
 * @param {any} signed_prekey_store
 * @param {any} kyber_prekey_store
 * @returns {Promise<any>}
 */
export function SessionCipher_DecryptPreKeySignalMessage(message, protocol_address, local_address, session_store, identity_key_store, prekey_store, signed_prekey_store, kyber_prekey_store) {
    _assertClass(message, PreKeySignalMessage);
    _assertClass(protocol_address, ProtocolAddress);
    _assertClass(local_address, ProtocolAddress);
    const ret = wasm.SessionCipher_DecryptPreKeySignalMessage(message.__wbg_ptr, protocol_address.__wbg_ptr, local_address.__wbg_ptr, session_store, identity_key_store, prekey_store, signed_prekey_store, kyber_prekey_store);
    return ret;
}

/**
 * @param {SignalMessage} message
 * @param {ProtocolAddress} protocol_address
 * @param {ProtocolAddress} local_address
 * @param {any} session_store
 * @param {any} identity_key_store
 * @returns {Promise<any>}
 */
export function SessionCipher_DecryptSignalMessage(message, protocol_address, local_address, session_store, identity_key_store) {
    _assertClass(message, SignalMessage);
    _assertClass(protocol_address, ProtocolAddress);
    _assertClass(local_address, ProtocolAddress);
    const ret = wasm.SessionCipher_DecryptSignalMessage(message.__wbg_ptr, protocol_address.__wbg_ptr, local_address.__wbg_ptr, session_store, identity_key_store);
    return ret;
}

/**
 * @param {Uint8Array} ptext
 * @param {ProtocolAddress} protocol_address
 * @param {ProtocolAddress} local_address
 * @param {any} session_store
 * @param {any} identity_key_store
 * @param {number} now
 * @returns {Promise<any>}
 */
export function SessionCipher_EncryptMessage(ptext, protocol_address, local_address, session_store, identity_key_store, now) {
    const ptr0 = passArray8ToWasm0(ptext, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(protocol_address, ProtocolAddress);
    _assertClass(local_address, ProtocolAddress);
    const ret = wasm.SessionCipher_EncryptMessage(ptr0, len0, protocol_address.__wbg_ptr, local_address.__wbg_ptr, session_store, identity_key_store, now);
    return ret;
}

export class SessionRecord {
    static __wrap(ptr) {
        const obj = Object.create(SessionRecord.prototype);
        obj.__wbg_ptr = ptr;
        SessionRecordFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof SessionRecord)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SessionRecordFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sessionrecord_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SessionRecord}
     */
    cloneHandle() {
        const ret = wasm.sessionrecord_cloneHandle(this.__wbg_ptr);
        return SessionRecord.__wrap(ret);
    }
}
if (Symbol.dispose) SessionRecord.prototype[Symbol.dispose] = SessionRecord.prototype.free;

/**
 * @param {SessionRecord} obj
 */
export function SessionRecord_ArchiveCurrentState(obj) {
    _assertClass(obj, SessionRecord);
    const ret = wasm.SessionRecord_ArchiveCurrentState(obj.__wbg_ptr);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {SessionRecord} obj
 * @param {PublicKey} key
 * @returns {boolean}
 */
export function SessionRecord_CurrentRatchetKeyMatches(obj, key) {
    _assertClass(obj, SessionRecord);
    _assertClass(key, PublicKey);
    const ret = wasm.SessionRecord_CurrentRatchetKeyMatches(obj.__wbg_ptr, key.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {Uint8Array} data
 * @returns {SessionRecord}
 */
export function SessionRecord_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SessionRecord_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SessionRecord.__wrap(ret[0]);
}

/**
 * @param {SessionRecord} obj
 * @returns {number}
 */
export function SessionRecord_GetLocalRegistrationId(obj) {
    _assertClass(obj, SessionRecord);
    const ret = wasm.SessionRecord_GetLocalRegistrationId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {SessionRecord} obj
 * @returns {number}
 */
export function SessionRecord_GetRemoteRegistrationId(obj) {
    _assertClass(obj, SessionRecord);
    const ret = wasm.SessionRecord_GetRemoteRegistrationId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {SessionRecord} obj
 * @param {number} now
 * @returns {boolean}
 */
export function SessionRecord_HasUsableSenderChain(obj, now) {
    _assertClass(obj, SessionRecord);
    const ret = wasm.SessionRecord_HasUsableSenderChain(obj.__wbg_ptr, now);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {SessionRecord} obj
 * @returns {Uint8Array}
 */
export function SessionRecord_Serialize(obj) {
    _assertClass(obj, SessionRecord);
    const ret = wasm.SessionRecord_Serialize(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * The client side of an attested connection, from the enclave's attestation message to an established session
 */
export class SgxClientState {
    static __wrap(ptr) {
        const obj = Object.create(SgxClientState.prototype);
        obj.__wbg_ptr = ptr;
        SgxClientStateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SgxClientStateFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sgxclientstate_free(ptr, 0);
    }
}
if (Symbol.dispose) SgxClientState.prototype[Symbol.dispose] = SgxClientState.prototype.free;

/**
 * @param {SgxClientState} cli
 * @param {Uint8Array} handshake_received
 */
export function SgxClientState_CompleteHandshake(cli, handshake_received) {
    _assertClass(cli, SgxClientState);
    const ptr0 = passArray8ToWasm0(handshake_received, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SgxClientState_CompleteHandshake(cli.__wbg_ptr, ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {SgxClientState} cli
 * @param {Uint8Array} received_ciphertext
 * @returns {Uint8Array}
 */
export function SgxClientState_EstablishedRecv(cli, received_ciphertext) {
    _assertClass(cli, SgxClientState);
    const ptr0 = passArray8ToWasm0(received_ciphertext, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SgxClientState_EstablishedRecv(cli.__wbg_ptr, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {SgxClientState} cli
 * @param {Uint8Array} plaintext_to_send
 * @returns {Uint8Array}
 */
export function SgxClientState_EstablishedSend(cli, plaintext_to_send) {
    _assertClass(cli, SgxClientState);
    const ptr0 = passArray8ToWasm0(plaintext_to_send, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SgxClientState_EstablishedSend(cli.__wbg_ptr, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {SgxClientState} obj
 * @returns {Uint8Array}
 */
export function SgxClientState_InitialRequest(obj) {
    _assertClass(obj, SgxClientState);
    const ret = wasm.SgxClientState_InitialRequest(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class SignalMessage {
    static __wrap(ptr) {
        const obj = Object.create(SignalMessage.prototype);
        obj.__wbg_ptr = ptr;
        SignalMessageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SignalMessageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_signalmessage_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SignalMessage}
     */
    cloneHandle() {
        const ret = wasm.signalmessage_cloneHandle(this.__wbg_ptr);
        return SignalMessage.__wrap(ret);
    }
}
if (Symbol.dispose) SignalMessage.prototype[Symbol.dispose] = SignalMessage.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {SignalMessage}
 */
export function SignalMessage_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SignalMessage_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SignalMessage.__wrap(ret[0]);
}

/**
 * @param {SignalMessage} obj
 * @returns {Uint8Array}
 */
export function SignalMessage_GetBody(obj) {
    _assertClass(obj, SignalMessage);
    const ret = wasm.SignalMessage_GetBody(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SignalMessage} obj
 * @returns {number}
 */
export function SignalMessage_GetCounter(obj) {
    _assertClass(obj, SignalMessage);
    const ret = wasm.SignalMessage_GetCounter(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {SignalMessage} obj
 * @returns {number}
 */
export function SignalMessage_GetMessageVersion(obj) {
    _assertClass(obj, SignalMessage);
    const ret = wasm.SignalMessage_GetMessageVersion(obj.__wbg_ptr);
    return ret >>> 0;
}

/**
 * @param {SignalMessage} obj
 * @returns {Uint8Array}
 */
export function SignalMessage_GetSerialized(obj) {
    _assertClass(obj, SignalMessage);
    const ret = wasm.SignalMessage_GetSerialized(obj.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

export class SignedPreKeyRecord {
    static __wrap(ptr) {
        const obj = Object.create(SignedPreKeyRecord.prototype);
        obj.__wbg_ptr = ptr;
        SignedPreKeyRecordFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SignedPreKeyRecordFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_signedprekeyrecord_free(ptr, 0);
    }
    /**
     * Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
     * @returns {SignedPreKeyRecord}
     */
    cloneHandle() {
        const ret = wasm.signedprekeyrecord_cloneHandle(this.__wbg_ptr);
        return SignedPreKeyRecord.__wrap(ret);
    }
}
if (Symbol.dispose) SignedPreKeyRecord.prototype[Symbol.dispose] = SignedPreKeyRecord.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {SignedPreKeyRecord}
 */
export function SignedPreKeyRecord_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SignedPreKeyRecord_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SignedPreKeyRecord.__wrap(ret[0]);
}

/**
 * @param {SignedPreKeyRecord} obj
 * @returns {number}
 */
export function SignedPreKeyRecord_GetId(obj) {
    _assertClass(obj, SignedPreKeyRecord);
    const ret = wasm.SignedPreKeyRecord_GetId(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {SignedPreKeyRecord} obj
 * @returns {PrivateKey}
 */
export function SignedPreKeyRecord_GetPrivateKey(obj) {
    _assertClass(obj, SignedPreKeyRecord);
    const ret = wasm.SignedPreKeyRecord_GetPrivateKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PrivateKey.__wrap(ret[0]);
}

/**
 * @param {SignedPreKeyRecord} obj
 * @returns {PublicKey}
 */
export function SignedPreKeyRecord_GetPublicKey(obj) {
    _assertClass(obj, SignedPreKeyRecord);
    const ret = wasm.SignedPreKeyRecord_GetPublicKey(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return PublicKey.__wrap(ret[0]);
}

/**
 * @param {SignedPreKeyRecord} obj
 * @returns {Uint8Array}
 */
export function SignedPreKeyRecord_GetSignature(obj) {
    _assertClass(obj, SignedPreKeyRecord);
    const ret = wasm.SignedPreKeyRecord_GetSignature(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {SignedPreKeyRecord} obj
 * @returns {number}
 */
export function SignedPreKeyRecord_GetTimestamp(obj) {
    _assertClass(obj, SignedPreKeyRecord);
    const ret = wasm.SignedPreKeyRecord_GetTimestamp(obj.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} id
 * @param {number} timestamp_millis
 * @param {PublicKey} pub_key
 * @param {PrivateKey} priv_key
 * @param {Uint8Array} signature
 * @returns {SignedPreKeyRecord}
 */
export function SignedPreKeyRecord_New(id, timestamp_millis, pub_key, priv_key, signature) {
    _assertClass(pub_key, PublicKey);
    _assertClass(priv_key, PrivateKey);
    const ptr0 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SignedPreKeyRecord_New(id, timestamp_millis, pub_key.__wbg_ptr, priv_key.__wbg_ptr, ptr0, len0);
    return SignedPreKeyRecord.__wrap(ret);
}

/**
 * @param {SignedPreKeyRecord} obj
 * @returns {Uint8Array}
 */
export function SignedPreKeyRecord_Serialize(obj) {
    _assertClass(obj, SignedPreKeyRecord);
    const ret = wasm.SignedPreKeyRecord_Serialize(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {Uint8Array} mrenclave
 * @param {Uint8Array} attestation_msg
 * @param {number} current_timestamp
 * @returns {SgxClientState}
 */
export function Svr2Client_New(mrenclave, attestation_msg, current_timestamp) {
    const ptr0 = passArray8ToWasm0(mrenclave, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(attestation_msg, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.Svr2Client_New(ptr0, len0, ptr1, len1, current_timestamp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SgxClientState.__wrap(ret[0]);
}

/**
 * @param {Uint8Array} svr_key
 * @returns {Uint8Array}
 */
export function SvrKey_DeriveRegistrationLock(svr_key) {
    const ptr0 = passArray8ToWasm0(svr_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SvrKey_DeriveRegistrationLock(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} svr_key
 * @returns {Uint8Array}
 */
export function SvrKey_DeriveRegistrationRecoveryPassword(svr_key) {
    const ptr0 = passArray8ToWasm0(svr_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.SvrKey_DeriveRegistrationRecoveryPassword(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

export class TlsClient {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TlsClientFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_tlsclient_free(ptr, 0);
    }
    /**
     * The protocol the server chose from `alpn_protocols`, once the handshake completes
     * @returns {string | undefined}
     */
    alpnProtocol() {
        const ret = wasm.tlsclient_alpnProtocol(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Queues `close_notify`; call `takeOutgoing` afterwards
     */
    close() {
        wasm.tlsclient_close(this.__wbg_ptr);
    }
    /**
     * @returns {boolean}
     */
    isHandshaking() {
        const ret = wasm.tlsclient_isHandshaking(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * `trust_anchors` are DER certificates; only chains to them are accepted. `alpn_protocols` are
     * offered in order of preference.
     * @param {string} server_name
     * @param {Uint8Array[]} trust_anchors
     * @param {string[]} alpn_protocols
     */
    constructor(server_name, trust_anchors, alpn_protocols) {
        const ptr0 = passStringToWasm0(server_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(trust_anchors, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(alpn_protocols, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.tlsclient_new(ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        TlsClientFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Processes bytes from the peer and returns the decrypted application data
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    receive(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tlsclient_receive(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Queues application data of any length; it is sent after the handshake completes
     * @param {Uint8Array} data
     */
    send(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.tlsclient_send(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Returns TLS records to write to the tunnel
     * @returns {Uint8Array}
     */
    takeOutgoing() {
        const ret = wasm.tlsclient_takeOutgoing(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) TlsClient.prototype[Symbol.dispose] = TlsClient.prototype.free;

export class UnidentifiedSenderMessageContent {
    static __wrap(ptr) {
        const obj = Object.create(UnidentifiedSenderMessageContent.prototype);
        obj.__wbg_ptr = ptr;
        UnidentifiedSenderMessageContentFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UnidentifiedSenderMessageContentFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_unidentifiedsendermessagecontent_free(ptr, 0);
    }
}
if (Symbol.dispose) UnidentifiedSenderMessageContent.prototype[Symbol.dispose] = UnidentifiedSenderMessageContent.prototype.free;

/**
 * @param {Uint8Array} data
 * @returns {UnidentifiedSenderMessageContent}
 */
export function UnidentifiedSenderMessageContent_Deserialize(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.UnidentifiedSenderMessageContent_Deserialize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return UnidentifiedSenderMessageContent.__wrap(ret[0]);
}

/**
 * @param {UnidentifiedSenderMessageContent} m
 * @returns {number}
 */
export function UnidentifiedSenderMessageContent_GetContentHint(m) {
    _assertClass(m, UnidentifiedSenderMessageContent);
    const ret = wasm.UnidentifiedSenderMessageContent_GetContentHint(m.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {UnidentifiedSenderMessageContent} obj
 * @returns {Uint8Array}
 */
export function UnidentifiedSenderMessageContent_GetContents(obj) {
    _assertClass(obj, UnidentifiedSenderMessageContent);
    const ret = wasm.UnidentifiedSenderMessageContent_GetContents(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {UnidentifiedSenderMessageContent} obj
 * @returns {Uint8Array | undefined}
 */
export function UnidentifiedSenderMessageContent_GetGroupId(obj) {
    _assertClass(obj, UnidentifiedSenderMessageContent);
    const ret = wasm.UnidentifiedSenderMessageContent_GetGroupId(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * @param {UnidentifiedSenderMessageContent} m
 * @returns {number}
 */
export function UnidentifiedSenderMessageContent_GetMsgType(m) {
    _assertClass(m, UnidentifiedSenderMessageContent);
    const ret = wasm.UnidentifiedSenderMessageContent_GetMsgType(m.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {UnidentifiedSenderMessageContent} m
 * @returns {SenderCertificate}
 */
export function UnidentifiedSenderMessageContent_GetSenderCert(m) {
    _assertClass(m, UnidentifiedSenderMessageContent);
    const ret = wasm.UnidentifiedSenderMessageContent_GetSenderCert(m.__wbg_ptr);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return SenderCertificate.__wrap(ret[0]);
}

/**
 * @param {CiphertextMessage} message
 * @param {SenderCertificate} sender
 * @param {number} content_hint
 * @param {Uint8Array | null} [group_id]
 * @returns {UnidentifiedSenderMessageContent}
 */
export function UnidentifiedSenderMessageContent_New(message, sender, content_hint, group_id) {
    _assertClass(message, CiphertextMessage);
    _assertClass(sender, SenderCertificate);
    var ptr0 = isLikeNone(group_id) ? 0 : passArray8ToWasm0(group_id, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.UnidentifiedSenderMessageContent_New(message.__wbg_ptr, sender.__wbg_ptr, content_hint, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return UnidentifiedSenderMessageContent.__wrap(ret[0]);
}

/**
 * @param {UnidentifiedSenderMessageContent} obj
 * @returns {Uint8Array}
 */
export function UnidentifiedSenderMessageContent_Serialize(obj) {
    _assertClass(obj, UnidentifiedSenderMessageContent);
    const ret = wasm.UnidentifiedSenderMessageContent_Serialize(obj.__wbg_ptr);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Returns the 32 bytes of entropy followed by the encrypted username
 * @param {string} username
 * @param {Uint8Array | null} [entropy]
 * @returns {Uint8Array}
 */
export function UsernameLink_Create(username, entropy) {
    const ptr0 = passStringToWasm0(username, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(entropy) ? 0 : passArray8ToWasm0(entropy, wasm.__wbindgen_malloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.UsernameLink_Create(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} entropy
 * @param {Uint8Array} encrypted_username
 * @returns {string}
 */
export function UsernameLink_DecryptUsername(entropy, encrypted_username) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(entropy, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(encrypted_username, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.UsernameLink_DecryptUsername(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * @param {string} nickname
 * @param {number} min_len
 * @param {number} max_len
 * @returns {string[]}
 */
export function Username_CandidatesFrom(nickname, min_len, max_len) {
    const ptr0 = passStringToWasm0(nickname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.Username_CandidatesFrom(ptr0, len0, min_len, max_len);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * @param {string} username
 * @returns {Uint8Array}
 */
export function Username_Hash(username) {
    const ptr0 = passStringToWasm0(username, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.Username_Hash(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {string} nickname
 * @param {string} discriminator
 * @param {number} min_len
 * @param {number} max_len
 * @returns {Uint8Array}
 */
export function Username_HashFromParts(nickname, discriminator, min_len, max_len) {
    const ptr0 = passStringToWasm0(nickname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(discriminator, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.Username_HashFromParts(ptr0, len0, ptr1, len1, min_len, max_len);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {string} username
 * @param {Uint8Array} randomness
 * @returns {Uint8Array}
 */
export function Username_Proof(username, randomness) {
    const ptr0 = passStringToWasm0(username, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(randomness, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.Username_Proof(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_falsy_a6dfe792ff282f10: function(arg0) {
            const ret = !arg0;
            return ret;
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_ea9085d691f535d3: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_394265ed1e1b84ee: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_fffb441def202758: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_apply_3ac86a26fdb56c05: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.apply(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_ciphertextmessage_new: function(arg0) {
            const ret = CiphertextMessage.__wrap(arg0);
            return ret;
        },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_from_13e323c65fc8f464: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_getRandomValues_3f44b700395062e5: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_get_507a50627bffa49b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_78f252d074a84d0b: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_instanceof_Error_1fdac9f13a8181ba: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Error;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_message_8326fb1d549bebc5: function(arg0) {
            const ret = arg0.message;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_b667d279fd5aa943: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_cd45aabdf6073e84: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_77cdfb7977362f3c: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_1824d93f294193e5: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___js_sys_e4fc5239a9904755___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined___js_sys_e4fc5239a9904755___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_length_e6785c33c8e4cce8: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_86c0d4ba3fa605b8: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_of_5f1b88183ddb5d94: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_privatekey_new: function(arg0) {
            const ret = PrivateKey.__wrap(arg0);
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_protocoladdress_new: function(arg0) {
            const ret = ProtocolAddress.__wrap(arg0);
            return ret;
        },
        __wbg_protocoladdress_unwrap: function(arg0) {
            const ret = ProtocolAddress.__unwrap(arg0);
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_publickey_new: function(arg0) {
            const ret = PublicKey.__wrap(arg0);
            return ret;
        },
        __wbg_publickey_unwrap: function(arg0) {
            const ret = PublicKey.__unwrap(arg0);
            return ret;
        },
        __wbg_push_d2ae3af0c1217ae6: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_0ab5b2d2393e99b9: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_6a09b7bc46549209: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_resolve_2191a4dfe481c25b: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_senderkeydistributionmessage_new: function(arg0) {
            const ret = SenderKeyDistributionMessage.__wrap(arg0);
            return ret;
        },
        __wbg_sessionrecord_unwrap: function(arg0) {
            const ret = SessionRecord.__unwrap(arg0);
            return ret;
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_3ed232c8a6baee09: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_then_16d107c451e9905d: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_6ec10ae38b3e92f7: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_unidentifiedsendermessagecontent_new: function(arg0) {
            const ret = UnidentifiedSenderMessageContent.__wrap(arg0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 190, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___wasm_bindgen_97461482e016b7d2___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_97461482e016b7d2___JsError___true_);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./signal_wasm_bg.js": import0,
    };
}

function wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___wasm_bindgen_97461482e016b7d2___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_97461482e016b7d2___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___wasm_bindgen_97461482e016b7d2___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_97461482e016b7d2___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___js_sys_e4fc5239a9904755___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined___js_sys_e4fc5239a9904755___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_97461482e016b7d2___convert__closures_____invoke___js_sys_e4fc5239a9904755___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined___js_sys_e4fc5239a9904755___Function_fn_wasm_bindgen_97461482e016b7d2___JsValue_____wasm_bindgen_97461482e016b7d2___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}

const CiphertextMessageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ciphertextmessage_free(ptr, 1));
const DecryptionErrorMessageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_decryptionerrormessage_free(ptr, 1));
const FingerprintFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fingerprint_free(ptr, 1));
const KyberKeyPairFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kyberkeypair_free(ptr, 1));
const KyberPreKeyRecordFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kyberprekeyrecord_free(ptr, 1));
const KyberPublicKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kyberpublickey_free(ptr, 1));
const KyberSecretKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kybersecretkey_free(ptr, 1));
const MessageBackupKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_messagebackupkey_free(ptr, 1));
const PinHashFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pinhash_free(ptr, 1));
const PlaintextContentFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_plaintextcontent_free(ptr, 1));
const PreKeyBundleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_prekeybundle_free(ptr, 1));
const PreKeyRecordFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_prekeyrecord_free(ptr, 1));
const PreKeySignalMessageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_prekeysignalmessage_free(ptr, 1));
const PrivateKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_privatekey_free(ptr, 1));
const ProtocolAddressFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_protocoladdress_free(ptr, 1));
const PublicKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_publickey_free(ptr, 1));
const SenderCertificateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sendercertificate_free(ptr, 1));
const SenderKeyDistributionMessageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_senderkeydistributionmessage_free(ptr, 1));
const SenderKeyMessageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_senderkeymessage_free(ptr, 1));
const SenderKeyRecordFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_senderkeyrecord_free(ptr, 1));
const ServerCertificateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_servercertificate_free(ptr, 1));
const ServerPublicParamsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_serverpublicparams_free(ptr, 1));
const SessionRecordFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sessionrecord_free(ptr, 1));
const SgxClientStateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sgxclientstate_free(ptr, 1));
const SignalMessageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_signalmessage_free(ptr, 1));
const SignedPreKeyRecordFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_signedprekeyrecord_free(ptr, 1));
const TlsClientFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_tlsclient_free(ptr, 1));
const UnidentifiedSenderMessageContentFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_unidentifiedsendermessagecontent_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('signal_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
