import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { encryptPayload } from '../src/push/webpush.js';

const b64 = (s) => Buffer.from(s, 'base64url');

// RFC 8291 §5 / Appendix A.
const vector = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

// Independent receiver-side decryption (RFC 8291 §3.4 / RFC 8188).
function decrypt(message, uaPrivate, auth) {
  const salt = message.subarray(0, 16);
  const idlen = message[20];
  const asPublic = message.subarray(21, 21 + idlen);
  const body = message.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const padded = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
  assert.equal(padded.at(-1), 0x02);
  return padded.subarray(0, -1);
}

test('matches the RFC 8291 test vector byte for byte', () => {
  const message = encryptPayload(
    Buffer.from(vector.plaintext),
    { p256dh: vector.uaPublic, auth: vector.auth },
    { senderPrivateKey: b64(vector.asPrivate), salt: b64(vector.salt) }
  );
  assert.deepEqual(message, Buffer.concat([b64(vector.header), b64(vector.ciphertext)]));
  assert.equal(message.length, 144);
});

test('round-trips with fresh sender keys and salt', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = Buffer.alloc(16, 7);
  const plaintext = Buffer.from(JSON.stringify({ v: 1, body: 'héllo 👋' }));
  const message = encryptPayload(plaintext, {
    p256dh: ua.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
  });
  assert.deepEqual(decrypt(message, ua.getPrivateKey(), auth), plaintext);
  assert.notDeepEqual(
    message.subarray(0, 16),
    encryptPayload(plaintext, {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    }).subarray(0, 16)
  );
});

test('rejects malformed subscription keys and oversized plaintext', () => {
  const keys = { p256dh: vector.uaPublic, auth: vector.auth };
  for (const bad of [
    { ...keys, p256dh: 'AAAA' },
    { ...keys, p256dh: Buffer.alloc(65, 1).toString('base64url') },
    { ...keys, auth: 'AAAA' },
    { ...keys, auth: undefined },
    { p256dh: 42, auth: vector.auth },
  ])
    assert.throws(() => encryptPayload(Buffer.from('x'), bad));
  assert.throws(() => encryptPayload(Buffer.alloc(4096 - 16), keys));
  assert.ok(encryptPayload(Buffer.alloc(4096 - 17), keys).length <= 4096 + 86);
});
