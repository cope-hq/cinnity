import { useSyncExternalStore } from 'react';

/**
 * Client-side nicknames for other users. Stored only in this browser's
 * localStorage and never sent to the homeserver.
 *
 * This is a plain external store rather than a jotai atom because
 * `getMemberDisplayName` (a non-hook util used all over the app) has to read it.
 */

const STORAGE_KEY = 'localNicknames';

type LocalNicknamesState = {
  enabled: boolean;
  nicknames: Record<string, string>;
};

const load = (): LocalNicknamesState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalNicknamesState>;
      const nicknames: Record<string, string> = {};
      if (parsed.nicknames && typeof parsed.nicknames === 'object') {
        Object.entries(parsed.nicknames).forEach(([userId, nick]) => {
          if (typeof nick === 'string' && nick.trim()) nicknames[userId] = nick.trim();
        });
      }
      return { enabled: parsed.enabled === true, nicknames };
    }
  } catch {
    // Fall through to defaults on unreadable storage.
  }
  return { enabled: false, nicknames: {} };
};

let state = load();
const listeners = new Set<() => void>();

const update = (next: LocalNicknamesState) => {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the in-memory value even if it can't be persisted.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getState = () => state;

export const getLocalNickname = (userId: string): string | undefined =>
  state.enabled ? state.nicknames[userId] : undefined;

export const setLocalNicknamesEnabled = (enabled: boolean) => {
  if (state.enabled !== enabled) update({ ...state, enabled });
};

/** Blank clears the nickname so the server-side name is used again. */
export const setLocalNickname = (userId: string, nickname: string) => {
  const nick = nickname.trim();
  if ((state.nicknames[userId] ?? '') === nick) return;
  const nicknames = { ...state.nicknames };
  if (nick) nicknames[userId] = nick;
  else delete nicknames[userId];
  update({ ...state, nicknames });
};

/**
 * Subscribe a component to nickname changes so names rendered through
 * `getMemberDisplayName` refresh when a nickname or the tweak changes.
 */
export const useLocalNicknames = (): LocalNicknamesState =>
  useSyncExternalStore(subscribe, getState);
