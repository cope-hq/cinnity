/**
 * Hand-off of "open this room" requests coming from push notification clicks,
 * either via a service worker message or via the URL of a freshly opened
 * window, to the React app once it's ready to navigate.
 */

/** Window event fired when the service worker rotated the push subscription. */
export const PUSH_SUBSCRIPTION_CHANGED_EVENT = 'cinny:pushsubscriptionchange';

export type OpenRoomRequest = {
  roomId: string;
  eventId?: string;
  invite?: boolean;
};

let pending: OpenRoomRequest | undefined;
const listeners = new Set<() => void>();

export const requestOpenRoom = (request: OpenRoomRequest) => {
  pending = request;
  listeners.forEach((listener) => listener());
};

export const takeOpenRoomRequest = (): OpenRoomRequest | undefined => {
  const request = pending;
  pending = undefined;
  return request;
};

export const subscribeOpenRoom = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Read and strip the `?openRoom=` parameters set by the service worker. */
export const consumeOpenRoomFromUrl = () => {
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get('openRoom');
  if (!roomId) return;
  requestOpenRoom({
    roomId,
    eventId: url.searchParams.get('openEvent') ?? undefined,
    invite: url.searchParams.get('openKind') === 'invite',
  });
  ['openRoom', 'openEvent', 'openKind'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(window.history.state, '', url.href);
};
