"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface ResizeHandleProps {
  /** `vertical` = drag left/right to change column width. `horizontal` = drag up/down to change panel height. */
  orientation: "vertical" | "horizontal";
  /** Called with pixel delta (positive = grow the panel before this handle). */
  onResize: (delta: number) => void;
  label: string;
  className?: string;
}

export default function ResizeHandle({
  orientation,
  onResize,
  label,
  className = "",
}: ResizeHandleProps) {
  const [active, setActive] = useState(false);
  const lastPos = useRef(0);

  const endDrag = useCallback(() => {
    setActive(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    if (!active) return;

    function onPointerMove(event: PointerEvent) {
      const next =
        orientation === "vertical" ? event.clientX : event.clientY;
      const delta = next - lastPos.current;
      lastPos.current = next;
      if (delta !== 0) onResize(delta);
    }

    function onPointerUp() {
      endDrag();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [active, endDrag, onResize, orientation]);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    lastPos.current =
      orientation === "vertical" ? event.clientX : event.clientY;
    setActive(true);
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }

  const isVertical = orientation === "vertical";

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 8;
        if (isVertical) {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResize(-step);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onResize(step);
          }
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          onResize(-step);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onResize(step);
        }
      }}
      className={`group relative z-10 shrink-0 touch-none outline-none focus-visible:bg-accent/20 ${
        isVertical
          ? "w-1.5 cursor-col-resize hover:bg-accent/15"
          : "h-1.5 cursor-row-resize hover:bg-accent/15"
      } ${active ? "bg-accent/25" : "bg-transparent"} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-full bg-border transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent ${
          isVertical
            ? "top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2"
            : "top-1/2 left-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2"
        } ${active ? "bg-accent" : ""}`}
      />
    </div>
  );
}

export function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
