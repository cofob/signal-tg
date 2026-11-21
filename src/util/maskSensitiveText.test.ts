import { describe, expect, test, vi } from 'vitest';

const ACI = '3d0c8e0f-6c1f-4f3a-9d7e-1f2a3b4c5d6e';
const PNI = 'PNI:9A8B7C6D-5E4F-4A3B-8C2D-1E0F9A8B7C6D';
const GROUP_ID = 'q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq8w=';
const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

vi.mock('../config', () => ({ DEBUG: false }));

const { default: maskSensitiveText, getLoggableError } = await import('./maskSensitiveText');

describe('maskSensitiveText', () => {
  test('masks service ids, phone numbers and key-sized values', () => {
    const text = `Profile request for ${ACI} failed; ${PNI} +491701234567 ${GROUP_ID} ${KEY_HEX}`;
    const masked = maskSensitiveText(text);

    expect(masked).toBe('Profile request for [id] failed; PNI:[id] [number] [data] [data]');
  });

  test('keeps the rest of the text', () => {
    const text = 'HTTP 413 for /v1/messages, retry in 30 s (attempt 2/5): index-AbCdEf12.js:1:2345';

    expect(maskSensitiveText(text)).toBe(text);
  });
});

describe('getLoggableError', () => {
  test('returns masked text with the stack in production builds', () => {
    const error = new Error(`No session for ${ACI}.1`);
    const loggable = getLoggableError(error);

    expect(typeof loggable).toBe('string');
    expect(loggable).toContain('Error: No session for [id].1');
    expect(loggable).not.toContain(ACI);
  });

  test('masks other thrown values', () => {
    expect(getLoggableError(`lookup of +14155550100 failed`)).toBe('lookup of [number] failed');
  });
});
