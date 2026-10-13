import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { createPushServer, NOTIFY_PATH, VAPID_PATH } from '../src/push/server.js';
import { loadVapidKey } from '../src/push/vapid.js';
import { MAX_PAYLOAD_BYTES } from '../src/push/payload.js';

const origin = 'https://cinny.example';
const vapid = loadVapidKey(
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  })
);

const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = Buffer.alloc(16, 3);
const pushkey = ua.getPublicKey().toString('base64url');
const device = (overrides = {}) => ({
  app_id: 'cinny.web',
  pushkey,
  pushkey_ts: 1,
  data: {
    url: origin + NOTIFY_PATH,
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    auth: auth.toString('base64url'),
  },
  ...overrides,
});
const notification = (overrides = {}) => ({
  event_id: '$event',
  room_id: '!room:example',
  type: 'm.room.message',
  sender: '@alice:example',
  sender_display_name: 'Alice',
  room_name: 'Lounge',
  content: { msgtype: 'm.text', body: 'hello there' },
  counts: { unread: 2 },
  prio: 'high',
  devices: [device()],
  ...overrides,
});

function decrypt(message) {
  const salt = message.subarray(0, 16);
  const asPublic = message.subarray(21, 21 + message[20]);
  const body = message.subarray(21 + message[20]);
  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const padded = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
  return JSON.parse(padded.subarray(0, -1));
}

async function start(t, send) {
  const sent = [];
  const server = createPushServer({
    origin,
    vapid,
    now: () => 1_700_000_000_000,
    send: async (endpoint, body, headers) => {
      let payload;
      try {
        payload = decrypt(body);
      } catch {
        // Encrypted for a different test subscription.
      }
      sent.push({ endpoint, payload, headers });
      return send ? send(endpoint) : 'ok';
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, sent };
}

const notify = (base, body, headers = {}) =>
  fetch(base + NOTIFY_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('delivers an encrypted message payload with VAPID auth', async (t) => {
  const { base, sent } = await start(t);
  const res = await notify(base, { notification: notification() });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rejected: [] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
  assert.match(sent[0].headers.Authorization, /^vapid t=.+, k=/);
  assert.equal(sent[0].headers.Urgency, 'high');
  assert.deepEqual(sent[0].payload, {
    v: 1,
    kind: 'message',
    room_id: '!room:example',
    event_id: '$event',
    sender: '@alice:example',
    sender_name: 'Alice',
    room_name: 'Lounge',
    msgtype: 'm.text',
    body: 'hello there',
    unread: 2,
  });
});

test('encrypted events never carry a body; media carries only msgtype', async (t) => {
  const { base, sent } = await start(t);
  await notify(base, {
    notification: notification({ type: 'm.room.encrypted', content: { ciphertext: 'x' } }),
  });
  await notify(base, {
    notification: notification({ content: { msgtype: 'm.image', body: 'cat.png' } }),
  });
  assert.equal(sent[0].payload.kind, 'encrypted');
  assert.equal(sent[0].payload.body, undefined);
  assert.equal(sent[1].payload.msgtype, 'm.image');
  assert.equal(sent[1].payload.body, undefined);
});

test('long bodies are trimmed to fit one push record', async (t) => {
  const { base, sent } = await start(t);
  await notify(base, {
    notification: notification({
      room_name: 'r'.repeat(500),
      content: { msgtype: 'm.text', body: '🍉'.repeat(5000) },
    }),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(sent[0].payload)) <= MAX_PAYLOAD_BYTES);
  assert.equal(Array.from(sent[0].payload.room_name).length, 100);
});

test('rejects gone subscriptions, foreign app ids and bad endpoints; keeps transient failures', async (t) => {
  const { base, sent } = await start(t, (endpoint) =>
    endpoint.includes('gone') ? 'gone' : endpoint.includes('flaky') ? 'error' : 'ok'
  );
  // Distinct, valid subscription keys per device.
  const keys = new Map();
  const other = (n) => {
    if (!keys.has(n)) {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      keys.set(n, ecdh.getPublicKey().toString('base64url'));
    }
    return keys.get(n);
  };
  const res = await notify(base, {
    notification: notification({
      devices: [
        device({
          pushkey: other('aa'),
          data: { ...device().data, endpoint: 'https://fcm.googleapis.com/gone' },
        }),
        device({
          pushkey: other('bb'),
          data: { ...device().data, endpoint: 'https://fcm.googleapis.com/flaky' },
        }),
        device({ pushkey: other('cc'), app_id: 'im.vector.app' }),
        device({
          pushkey: other('dd'),
          data: { ...device().data, endpoint: 'https://evil.example/x' },
        }),
        device({ pushkey: 'not-a-key' }),
        device(),
      ],
    }),
  });
  const { rejected } = await res.json();
  assert.deepEqual(rejected.sort(), [other('aa'), other('cc'), other('dd'), 'not-a-key'].sort());
  assert.ok(sent.length >= 2);
});

test('badge-only notifications are acknowledged without a push', async (t) => {
  const { base, sent } = await start(t);
  const res = await notify(base, {
    notification: { counts: { unread: 0 }, devices: [device()] },
  });
  assert.deepEqual(await res.json(), { rejected: [] });
  assert.equal(sent.length, 0);
});

test('request validation', async (t) => {
  const { base, sent } = await start(t);
  assert.equal(
    (await notify(base, { notification: notification() }, { Origin: origin })).status,
    403
  );
  assert.equal(
    (await notify(base, { notification: notification() }, { Authorization: 'Bearer x' })).status,
    403
  );
  assert.equal((await notify(base, '{', {})).status, 400);
  assert.equal((await notify(base, { notification: { devices: 'x' } })).status, 400);
  assert.equal(
    (await notify(base, { notification: notification({ devices: Array(11).fill(device()) }) }))
      .status,
    400
  );
  assert.equal(
    (await notify(base, 'x'.repeat(80 * 1024), { 'Content-Type': 'application/json' })).status,
    413
  );
  assert.equal((await notify(base, '{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(base + NOTIFY_PATH)).status, 405);
  assert.equal((await fetch(base + '/_matrix/push/v1/other', { method: 'POST' })).status, 404);
  assert.equal(sent.length, 0);
});

test('serves the VAPID public key and notify URL', async (t) => {
  const { base } = await start(t);
  const res = await fetch(base + VAPID_PATH);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), {
    publicKey: vapid.publicKey,
    notifyUrl: origin + NOTIFY_PATH,
    appId: 'cinny.web',
  });
  assert.equal((await fetch(base + VAPID_PATH, { method: 'POST' })).status, 405);
});
