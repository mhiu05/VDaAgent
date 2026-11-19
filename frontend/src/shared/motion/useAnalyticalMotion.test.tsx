import { StrictMode, useRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gsap, useAnalyticalMotion } from "./useAnalyticalMotion";

const preference = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock("../../app/providers/PreferencesProvider", () => ({
  usePreferences: () => preference,
}));

function Surface({ identity }: { identity: string }) {
  const root = useRef<HTMLDivElement>(null);
  useAnalyticalMotion(root, identity);
  return <div ref={root}>Exact saved value: 60</div>;
}

function LateKpi() {
  const root = useRef<HTMLDivElement>(null);
  useAnalyticalMotion(root, "saved-metric", "dashboard");
  return (
    <div ref={root} data-motion-owner>
      <span data-motion="kpi">Saved KPI: 72</span>
    </div>
  );
}

function Dashboard({ ready }: { ready: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useAnalyticalMotion(root, "unchanged-version", "dashboard");
  return <div ref={root}>{ready && <LateKpi />}</div>;
}
afterEach(() => {
  preference.reducedMotion = false;
  vi.unstubAllGlobals();
});
function allowMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("no-preference"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
describe("analytical motion lifecycle", () => {
  it("animates a late-mounted KPI once within its owner and releases it on unmount", () => {
    allowMotion();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 10,
      bottom: 60,
      left: 0,
      right: 100,
      width: 100,
      height: 50,
      x: 0,
      y: 10,
      toJSON() {},
    });
    const view = render(
      <StrictMode>
        <Dashboard ready={false} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <Dashboard ready />
      </StrictMode>,
    );
    const element = view.getByText("Saved KPI: 72");
    expect(gsap.getTweensOf(element)).toHaveLength(1);
    const tween = gsap.getTweensOf(element)[0];
    view.rerender(
      <StrictMode>
        <Dashboard ready />
      </StrictMode>,
    );
    expect(gsap.getTweensOf(element)).toEqual([tween]);
    view.unmount();
    expect(gsap.getTweensOf(element)).toEqual([]);
    expect(element.style.transform).toBe("");
  });
  it("owns just one tween in StrictMode, skips ordinary rerenders and reverts on unmount", () => {
    allowMotion();
    const view = render(
      <StrictMode>
        <Surface identity="R001-v1" />
      </StrictMode>,
    );
    const element = view.getByText("Exact saved value: 60");
    const first = gsap.getTweensOf(element);
    expect(first).toHaveLength(1);
    view.rerender(
      <StrictMode>
        <Surface identity="R001-v1" />
      </StrictMode>,
    );
    expect(gsap.getTweensOf(element)[0]).toBe(first[0]);
    view.rerender(
      <StrictMode>
        <Surface identity="R001-v2" />
      </StrictMode>,
    );
    expect(gsap.getTweensOf(element)).toHaveLength(1);
    expect(gsap.getTweensOf(element)[0]).not.toBe(first[0]);
    view.unmount();
    expect(gsap.getTweensOf(element)).toEqual([]);
    expect(element.style.opacity).toBe("");
    expect(element.style.transform).toBe("");
  });
  it("restores all content immediately when the app preference changes mid-transition", () => {
    allowMotion();
    const view = render(<Surface identity="R001-v1" />);
    const element = view.getByText("Exact saved value: 60");
    expect(gsap.getTweensOf(element)).toHaveLength(1);
    preference.reducedMotion = true;
    act(() => view.rerender(<Surface identity="R001-v1" />));
    expect(gsap.getTweensOf(element)).toEqual([]);
    expect(element.style.opacity).toBe("");
    expect(element.textContent).toContain("60");
  });
  it("does not create an entrance tween with OS reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes(": reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const view = render(<Surface identity="R001-v1" />);
    expect(gsap.getTweensOf(view.getByText("Exact saved value: 60"))).toEqual(
      [],
    );
  });
});
