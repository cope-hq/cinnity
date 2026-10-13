import { MouseEvent, PointerEvent, useCallback, useEffect, useMemo, useRef } from 'react';

type LongPressPoint = { x: number; y: number };
type LongPressOptions = {
  delay?: number;
  tolerance?: number;
  /** Skip presses starting on links/buttons/inputs inside the element. */
  ignoreInteractive?: boolean;
};

const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable="true"]';

/**
 * Touch long-press that opens the same menus a right-click does.
 *
 * iOS never fires `contextmenu` for a long-press, and on Android the native
 * long-press usually selects a word first (which our right-click handlers
 * treat as "the user is selecting text"). Spread the returned handlers on the
 * element that has the `onContextMenu` handler.
 */
export const useLongPress = (
  onLongPress: (point: LongPressPoint) => void,
  { delay = 500, tolerance = 10, ignoreInteractive = true }: LongPressOptions = {}
) => {
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const timerRef = useRef<number>();
  const startRef = useRef<LongPressPoint>();
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    startRef.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback(
    (point: LongPressPoint) => {
      cancel();
      firedRef.current = true;
      window.getSelection()?.removeAllRanges();
      navigator.vibrate?.(10);
      onLongPressRef.current(point);
    },
    [cancel]
  );

  return useMemo(
    () => ({
      onPointerDown: (evt: PointerEvent) => {
        if (evt.pointerType === 'mouse' || !evt.isPrimary) return;
        if (ignoreInteractive && (evt.target as Element).closest?.(INTERACTIVE)) return;
        firedRef.current = false;
        const point = { x: evt.clientX, y: evt.clientY };
        startRef.current = point;
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => fire(point), delay);
      },
      onPointerMove: (evt: PointerEvent) => {
        const start = startRef.current;
        if (!start) return;
        if (Math.hypot(evt.clientX - start.x, evt.clientY - start.y) > tolerance) cancel();
      },
      onPointerUp: cancel,
      // Fired when the browser takes over the gesture, e.g. to scroll.
      onPointerCancel: cancel,
      onContextMenuCapture: (evt: MouseEvent) => {
        // Android's own long-press: handle it here, before the selection check
        // in the regular right-click handler, and don't open the menu twice.
        const start = startRef.current;
        if (start) {
          evt.preventDefault();
          evt.stopPropagation();
          fire(start);
        } else if (firedRef.current) {
          evt.preventDefault();
          evt.stopPropagation();
        }
      },
      onClickCapture: (evt: MouseEvent) => {
        // Swallow the click that ends a long-press (e.g. so links don't open).
        if (!firedRef.current) return;
        firedRef.current = false;
        evt.preventDefault();
        evt.stopPropagation();
      },
    }),
    [cancel, fire, delay, tolerance, ignoreInteractive]
  );
};
