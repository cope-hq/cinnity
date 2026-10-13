import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
const PUSH_TIMEOUT_MS = 10_000;
// Push services keep undelivered messages for at most this long.
const TTL_SECONDS = 12 * 60 * 60;

const fail = () => new Error('Invalid push subscription.');
const hkdf = (ikm, salt, info, length) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/**
 * RFC 8291 Web Push message encryption with the RFC 8188 aes128gcm content
 * coding, as a single record. `p256dh` and `auth` are the subscription keys
 * (base64url). `senderPrivateKey` and `salt` exist only for test vectors.
 */
export function encryptPayload(
  plaintext,
  { p256dh, auth },
  { senderPrivateKey, salt = randomBytes(16), rs = RECORD_SIZE } = {}
) {
  if (typeof p256dh !== 'string' || typeof auth !== 'string') throw fail();
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04 || authSecret.length !== 16) throw fail();
  if (salt.length !== 16 || plaintext.length + 1 + TAG_LENGTH > rs) throw fail();

  const ecdh = createECDH('prime256v1');
  if (senderPrivateKey) ecdh.setPrivateKey(senderPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  let shared;
  try {
    shared = ecdh.computeSecret(uaPublic);
  } catch {
    throw fail();
  }

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 is the padding delimiter of the final (and only) record.
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, ciphertext]);
}

/**
 * Deliver an encrypted message. Resolves to 'gone' when the subscription no
 * longer exists (the pusher should be rejected), never throws.
 */
export async function sendWebPush(endpoint, body, headers, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(TTL_SECONDS),
        ...headers,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
