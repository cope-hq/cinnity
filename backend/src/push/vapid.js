import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const JWT_LIFETIME_S = 12 * 60 * 60;
const b64url = (value) => Buffer.from(value).toString('base64url');

/** Load a P-256 private key (PEM) and derive the VAPID public key. */
export function loadVapidKey(pem) {
  const privateKey = createPrivateKey(pem);
  if (
    privateKey.asymmetricKeyType !== 'ec' ||
    privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  )
    throw new Error('VAPID key must be an EC P-256 key.');
  const { x, y } = createPublicKey(privateKey).export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(x, 'base64url'),
    Buffer.from(y, 'base64url'),
  ]).toString('base64url');
  return { privateKey, publicKey };
}

/** RFC 8292 `Authorization` header value for a push endpoint. */
export function vapidAuthorization(endpoint, { privateKey, publicKey }, subject, nowMs) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_S,
      sub: subject,
    })
  );
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${publicKey}`;
}
