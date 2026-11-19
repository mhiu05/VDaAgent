import type { RefObject } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { usePreferences } from "../../app/providers/PreferencesProvider";

gsap.registerPlugin(useGSAP);

/** Seconds, shared by the analytical surfaces. No motion state enters saved data. */
export const analyticalMotion = {
  feedback: 0.12,
  content: 0.22,
  reveal: 0.26,
  chart: 0.34,
  stagger: 0.035,
  ease: "power2.out",
} as const;

function inViewport(element: Element) {
  const box = element.getBoundingClientRect();
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.top < window.innerHeight &&
    box.bottom > 0
  );
}

/** PreferencesProvider owns the live OS listener; a read here also protects first paint.
 * Per-panel GSAP matchMedia contexts retain MediaQueryList listeners in pinned 3.15.0.
 * Keep animation ownership in useGSAP and media-listener ownership in the provider.
 */
export function analyticalMotionAllowed(reducedMotion: boolean) {
  return (
    !reducedMotion &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Component-owned context; dependency changes revert superseded effects, including StrictMode. */
export function useAnalyticalMotion(
  scope: RefObject<HTMLElement | null>,
  identity: string,
  kind: "content" | "dashboard" = "content",
) {
  const { reducedMotion } = usePreferences();
  useGSAP(
    () => {
      if (!scope.current || !analyticalMotionAllowed(reducedMotion)) return;
      if (kind === "content") {
        gsap.fromTo(
          scope.current,
          { opacity: 0.65, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: analyticalMotion.content,
            ease: analyticalMotion.ease,
            clearProps: "opacity,transform",
          },
        );
      } else {
        const elements = [
          ...scope.current.querySelectorAll<HTMLElement>("[data-motion]"),
        ].filter((element) => {
          const owner = element.closest("[data-motion-owner]");
          return (!owner || owner === scope.current) && inViewport(element);
        });
        if (elements.length)
          gsap.timeline({ defaults: { ease: analyticalMotion.ease } }).fromTo(
            elements,
            { opacity: 0.6, y: 8 },
            {
              opacity: 1,
              y: 0,
              duration: analyticalMotion.reveal,
              stagger: {
                each: analyticalMotion.stagger,
                amount: Math.min(
                  0.14,
                  elements.length * analyticalMotion.stagger,
                ),
              },
              clearProps: "opacity,transform",
            },
          );
      }
    },
    {
      scope,
      dependencies: [identity, reducedMotion, kind],
      revertOnUpdate: true,
    },
  );
}

export { gsap, useGSAP };
