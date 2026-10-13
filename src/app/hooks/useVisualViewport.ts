import { useEffect } from 'react';

// Height drop that counts as an on-screen keyboard rather than browser chrome.
const KEYBOARD_THRESHOLD = 150;

/**
 * Keep the app sized to the visible area. iOS (and Android without
 * `interactive-widget=resizes-content`) only shrink the visual viewport for the
 * on-screen keyboard, so a 100%-height layout ends up partly behind it.
 *
 * Sets `--app-height` on <html> and toggles `data-keyboard-open`.
 */
export const useVisualViewport = () => {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const root = document.documentElement;
    let { width, height: fullHeight } = vv;

    const update = () => {
      // Ignore pinch-zoom; only react to the viewport actually being resized.
      if (Math.abs(vv.scale - 1) > 0.01) return;
      if (Math.abs(vv.width - width) > 1) {
        // Rotation or window resize: start over.
        width = vv.width;
        fullHeight = vv.height;
      }
      fullHeight = Math.max(fullHeight, vv.height);
      const keyboardOpen = fullHeight - vv.height > KEYBOARD_THRESHOLD;

      root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
      root.toggleAttribute('data-keyboard-open', keyboardOpen);
      // iOS scrolls the (overflow: hidden) page to reveal the focused input;
      // the app is already resized, so undo that.
      if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--app-height');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);
};
