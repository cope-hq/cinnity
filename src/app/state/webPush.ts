import { atom } from 'jotai';

/**
 * Whether Web Push is active for this device. While it is, the in-app
 * `window.Notification` popups are skipped so notifications aren't doubled.
 */
export const webPushActiveAtom = atom(false);
