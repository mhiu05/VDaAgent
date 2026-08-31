"use client";

import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  gsap.registerPlugin(ScrollTrigger);
}

type PublicMotionProps = { rootRef: RefObject<HTMLElement | null> };
type MotionConditions = { reduced: boolean; desktop: boolean };

export function PublicMotion({ rootRef }: PublicMotionProps) {
  useLayoutEffect(() => {
    const root = rootRef.current ?? document.querySelector<HTMLElement>(".pub-home-main");
    if (!root) return;

    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      media.add(
        { reduced: "(prefers-reduced-motion: reduce)", desktop: "(min-width: 901px)" },
        (mediaContext) => {
          const conditions = mediaContext.conditions as MotionConditions;
          const heroItems = root.querySelectorAll<HTMLElement>(".pub-hero-copy > *");
          const revealItems = root.querySelectorAll<HTMLElement>(".pub-features-section .pub-section-header, .pub-story-card, .pub-cta-panel");
          const visual = root.querySelector<HTMLElement>(".pub-hero-visual");
          const panel = root.querySelector<HTMLElement>(".pub-hero-panel");
          const cleanups: Array<() => void> = [];

          if (conditions.reduced) {
            gsap.set([...heroItems, ...revealItems], { clearProps: "all" });
            return;
          }

          const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
          intro.fromTo(heroItems, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.62, stagger: 0.08 });
          if (visual) {
            intro.fromTo(visual, { autoAlpha: 0, x: 24 }, { autoAlpha: 1, x: 0, duration: 0.8 }, "-=0.48");
          }

          if (conditions.desktop && visual && panel) {
            gsap.set(panel, { transformPerspective: 900, transformOrigin: "center center" });
            const toRotationX = gsap.quickTo(panel, "rotationX", { duration: 0.45, ease: "power3.out" });
            const toRotationY = gsap.quickTo(panel, "rotationY", { duration: 0.45, ease: "power3.out" });
            const reset = () => { toRotationX(0); toRotationY(0); };
            const move = (event: PointerEvent) => {
              const bounds = visual.getBoundingClientRect();
              const x = (event.clientX - bounds.left) / bounds.width - 0.5;
              const y = (event.clientY - bounds.top) / bounds.height - 0.5;
              toRotationY(x * 7);
              toRotationX(y * -5);
            };
            visual.addEventListener("pointermove", move, { passive: true });
            visual.addEventListener("pointerleave", reset);
            cleanups.push(() => {
              visual.removeEventListener("pointermove", move);
              visual.removeEventListener("pointerleave", reset);
            });
          }

          root.querySelectorAll<HTMLElement>(".pub-hero-orbit").forEach((orbit, index) => {
            gsap.to(orbit, { rotation: 360, duration: 34 + index * 5, repeat: -1, ease: "none" });
          });
          root.querySelectorAll<HTMLElement>(".pub-hero-sticker").forEach((sticker, index) => {
            gsap.to(sticker, { y: -7, rotation: "-=2", duration: 2.8 + index * 0.4, repeat: -1, yoyo: true, ease: "sine.inOut" });
          });
          if (root.querySelector<HTMLElement>(".pub-hero-mascot")) {
            gsap.to(root.querySelector<HTMLElement>(".pub-hero-mascot"), { y: -9, rotation: "-=3", duration: 2.4, repeat: -1, yoyo: true, ease: "sine.inOut" });
          }
          revealItems.forEach((element) => {
            gsap.fromTo(element, { autoAlpha: 0, y: 26 }, {
              autoAlpha: 1, y: 0, duration: 0.72, ease: "power3.out",
              scrollTrigger: { trigger: element, start: "top 86%", once: true },
            });
          });

          return () => cleanups.forEach((cleanup) => cleanup());
        },
        root,
      );
    }, root);

    return () => {
      media.revert();
      context.revert();
    };
  }, [rootRef]);

  return null;
}

/** Lightweight reveals for public content pages; selectors stay inside
 * .pub-content so Workspace routes are never affected. */
export function PublicPageMotion() {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(".pub-content");
    if (!root) return;

    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      media.add({
        reduced: "(prefers-reduced-motion: reduce)",
        motion: "(prefers-reduced-motion: no-preference)",
      }, (mediaContext) => {
        const reduced = Boolean((mediaContext.conditions as { reduced: boolean }).reduced);
        const heroItems = root.querySelectorAll<HTMLElement>(".pub-page-hero .pub-container > *");
        const revealItems = root.querySelectorAll<HTMLElement>(
          ".pub-section:not(.pub-page-hero) .pub-section-header, .pub-capability-card, .pub-glossary-grid article, .pub-status-list article, .pub-guide-step, .pub-principles-grid article, .pub-callout, .pub-architecture-flow > div, .pub-architecture-note, .pub-recap",
        );
        const allItems = [...heroItems, ...revealItems];
        if (reduced) {
          gsap.set(allItems, { clearProps: "all" });
          return;
        }
        gsap.fromTo(heroItems, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.62, stagger: 0.08, ease: "power3.out" });
        revealItems.forEach((element) => {
          gsap.fromTo(element, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.68, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 88%", once: true } });
        });
        return () => undefined;
      }, root);
    }, root);
    return () => { media.revert(); context.revert(); };
  }, []);
  return null;
}
