import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
} from "react";

const MIN_HEIGHT_PERCENT = 25;
const MAX_HEIGHT_PERCENT = 75;
const KEYBOARD_STEP_PERCENT = 5;

interface ResizeGesture {
  containerHeight: number;
  pointerId: number;
  startHeightPercent: number;
  startY: number;
}

interface ResizableSelectedFeaturesPanelProps {
  children: ReactNode;
  heightPercent: number;
  onHeightPercentChange: (heightPercent: number) => void;
}

function clampHeightPercent(heightPercent: number): number {
  return Math.min(
    MAX_HEIGHT_PERCENT,
    Math.max(MIN_HEIGHT_PERCENT, heightPercent),
  );
}

export function ResizableSelectedFeaturesPanel({
  children,
  heightPercent,
  onHeightPercentChange,
}: ResizableSelectedFeaturesPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const resizeGestureRef = useRef<ResizeGesture | null>(null);

  const startResize = (event: PointerEvent<HTMLHRElement>) => {
    const containerHeight =
      panelRef.current?.parentElement?.getBoundingClientRect().height ?? 0;
    if (containerHeight <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeGestureRef.current = {
      containerHeight,
      pointerId: event.pointerId,
      startHeightPercent: heightPercent,
      startY: event.clientY,
    };
  };

  const resize = (event: PointerEvent<HTMLHRElement>) => {
    const gesture = resizeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaPercent =
      ((gesture.startY - event.clientY) / gesture.containerHeight) * 100;
    onHeightPercentChange(
      clampHeightPercent(gesture.startHeightPercent + deltaPercent),
    );
  };

  const stopResize = (event: PointerEvent<HTMLHRElement>) => {
    if (resizeGestureRef.current?.pointerId === event.pointerId) {
      resizeGestureRef.current = null;
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLHRElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    onHeightPercentChange(
      clampHeightPercent(heightPercent + direction * KEYBOARD_STEP_PERCENT),
    );
  };

  return (
    <section
      ref={panelRef}
      className="selected-features-panel"
      aria-label="Selected features panel"
      style={{ height: `${heightPercent}%` }}
    >
      <hr
        aria-label="Resize selected features panel"
        aria-orientation="horizontal"
        aria-valuemax={MAX_HEIGHT_PERCENT}
        aria-valuemin={MIN_HEIGHT_PERCENT}
        aria-valuenow={heightPercent}
        className="selected-features-resize-handle"
        tabIndex={0}
        onKeyDown={resizeWithKeyboard}
        onPointerCancel={stopResize}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
      />
      {children}
    </section>
  );
}
