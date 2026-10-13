import { IPusherRequest, MatrixClient } from 'matrix-js-sdk';
import { PushGatewayInfo } from './pushGateway';

/**
 * Per-device Web Push registration: a browser PushSubscription plus the
 * matching Matrix HTTP pusher pointing at our push gateway.
 */

const STORAGE_KEY = 'cinny_web_push';

export type WebPushRecord = {
  userId: string;
  pushkey: string;
  appId: string;
  endpoint: string;
};

type WebPushPusher = Omit<IPusherRequest, 'data'> & {
  data: IPusherRequest['data'] & { endpoint: string; auth: string };
};

export const getWebPushRecord = (userId: string): WebPushRecord | undefined => {
  try {
    const record = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as WebPushRecord | null;
    return record?.userId === userId ? record : undefined;
  } catch {
    return undefined;
  }
};

const saveRecord = (record: WebPushRecord | undefined) => {
  if (record) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  else localStorage.removeItem(STORAGE_KEY);
};

export const webPushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iOS only allows Web Push for web apps added to the Home Screen. */
export const isIOSOutsideHomeScreen = (): boolean => {
  const ios =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
};

const btoaUrl = (buffer: ArrayBuffer): string => {
  let binary = '';
  new Uint8Array(buffer).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sameKey = (key: ArrayBuffer | null, publicKey: string): boolean =>
  !!key && btoaUrl(key) === publicKey;

const subscribe = async (info: PushGatewayInfo): Promise<PushSubscription> => {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, info.publicKey)) return existing;
  await existing?.unsubscribe();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: info.publicKey,
  });
};

const pusherFor = (
  subscription: PushSubscription,
  info: PushGatewayInfo
): WebPushPusher | undefined => {
  const p256dh = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');
  if (!p256dh || !auth) return undefined;
  return {
    kind: 'http',
    app_id: info.appId,
    pushkey: btoaUrl(p256dh),
    app_display_name: 'Cinny',
    device_display_name: navigator.userAgent.match(/\(([^;)]+)/)?.[1] ?? 'Browser',
    lang: navigator.language || 'en',
    data: {
      url: info.notifyUrl,
      brand: 'Cinny',
      endpoint: subscription.endpoint,
      auth: btoaUrl(auth),
    },
  };
};

const registerPusher = async (
  mx: MatrixClient,
  subscription: PushSubscription,
  info: PushGatewayInfo
): Promise<WebPushRecord> => {
  const pusher = pusherFor(subscription, info);
  if (!pusher) throw new Error('Browser returned an incomplete push subscription.');
  await mx.setPusher(pusher as IPusherRequest);
  const record: WebPushRecord = {
    userId: mx.getSafeUserId(),
    pushkey: pusher.pushkey,
    appId: info.appId,
    endpoint: subscription.endpoint,
  };
  saveRecord(record);
  return record;
};

/** Must be called from a user gesture (it may prompt for permission). */
export const enableWebPush = async (
  mx: MatrixClient,
  info: PushGatewayInfo
): Promise<WebPushRecord> => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const subscription = await subscribe(info);
  return registerPusher(mx, subscription, info);
};

export const disableWebPush = async (mx: MatrixClient): Promise<void> => {
  const record = getWebPushRecord(mx.getSafeUserId());
  saveRecord(undefined);
  if (record) await mx.removePusher(record.pushkey, record.appId).catch(() => undefined);
  if ('serviceWorker' in navigator) {
    // getRegistration() (unlike `ready`) doesn't hang without a service worker.
    const registration = await navigator.serviceWorker.getRegistration();
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  }
};

/**
 * Repair the registration on startup: the browser may have rotated or dropped
 * the subscription, or the homeserver may have deleted the pusher.
 */
export const syncWebPush = async (
  mx: MatrixClient,
  info: PushGatewayInfo
): Promise<WebPushRecord | undefined> => {
  const record = getWebPushRecord(mx.getSafeUserId());
  if (!record) return undefined;
  if (Notification.permission !== 'granted') {
    await disableWebPush(mx);
    return undefined;
  }

  const subscription = await subscribe(info);
  const pusher = pusherFor(subscription, info);
  if (!pusher) return record;

  const { pushers } = await mx.getPushers();
  const registered = pushers.some(
    (p) =>
      p.app_id === info.appId &&
      p.pushkey === pusher.pushkey &&
      (p.data as { endpoint?: string }).endpoint === subscription.endpoint
  );
  if (registered && record.pushkey === pusher.pushkey) return record;

  if (record.pushkey !== pusher.pushkey) {
    await mx.removePusher(record.pushkey, record.appId).catch(() => undefined);
  }
  return registerPusher(mx, subscription, info);
};
