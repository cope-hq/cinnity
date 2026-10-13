import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { loadVapidKey, vapidAuthorization } from '../src/push/vapid.js';
import { validateEndpoint } from '../src/push/endpoint.js';

const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});

test('VAPID header is a verifiable ES256 JWT bound to the endpoint origin', () => {
  const key = loadVapidKey(pem);
  const k = Buffer.from(key.publicKey, 'base64url');
  assert.equal(k.length, 65);
  assert.equal(k[0], 0x04);

  const now = 1_700_000_000_000;
  const value = vapidAuthorization(
    'https://fcm.googleapis.com/fcm/send/abc',
    key,
    'https://cinny.example',
    now
  );
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(value);
  assert.ok(match);
  const [, header, claims, signature, publicKey] = match;
  assert.equal(publicKey, key.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.sub, 'https://cinny.example');
  assert.ok(payload.exp > now / 1000 && payload.exp <= now / 1000 + 24 * 3600);

  const sig = Buffer.from(signature, 'base64url');
  assert.equal(sig.length, 64);
  const [x, y] = [k.subarray(1, 33), k.subarray(33)].map((b) => b.toString('base64url'));
  const verifier = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: verifier, dsaEncoding: 'ieee-p1363' },
      sig
    )
  );
});

test('VAPID key loader rejects non-P-256 keys', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  assert.throws(() => loadVapidKey(rsa));
  assert.throws(() => loadVapidKey(p384));
});

test('endpoint allowlist accepts browser push services only', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])
    assert.ok(validateEndpoint(ok), ok);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com.example/x',
    'https://evilpush.apple.com/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://cinny.example/x',
    'not a url',
    42,
    undefined,
  ])
    assert.equal(validateEndpoint(bad), undefined, String(bad));
});
