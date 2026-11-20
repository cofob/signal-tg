import type { Envelope } from './proto/generated/SignalService_pb';
import type { DecryptedEnvelope } from './receiver/decryptEnvelope';
import type { SenderContext } from './sender/sendContent';
import type SignalStore from './store/SignalStore';
import type { AccountRecord } from './store/SignalStore';

import { updateDeviceCapabilities } from './account/capabilities';
import { DecryptionError } from './receiver/decryptEnvelope';
import { handleRetryRequest, requestResend } from './receiver/retry';
import { saveProfileKey } from './sender/sealedSender';
import { initSignalWasm } from './wasm';

import ChatConnection from './chat/ChatConnection';
import UnauthenticatedChat from './chat/UnauthenticatedChat';

export type SignalClientHandlers = {
  // Decrypted content for the app; protocol-level content is handled before this
  onContent(decrypted: DecryptedEnvelope): Promise<void> | void;
  onDeliveryReceipt?(envelope: Envelope): Promise<void> | void;
  onDecryptionError?(envelope: Envelope, error: Error): void;
  onQueueEmpty?(): void;
  onClose?(code: number, reason: string): void;
  onError(error: Error): void;
};

/**
 * The linked device: its connections and the protocol work that needs no app state. It answers retry
 * requests, asks senders to resend what failed to decrypt, stores account keys from the primary device
 * and the profile keys that messages carry, and passes the rest to `onContent`.
 */
export default class SignalClient {
  private unauthenticatedChat = new UnauthenticatedChat();

  private connection?: ChatConnection;

  private account?: AccountRecord;

  constructor(readonly store: SignalStore) {}

  async connect(handlers: SignalClientHandlers) {
    await initSignalWasm();
    const account = await this.store.getItem('account');
    if (!account) throw new Error('This browser is not linked to a Signal account');
    this.account = account;

    this.connection?.close();
    this.connection = await ChatConnection.connect(this.store, account, {
      onEnvelope: async (decrypted) => {
        if (await this.handleProtocolContent(decrypted)) return;
        await handlers.onContent(decrypted);
      },
      onDeliveryReceipt: (envelope) => handlers.onDeliveryReceipt?.(envelope),
      onDecryptionError: async (envelope, error) => {
        handlers.onDecryptionError?.(envelope, error);
        if (error instanceof DecryptionError) await requestResend(this.getSenderContext(), error);
      },
      onQueueEmpty: () => handlers.onQueueEmpty?.(),
      onClose: (code, reason) => handlers.onClose?.(code, reason),
      onError: handlers.onError,
    });

    updateDeviceCapabilities(this.connection, Boolean(account.number)).catch(handlers.onError);
  }

  close() {
    this.connection?.close();
    this.connection = undefined;
    this.unauthenticatedChat.close();
  }

  getSenderContext(): SenderContext {
    if (!this.account || !this.connection) throw new Error('Signal client is not connected');
    return {
      store: this.store,
      account: this.account,
      connection: this.connection,
      unauthenticatedChat: this.unauthenticatedChat,
    };
  }

  /** Returns `true` when the content needs nothing from the app */
  private async handleProtocolContent(decrypted: DecryptedEnvelope) {
    const { senderServiceId, senderDeviceId, content: { content: body } } = decrypted;

    if (body.case === 'decryptionErrorMessage') {
      await handleRetryRequest(this.getSenderContext(), senderServiceId, senderDeviceId, body.value);
      return true;
    }

    if (body.case === 'dataMessage' && body.value.profileKey.length) {
      await saveProfileKey(this.store, senderServiceId, body.value.profileKey);
    }

    if (body.case === 'syncMessage' && body.value.content.case === 'keys' && senderServiceId === this.account!.aci) {
      const keys = body.value.content.value;
      this.account = {
        ...this.account!,
        accountEntropyPool: keys.accountEntropyPool || this.account!.accountEntropyPool,
        mediaRootBackupKey: keys.mediaRootBackupKey.length ? keys.mediaRootBackupKey : this.account!.mediaRootBackupKey,
      };
      await this.store.setItem('account', this.account);
      return true;
    }

    return body.case === 'nullMessage' || body.case === undefined;
  }
}
