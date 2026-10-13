/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';
import './app/styles/global.css';

import { trimTrailingSlash } from './app/utils/common';
import App from './app/pages/App';

// import i18n (needs to be bundled ;))
import './app/i18n';
import { pushSessionToSW } from './sw-session';
import { getFallbackSession } from './app/state/sessions';
import {
  consumeOpenRoomFromUrl,
  PUSH_SUBSCRIPTION_CHANGED_EVENT,
  requestOpenRoom,
} from './app/utils/pushNavigation';

document.body.classList.add(configClass, varsClass);

// Register Service Worker
if ('serviceWorker' in navigator) {
  const swUrl =
    import.meta.env.MODE === 'production'
      ? `${trimTrailingSlash(import.meta.env.BASE_URL)}/sw.js`
      : `/dev-sw.js?dev-sw`;

  const sendSessionToSW = () => {
    const session = getFallbackSession();
    pushSessionToSW(session?.baseUrl, session?.accessToken);
  };

  navigator.serviceWorker.register(swUrl).then(sendSessionToSW);
  navigator.serviceWorker.ready.then(sendSessionToSW);

  navigator.serviceWorker.addEventListener('message', (ev) => {
    const { type } = ev.data ?? {};

    if (type === 'requestSession') {
      sendSessionToSW();
    }
    if (type === 'openRoom' && typeof ev.data.roomId === 'string') {
      requestOpenRoom({
        roomId: ev.data.roomId,
        eventId: typeof ev.data.eventId === 'string' ? ev.data.eventId : undefined,
        invite: ev.data.kind === 'invite',
      });
    }
    if (type === 'pushSubscriptionChanged') {
      window.dispatchEvent(new Event(PUSH_SUBSCRIPTION_CHANGED_EVENT));
    }
  });
}

// A push notification click that had to open a new window.
consumeOpenRoomFromUrl();

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

mountApp();
