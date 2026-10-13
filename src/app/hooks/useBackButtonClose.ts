import { useEffect, useRef } from 'react';
import { ScreenSize, useScreenSizeContext } from './useScreenSize';

let nextOverlayId = 0;

/**
 * On mobile, let the system back button (Android back / back gesture) close a
 * full-screen overlay instead of navigating the page underneath it.
 *
 * Pushes a history entry while `open`; going back closes the overlay, and
 * closing it from the UI removes the entry again.
 */
export const useBackButtonClose = (open: boolean, requestClose: () => void) => {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  // Callers usually pass an inline callback; don't re-push history for it.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!open || !mobile) return undefined;
    nextOverlayId += 1;
    const overlayId = nextOverlayId;
    const isOurEntry = () =>
      (window.history.state as { cinnyOverlay?: number } | null)?.cinnyOverlay === overlayId;

    // Keep react-router's state (including its index) so it treats popping
    // this entry as staying on the same location.
    window.history.pushState({ ...window.history.state, cinnyOverlay: overlayId }, '');

    let closedByBack = false;
    const handlePopState = () => {
      if (isOurEntry()) return;
      closedByBack = true;
      requestCloseRef.current();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Closed from the UI: drop our entry, but never undo a real navigation.
      if (!closedByBack && isOurEntry()) window.history.back();
    };
  }, [open, mobile]);
};
