/**
 * Optional Web Push gateway (backend/src/push), enabled at build time with
 * `VITE_PUSH_GATEWAY=true` (Nix: `enablePush = true`) and served on the
 * frontend's own origin.
 */

export const pushGatewayEnabled =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_PUSH_GATEWAY === 'true';

export type PushGatewayInfo = {
  publicKey: string;
  notifyUrl: string;
  appId: string;
};

const PUSH_GATEWAY_INFO_PATH = '/_cinny/push/vapid';

export const fetchPushGatewayInfo = async (): Promise<PushGatewayInfo | undefined> => {
  if (!pushGatewayEnabled) return undefined;
  try {
    const response = await fetch(PUSH_GATEWAY_INFO_PATH, {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'same-origin',
    });
    if (!response.ok) return undefined;
    // A misconfigured proxy may serve the SPA's index.html here.
    const info = (await response.json()) as Partial<PushGatewayInfo>;
    if (
      typeof info.publicKey !== 'string' ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(info.publicKey) ||
      typeof info.notifyUrl !== 'string' ||
      !info.notifyUrl.startsWith('https://') ||
      typeof info.appId !== 'string'
    )
      return undefined;
    return { publicKey: info.publicKey, notifyUrl: info.notifyUrl, appId: info.appId };
  } catch {
    return undefined;
  }
};
