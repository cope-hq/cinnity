import { Dispatch, PointerEvent, SetStateAction, useMemo, useRef } from 'react';
import { Pan } from './usePan';

type Point = { x: number; y: number };

type TouchZoomOptions = {
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<Pan>>;
  min?: number;
  max?: number;
};

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Touch gestures for a `scale(zoom) translate(pan)` transformed element:
 * pinch to zoom, one-finger drag to pan while zoomed, double-tap to toggle 2x.
 * Spread the handlers on the gesture area and give it `touch-action: none`.
 */
export const useTouchZoom = ({ zoom, setZoom, setPan, min = 0.5, max = 5 }: TouchZoomOptions) => {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number; center: Point }>();
  const lastTap = useRef<{ time: number; point: Point }>();
  const moved = useRef(false);

  return useMemo(() => {
    const clamp = (z: number) => Math.min(max, Math.max(min, z));
    // `translate` comes after `scale`, so screen movement must be divided by zoom.
    const panBy = (dx: number, dy: number) =>
      setPan((p) => ({
        translateX: p.translateX + dx / zoomRef.current,
        translateY: p.translateY + dy / zoomRef.current,
      }));

    const startPinch = () => {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { distance: distance(a, b), zoom: zoomRef.current, center: midpoint(a, b) };
    };

    const end = (evt: PointerEvent) => {
      if (!pointers.current.delete(evt.pointerId)) return;
      if (pointers.current.size === 2) startPinch();
      else pinch.current = undefined;
      if (pointers.current.size === 0) {
        // Snap back to "fit" when the user pinched roughly back to it.
        setZoom((z) => (Math.abs(z - 1) < 0.08 ? 1 : z));
      }
    };

    return {
      onPointerDown: (evt: PointerEvent) => {
        if (evt.pointerType === 'mouse') return;
        evt.currentTarget.setPointerCapture?.(evt.pointerId);
        const point = { x: evt.clientX, y: evt.clientY };
        pointers.current.set(evt.pointerId, point);
        moved.current = false;
        if (pointers.current.size === 2) startPinch();
      },
      onPointerMove: (evt: PointerEvent) => {
        const previous = pointers.current.get(evt.pointerId);
        if (!previous) return;
        const point = { x: evt.clientX, y: evt.clientY };
        pointers.current.set(evt.pointerId, point);
        if (distance(previous, point) > 2) moved.current = true;

        if (pointers.current.size >= 2 && pinch.current) {
          const [a, b] = Array.from(pointers.current.values());
          const nextZoom = clamp((pinch.current.zoom * distance(a, b)) / pinch.current.distance);
          setZoom(nextZoom);
          zoomRef.current = nextZoom;
          const center = midpoint(a, b);
          panBy(center.x - pinch.current.center.x, center.y - pinch.current.center.y);
          pinch.current.center = center;
          return;
        }
        if (zoomRef.current > 1) panBy(point.x - previous.x, point.y - previous.y);
      },
      onPointerUp: (evt: PointerEvent) => {
        const wasSingle = pointers.current.size === 1;
        end(evt);
        if (!wasSingle || moved.current) return;
        const point = { x: evt.clientX, y: evt.clientY };
        const last = lastTap.current;
        if (
          last &&
          evt.timeStamp - last.time < DOUBLE_TAP_MS &&
          distance(last.point, point) < DOUBLE_TAP_SLOP
        ) {
          lastTap.current = undefined;
          setZoom((z) => (z === 1 ? 2 : 1));
          return;
        }
        lastTap.current = { time: evt.timeStamp, point };
      },
      onPointerCancel: end,
    };
  }, [setZoom, setPan, min, max]);
};
