/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: any, baseUrl: any) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(clientId, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  return Promise.race([sessionPromise, timeout]);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    cleanupDeadClients();
  }
});

const MEDIA_PATHS = ['/_matrix/client/v1/media/download', '/_matrix/client/v1/media/thumbnail'];

function mediaPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return MEDIA_PATHS.some((p) => pathname.startsWith(p));
  } catch {
    return false;
  }
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  return MEDIA_PATHS.some((p) => {
    const validUrl = new URL(p, baseUrl);
    return url.startsWith(validUrl.href);
  });
}

function fetchConfig(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'default',
  };
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;
  if (!clientId) return;

  const session = sessions.get(clientId);
  if (session) {
    if (validMediaRequest(url, session.baseUrl)) {
      event.respondWith(fetch(url, fetchConfig(session.accessToken)));
    }
    return;
  }

  event.respondWith(
    requestSessionWithTimeout(clientId).then((s) => {
      if (s && validMediaRequest(url, s.baseUrl)) {
        return fetch(url, fetchConfig(s.accessToken));
      }
      return fetch(event.request);
    })
  );
});

/**
 * Web Push (see backend/src/push). Payload shape produced by the gateway.
 */
type PushPayload = {
  v: 1;
  kind: 'message' | 'encrypted' | 'invite' | 'other';
  room_id: string;
  event_id: string;
  sender?: string;
  sender_name?: string;
  room_name?: string;
  body?: string;
  msgtype?: string;
  unread?: number;
};

export type PushNotificationData = {
  roomId: string;
  eventId: string;
  kind: PushPayload['kind'];
};

const MEDIA_LABELS: Record<string, string> = {
  'm.image': 'sent an image',
  'm.video': 'sent a video',
  'm.audio': 'sent an audio message',
  'm.file': 'sent a file',
  'm.sticker': 'sent a sticker',
  'm.location': 'shared a location',
};

const assetUrl = (path: string) => new URL(path, self.registration.scope).href;

const parsePushPayload = (event: PushEvent): PushPayload | undefined => {
  try {
    const data = event.data?.json();
    if (
      data?.v === 1 &&
      typeof data.room_id === 'string' &&
      typeof data.event_id === 'string' &&
      typeof data.kind === 'string'
    )
      return data as PushPayload;
  } catch {
    // Not JSON; ignore.
  }
  return undefined;
};

const localpart = (userId?: string) => userId?.match(/^@([^:]+)/)?.[1];

const renderPush = (p: PushPayload): { title: string; body: string } => {
  const sender = p.sender_name ?? localpart(p.sender) ?? 'Someone';
  if (p.kind === 'invite') {
    return { title: 'Invitation', body: `${sender} invited you to ${p.room_name ?? 'a room'}` };
  }

  const title = p.room_name ?? sender;
  // In a DM the title already names the sender.
  const prefix = title === sender ? '' : `${sender}: `;
  if (p.kind === 'encrypted') return { title, body: `${prefix}Encrypted message` };
  if (p.body) {
    return { title, body: p.msgtype === 'm.emote' ? `* ${sender} ${p.body}` : prefix + p.body };
  }
  const media = p.msgtype && MEDIA_LABELS[p.msgtype];
  if (media) return { title, body: `${sender} ${media}` };
  return { title, body: `${prefix}New message` };
};

const hasFocusedClient = async (): Promise<boolean> => {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.some((c) => c.focused && c.visibilityState === 'visible');
};

self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePushPayload(event);
  if (!payload) return;

  event.waitUntil(
    (async () => {
      const { title, body } = renderPush(payload);
      const tag = `room:${payload.room_id}`;
      const data: PushNotificationData = {
        roomId: payload.room_id,
        eventId: payload.event_id,
        kind: payload.kind,
      };
      await self.registration.showNotification(title, {
        body,
        tag,
        // `renotify` isn't in the TS lib yet but is supported by Chromium.
        ...({ renotify: true } as NotificationOptions),
        icon: assetUrl('public/android/android-chrome-192x192.png'),
        badge: assetUrl('public/android/badge-96x96.png'),
        data,
      });

      // The open app already shows this; but browsers (Safari in particular)
      // revoke subscriptions whose pushes don't display a notification, so
      // show it and close it right away instead of skipping it.
      if (await hasFocusedClient()) {
        const shown = await self.registration.getNotifications({ tag });
        shown.forEach((n) => n.close());
      }
    })()
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as PushNotificationData | undefined;
  if (!data?.roomId) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = windows.find((c) => c.url.startsWith(self.registration.scope)) ?? windows[0];
      if (target) {
        const focused = await target.focus().catch(() => target);
        focused.postMessage({ type: 'openRoom', ...data });
        return;
      }
      // A document-level query works with both the browser and hash router.
      const url = new URL(self.registration.scope);
      url.searchParams.set('openRoom', data.roomId);
      url.searchParams.set('openEvent', data.eventId);
      if (data.kind === 'invite') url.searchParams.set('openKind', 'invite');
      await self.clients.openWindow(url.href);
    })()
  );
});

/**
 * Browsers may rotate the subscription. Resubscribe with the same VAPID key;
 * the app re-registers the pusher with the new keys on its next start (the
 * gateway rejects the stale pusher once the old subscription returns 410).
 */
type PushSubscriptionChangeEvent = ExtendableEvent & {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
};
self.addEventListener('pushsubscriptionchange', ((event: PushSubscriptionChangeEvent) => {
  event.waitUntil(
    (async () => {
      if (!event.newSubscription) {
        let applicationServerKey = event.oldSubscription?.options.applicationServerKey;
        if (!applicationServerKey) {
          const info = await fetch(new URL('/_cinny/push/vapid', self.registration.scope), {
            cache: 'no-store',
          })
            .then((r) => (r.ok ? r.json() : undefined))
            .catch(() => undefined);
          if (typeof info?.publicKey === 'string') applicationServerKey = info.publicKey;
        }
        if (applicationServerKey) {
          await self.registration.pushManager
            .subscribe({ userVisibleOnly: true, applicationServerKey })
            .catch(() => undefined);
        }
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windows.forEach((c) => c.postMessage({ type: 'pushSubscriptionChanged' }));
    })()
  );
}) as EventListener);
