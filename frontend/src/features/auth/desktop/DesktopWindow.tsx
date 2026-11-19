import {
  useRef,
  useEffect,
  type ReactNode,
  type Dispatch,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Minus, X, GripHorizontal } from "lucide-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { DesktopIcon } from "./DesktopIcon";
import {
  clampPosition,
  type WindowAction,
  type WindowId,
  type WindowState,
} from "./window-state";

gsap.registerPlugin(useGSAP);

export function DesktopWindow({
  id,
  state,
  zIndex,
  active,
  dispatch,
  children,
  compact,
}: {
  id: WindowId;
  state: WindowState;
  zIndex: number;
  active: boolean;
  dispatch: Dispatch<WindowAction>;
  children: ReactNode;
  compact: boolean;
}) {
  const { t } = useTranslation("auth");
  const { reducedMotion } = usePreferences();
  const slot = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const isOpen = state.status === "open";
  const interactive = isOpen && (!compact || active);
  const title = t(`desktop_${id}`);

  useGSAP(
    () => {
      const target = surface.current;
      if (!target) return;
      if (isOpen) {
        target.dataset.opened = "true";
        gsap.fromTo(
          target,
          {
            opacity: reducedMotion ? 1 : 0,
            scale: reducedMotion ? 1 : 0.96,
            y: reducedMotion ? 0 : 18,
          },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            visibility: "visible",
            duration: reducedMotion ? 0 : 0.45,
            ease: "power3.out",
            clearProps: "transform",
          },
        );
      } else if (target.dataset.opened) {
        gsap.to(target, {
          opacity: 0,
          scale: reducedMotion ? 1 : state.status === "minimized" ? 0.85 : 0.97,
          y: reducedMotion ? 0 : state.status === "minimized" ? 44 : 12,
          duration: reducedMotion ? 0 : 0.22,
          ease: "power2.in",
          onComplete: () => {
            gsap.set(target, { visibility: "hidden" });
          },
        });
      } else gsap.set(target, { opacity: 0, visibility: "hidden" });
    },
    {
      scope: slot,
      dependencies: [isOpen, state.status, reducedMotion],
      revertOnUpdate: true,
    },
  );

  useEffect(() => {
    const element = slot.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const clamp = () => {
      const next = clampPosition(
        state,
        { width: parent.clientWidth, height: parent.clientHeight },
        { width: element.offsetWidth, height: element.offsetHeight },
      );
      if (next.x !== state.x || next.y !== state.y)
        dispatch({ type: "move", id, position: next });
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(parent);
    observer.observe(element);
    return () => observer.disconnect();
  }, [state, dispatch, id]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (
      compact ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".sd-window-controls")
    )
      return;
    const element = slot.current;
    if (!element) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: state.x,
      top: state.y,
    };
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const origin = drag.current;
    const element = slot.current;
    const parent = element?.parentElement;
    if (!origin || !element || !parent) return;
    const next = clampPosition(
      {
        x: origin.left + event.clientX - origin.x,
        y: origin.top + event.clientY - origin.y,
      },
      { width: parent.clientWidth, height: parent.clientHeight },
      { width: element.offsetWidth, height: element.offsetHeight },
    );
    gsap.set(element, { x: next.x - state.x, y: next.y - state.y });
  }
  function endDrag() {
    const element = slot.current;
    if (!drag.current || !element) return;
    const x = state.x + Number(gsap.getProperty(element, "x"));
    const y = state.y + Number(gsap.getProperty(element, "y"));
    drag.current = null;
    gsap.set(element, { clearProps: "transform" });
    dispatch({ type: "move", id, position: { x, y } });
  }
  function dismiss(type: "close" | "minimize") {
    dispatch({ type, id });
    document
      .querySelector<HTMLButtonElement>(`[data-dock-id="${id}"]`)
      ?.focus({ preventScroll: true });
  }
  return (
    <section
      ref={slot}
      className={`sd-window sd-window-${id}${active ? " is-active" : ""}`}
      style={{ left: state.x, top: state.y, zIndex }}
      data-window={id}
      data-status={state.status}
      aria-label={title}
      aria-hidden={!interactive}
      inert={!interactive}
      onPointerDown={() => dispatch({ type: "focus", id })}
      onFocusCapture={() => {
        if (!active) dispatch({ type: "focus", id });
      }}
    >
      <div className="sd-window-surface" ref={surface}>
        <header
          className="sd-titlebar"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <DesktopIcon id={id} small />
          <button
            type="button"
            className="sd-window-title"
            aria-label={`${title}. ${t("desktop_move")}`}
            onKeyDown={(event) => {
              if (
                compact ||
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const element = slot.current;
              const parent = element?.parentElement;
              if (!element || !parent) return;
              const step = event.shiftKey ? 40 : 12;
              dispatch({
                type: "move",
                id,
                position: clampPosition(
                  {
                    x:
                      state.x +
                      (event.key === "ArrowRight"
                        ? step
                        : event.key === "ArrowLeft"
                          ? -step
                          : 0),
                    y:
                      state.y +
                      (event.key === "ArrowDown"
                        ? step
                        : event.key === "ArrowUp"
                          ? -step
                          : 0),
                  },
                  { width: parent.clientWidth, height: parent.clientHeight },
                  { width: element.offsetWidth, height: element.offsetHeight },
                ),
              });
            }}
          >
            {title}
          </button>
          <GripHorizontal
            className="sd-drag-hint"
            size={15}
            aria-hidden="true"
          />
          <div className="sd-window-controls">
            <button
              type="button"
              onClick={() => dismiss("minimize")}
              aria-label={`${t("desktop_minimize")} ${title}`}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onClick={() => dismiss("close")}
              aria-label={`${t("desktop_close")} ${title}`}
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="sd-window-content">{children}</div>
      </div>
    </section>
  );
}
