import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Remember which pathname sits at each history index (react-router stores the
 * index in `history.state.idx`), so "back" UI can pop the history entry when
 * it leads where we want to go instead of pushing a new one.
 */
const pathnameByIndex = new Map<number, string>();

const currentIndex = (): number | undefined => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : undefined;
};

export const useRecordLocationHistory = () => {
  const location = useLocation();
  useEffect(() => {
    const idx = currentIndex();
    if (idx !== undefined) pathnameByIndex.set(idx, location.pathname);
  }, [location]);
};

export const getPreviousPathname = (): string | undefined => {
  const idx = currentIndex();
  return idx !== undefined && idx > 0 ? pathnameByIndex.get(idx - 1) : undefined;
};

const trimSlash = (path: string) => path.replace(/\/+$/, '');

export const isPreviousPathname = (pathname: string): boolean => {
  const previous = getPreviousPathname();
  return previous !== undefined && trimSlash(previous) === trimSlash(pathname);
};
