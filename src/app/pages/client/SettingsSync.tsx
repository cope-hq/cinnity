import React, { useCallback, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAccountDataCallback } from '../../hooks/useAccountDataCallback';
import { defaultSettings, Settings, settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import {
  getLocalNicknamesState,
  replaceLocalNicknames,
  useLocalNicknames,
} from '../../state/localNicknames';

/**
 * Keep settings and client-side nicknames in sync across the user's devices
 * through private (per-user, unencrypted) account data. Last writer wins: a
 * change from another device is applied as soon as it syncs, and local
 * changes are uploaded after a short debounce.
 */

const SETTINGS_EVENT = 'io.github.cope-hq.cinnity.settings';
const NICKNAMES_EVENT = 'io.github.cope-hq.cinnity.nicknames';
const UPLOAD_DELAY_MS = 1000;

// Settings that usually differ per device stay local.
const DEVICE_SETTINGS = new Set<keyof Settings>([
  'pageZoom',
  'isPeopleDrawer',
  'enterForNewline',
  'previewPreferenceVersion',
  'syncSettings',
]);
const SYNCED_KEYS = (Object.keys(defaultSettings) as (keyof Settings)[]).filter(
  (key) => !DEVICE_SETTINGS.has(key)
);
// Optional settings (e.g. theme ids) that are `undefined` by default.
const OPTIONAL_KEYS = new Set<keyof Settings>(['themeId', 'lightThemeId', 'darkThemeId']);

const pickSynced = (settings: Settings): Record<string, unknown> => {
  const synced: Record<string, unknown> = {};
  SYNCED_KEYS.forEach((key) => {
    if (settings[key] !== undefined) synced[key] = settings[key];
  });
  return synced;
};

/** Merge synced settings from account data, ignoring malformed values. */
const applySynced = (local: Settings, remote: unknown): Settings => {
  if (!remote || typeof remote !== 'object') return local;
  const content = remote as Record<string, unknown>;
  const next: Record<string, unknown> = { ...local };
  SYNCED_KEYS.forEach((key) => {
    const value = content[key];
    if (value === undefined) {
      if (OPTIONAL_KEYS.has(key)) next[key] = undefined;
      return;
    }
    // Optional keys hold strings when set.
    const reference = OPTIONAL_KEYS.has(key) ? '' : defaultSettings[key];
    if (typeof value === typeof reference) next[key] = value;
  });
  return next as unknown as Settings;
};

const accountData = (mx: MatrixClient, type: string): unknown =>
  mx.getAccountData(type as Parameters<MatrixClient['getAccountData']>[0])?.getContent();

const uploadAccountData = (mx: MatrixClient, type: string, content: object) =>
  mx.setAccountData(
    type as Parameters<MatrixClient['setAccountData']>[0],
    content as Parameters<MatrixClient['setAccountData']>[1]
  );

function SettingsAccountDataSync() {
  const mx = useMatrixClient();
  const [settings, setSettings] = useAtom(settingsAtom);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // JSON of what account data currently holds (as far as we know).
  const syncedRef = useRef<string>();

  const applyRemote = (content: unknown) => {
    const next = applySynced(settingsRef.current, content);
    syncedRef.current = JSON.stringify(pickSynced(next));
    if (JSON.stringify(pickSynced(settingsRef.current)) !== syncedRef.current) {
      setSettings(next);
    }
  };
  const applyRemoteRef = useRef(applyRemote);
  applyRemoteRef.current = applyRemote;

  // Initial state: account data is loaded before the client UI mounts.
  useEffect(() => {
    const remote = accountData(mx, SETTINGS_EVENT);
    if (remote) applyRemoteRef.current(remote);
  }, [mx]);

  useAccountDataCallback(
    mx,
    useCallback((event: MatrixEvent) => {
      if (event.getType() === SETTINGS_EVENT) applyRemoteRef.current(event.getContent());
    }, [])
  );

  useEffect(() => {
    const json = JSON.stringify(pickSynced(settings));
    if (json === syncedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      syncedRef.current = json;
      uploadAccountData(mx, SETTINGS_EVENT, JSON.parse(json)).catch(() => {
        // Retry with the next change.
        syncedRef.current = undefined;
      });
    }, UPLOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [mx, settings]);

  return null;
}

function NicknamesAccountDataSync() {
  const mx = useMatrixClient();
  const nicknames = useLocalNicknames();
  const syncedRef = useRef<string>();

  const applyRemote = useCallback((content: unknown) => {
    replaceLocalNicknames(content);
    syncedRef.current = JSON.stringify(getLocalNicknamesState());
  }, []);

  // Initial state: account data is loaded before the client UI mounts.
  useEffect(() => {
    const remote = accountData(mx, NICKNAMES_EVENT);
    if (remote) applyRemote(remote);
  }, [mx, applyRemote]);

  useAccountDataCallback(
    mx,
    useCallback(
      (event: MatrixEvent) => {
        if (event.getType() === NICKNAMES_EVENT) applyRemote(event.getContent());
      },
      [applyRemote]
    )
  );

  useEffect(() => {
    const json = JSON.stringify(nicknames);
    if (json === syncedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      syncedRef.current = json;
      uploadAccountData(mx, NICKNAMES_EVENT, JSON.parse(json)).catch(() => {
        syncedRef.current = undefined;
      });
    }, UPLOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [mx, nicknames]);

  return null;
}

export function SettingsSync() {
  const [syncSettings] = useSetting(settingsAtom, 'syncSettings');
  if (!syncSettings) return null;

  return (
    <>
      <SettingsAccountDataSync />
      <NicknamesAccountDataSync />
    </>
  );
}
