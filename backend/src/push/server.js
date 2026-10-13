import http from 'node:http';
import { readCapped } from '../network.js';
import { validateEndpoint } from './endpoint.js';
import { shapeNotification } from './payload.js';
import { vapidAuthorization } from './vapid.js';
import { encryptPayload, sendWebPush } from './webpush.js';

export const NOTIFY_PATH = '/_matrix/push/v1/notify';
export const VAPID_PATH = '/_cinny/push/vapid';
const BODY_CAP = 72 * 1024;
const MAX_DEVICES = 10;
const REQUEST_DEADLINE_MS = 20_000;

/**
 * Minimal Matrix push gateway (push gateway API v1) that delivers to browser
 * Web Push subscriptions. Pushers store the subscription as
 * `pushkey = keys.p256dh` and `data = { url, endpoint, auth }`.
 */
export function createPushServer({
  origin,
  vapid,
  appId = 'cinny.web',
  subject = origin,
  send = sendWebPush,
  concurrency = 16,
  now = Date.now,
}) {
  let active = 0;

  const deliver = async (device, payload, urgency) => {
    const { pushkey } = device;
    if (device.app_id !== appId) return false;
    const endpoint = validateEndpoint(device.data?.endpoint);
    if (!endpoint) return false;
    let body;
    try {
      body = encryptPayload(Buffer.from(JSON.stringify(payload)), {
        p256dh: pushkey,
        auth: device.data?.auth,
      });
    } catch {
      return false;
    }
    const result = await send(endpoint.href, body, {
      Authorization: vapidAuthorization(endpoint.href, vapid, subject, now()),
      Urgency: urgency,
    });
    // Only a definitive "subscription gone" removes the pusher; transient
    // failures are left for the next notification.
    return result !== 'gone';
  };

  const server = http.createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 10_000,
      headersTimeout: 5000,
      keepAliveTimeout: 1000,
    },
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; sandbox; frame-ancestors 'none'"
      );
      // No request/body/header/error logging: notifications carry message content.
      const json = (status, value = null) => {
        res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify(value));
      };
      if ('authorization' in req.headers || 'cookie' in req.headers) return json(403);

      if (req.url === VAPID_PATH) {
        if (req.method !== 'GET') return json(405);
        return json(200, { publicKey: vapid.publicKey, notifyUrl: origin + NOTIFY_PATH, appId });
      }
      if (req.url !== NOTIFY_PATH) return json(404);
      if (req.method !== 'POST') return json(405);
      // Homeservers don't send Origin; browsers always do on POST.
      if (req.headers.origin !== undefined) return json(403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || ''))
        return json(415);
      if (Number(req.headers['content-length']) > BODY_CAP) return json(413);
      if (active >= concurrency) return json(503);
      active++;
      const timer = setTimeout(() => {
        res.destroy();
        req.destroy();
      }, REQUEST_DEADLINE_MS);
      try {
        let notification;
        try {
          const input = JSON.parse((await readCapped(req, BODY_CAP)).toString('utf8'));
          notification = input?.notification;
          if (
            !notification ||
            typeof notification !== 'object' ||
            !Array.isArray(notification.devices) ||
            notification.devices.length > MAX_DEVICES ||
            !notification.devices.every(
              (d) => d && typeof d === 'object' && typeof d.pushkey === 'string'
            )
          )
            throw new Error();
        } catch {
          return json(400);
        }

        const payload = shapeNotification(notification);
        if (!payload) return json(200, { rejected: [] });
        const urgency = notification.prio === 'low' ? 'normal' : 'high';
        const results = await Promise.all(
          notification.devices.map((device) => deliver(device, payload, urgency))
        );
        const rejected = notification.devices
          .filter((_device, index) => !results[index])
          .map((device) => device.pushkey);
        json(200, { rejected });
      } catch {
        if (!res.destroyed && !res.headersSent) json(502);
        else res.destroy();
      } finally {
        clearTimeout(timer);
        active--;
      }
    }
  );
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  server.setTimeout(10_000, (socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('checkContinue', (_req, res) => {
    res.writeHead(417, { Connection: 'close' });
    res.end();
  });
  return server;
}
