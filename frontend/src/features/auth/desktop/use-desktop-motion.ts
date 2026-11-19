import { type RefObject } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Owns decorative motion only. Authentication and window state never depend on it. */
export function useDesktopMotion(
  root: RefObject<HTMLDivElement | null>,
  reducedMotion: boolean,
) {
  useGSAP(
    () => {
      if (reducedMotion || !root.current) return;
      {
        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .from(".sd-wallpaper-art", { opacity: 0, scale: 1.06, duration: 1.4 })
          .from(".sd-system-bar", { opacity: 0, y: -12, duration: 0.6 }, 0.15)
          .from(
            ".sd-shortcut",
            { opacity: 0, y: 12, stagger: 0.07, duration: 0.5 },
            0.3,
          )
          .from(
            ".sd-hero > *",
            { opacity: 0, y: 12, stagger: 0.12, duration: 0.75 },
            0.45,
          )
          .from(".sd-dock", { opacity: 0, y: 28, duration: 0.7 }, 0.65)
          .from(".sd-insight-widget", { opacity: 0, y: 14, duration: 0.7 }, 1.1)
          .from(
            ".sd-window-login .sd-login-heading",
            { opacity: 0, y: 5, duration: 0.65 },
            1.55,
          );
      }
      const float = gsap.to(".sd-orbit-object", {
        y: -13,
        rotation: 4,
        duration: 9,
        stagger: 1.4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      const signals = gsap.to(".sd-network-signal", {
        strokeDashoffset: -120,
        duration: 5,
        repeat: -1,
        ease: "none",
      });
      const orbit = gsap.to(".sd-orbit-ring", {
        rotation: 8,
        transformOrigin: "50% 50%",
        duration: 16,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      const wallpaper = root.current.querySelector(".sd-wallpaper-art");
      const toX = gsap.quickTo(wallpaper, "x", {
        duration: 1.6,
        ease: "power3.out",
      });
      const toY = gsap.quickTo(wallpaper, "y", {
        duration: 1.6,
        ease: "power3.out",
      });
      const element = root.current;
      const move = (event: PointerEvent) => {
        if (
          event.pointerType !== "mouse" ||
          (element.contains(document.activeElement) &&
            document.activeElement?.tagName === "INPUT")
        )
          return;
        toX((event.clientX / window.innerWidth - 0.5) * 16);
        toY((event.clientY / window.innerHeight - 0.5) * 12);
      };
      const leave = () => {
        toX(0);
        toY(0);
      };
      const pause = () => {
        const active =
          !document.hidden && document.activeElement?.tagName !== "INPUT";
        for (const tween of [float, signals, orbit]) tween.paused(!active);
      };
      element.addEventListener("pointermove", move, { passive: true });
      element.addEventListener("pointerleave", leave);
      element.addEventListener("focusin", pause);
      element.addEventListener("focusout", pause);
      document.addEventListener("visibilitychange", pause);
      return () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerleave", leave);
        element.removeEventListener("focusin", pause);
        element.removeEventListener("focusout", pause);
        document.removeEventListener("visibilitychange", pause);
      };
    },
    { scope: root, dependencies: [reducedMotion], revertOnUpdate: true },
  );
}

export function useDockMotion(
  root: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
) {
  useGSAP(
    () => {
      if (!root.current || reducedMotion) return;
      const dock = root.current;
      const buttons = Array.from(
        dock.querySelectorAll<HTMLElement>("[data-dock-id]"),
      );
      const tweens = buttons.map((button) => ({
        scale: gsap.quickTo(button.querySelector(".sd-app-icon"), "scale", {
          duration: 0.25,
          ease: "power3.out",
        }),
        y: gsap.quickTo(button.querySelector(".sd-app-icon"), "y", {
          duration: 0.25,
          ease: "power3.out",
        }),
      }));
      const reset = () =>
        tweens.forEach((tween) => {
          tween.scale(1);
          tween.y(0);
        });
      const move = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        buttons.forEach((button, index) => {
          const box = button.getBoundingClientRect();
          const proximity = Math.max(
            0,
            1 - Math.abs(event.clientX - box.left - box.width / 2) / 110,
          );
          tweens[index].scale(1 + proximity * 0.28);
          tweens[index].y(-proximity * 7);
        });
      };
      dock.addEventListener("pointermove", move, { passive: true });
      dock.addEventListener("pointerleave", reset);
      return () => {
        dock.removeEventListener("pointermove", move);
        dock.removeEventListener("pointerleave", reset);
      };
    },
    { scope: root, dependencies: [reducedMotion], revertOnUpdate: true },
  );
}
