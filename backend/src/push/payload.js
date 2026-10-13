const NAME_CHARS = 100;
const BODY_CHARS = 640;
export const MAX_PAYLOAD_BYTES = 3000;
const TEXT_MSGTYPES = ['m.text', 'm.notice', 'm.emote'];

const clip = (value, chars) =>
  typeof value === 'string' && value ? Array.from(value).slice(0, chars).join('') : undefined;

const kindOf = (n) => {
  if (n.type === 'm.room.encrypted') return 'encrypted';
  if (n.type === 'm.room.message' || n.type === 'm.sticker') return 'message';
  if (n.type === 'm.room.member' && n.content?.membership === 'invite') return 'invite';
  return 'other';
};

/**
 * Turn a Matrix push gateway notification into the payload the service worker
 * renders. Returns undefined for event-less (badge-only) notifications, which
 * aren't forwarded: Safari revokes subscriptions that receive silent pushes.
 */
export function shapeNotification(n) {
  if (!n || typeof n !== 'object') return undefined;
  if (typeof n.event_id !== 'string' || typeof n.room_id !== 'string') return undefined;

  const kind = kindOf(n);
  const payload = {
    v: 1,
    kind,
    room_id: n.room_id,
    event_id: n.event_id,
    sender: clip(n.sender, 255),
    sender_name: clip(n.sender_display_name, NAME_CHARS),
    room_name: clip(n.room_name, NAME_CHARS),
  };
  if (kind === 'message') {
    const content = n.content && typeof n.content === 'object' ? n.content : {};
    const msgtype = n.type === 'm.sticker' ? 'm.sticker' : content.msgtype;
    if (typeof msgtype === 'string') payload.msgtype = clip(msgtype, 64);
    if (TEXT_MSGTYPES.includes(msgtype)) payload.body = clip(content.body, BODY_CHARS);
  }
  if (Number.isSafeInteger(n.counts?.unread)) payload.unread = n.counts.unread;
  return fitPayload(payload);
}

const size = (payload) => Buffer.byteLength(JSON.stringify(payload));

/** Shrink the body (then names) until the JSON fits in one push record. */
export function fitPayload(payload, maxBytes = MAX_PAYLOAD_BYTES) {
  const fitted = { ...payload };
  while (fitted.body && size(fitted) > maxBytes) {
    const chars = Array.from(fitted.body);
    fitted.body =
      chars.length > 1 ? chars.slice(0, Math.floor(chars.length / 2)).join('') : undefined;
  }
  if (size(fitted) > maxBytes) {
    fitted.room_name = clip(fitted.room_name, 32);
    fitted.sender_name = clip(fitted.sender_name, 32);
  }
  return fitted;
}
