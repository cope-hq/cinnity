import { isIP } from 'node:net';

// Only known browser push services: the endpoint comes from the pusher data,
// so anything else would let the gateway be pointed at arbitrary hosts.
const PUSH_SERVICES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username ||
    url.password ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    !PUSH_SERVICES.some((service) => host === service || host.endsWith(`.${service}`))
  )
    return undefined;
  return url;
}
