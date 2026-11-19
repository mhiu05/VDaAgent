import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
// App journeys cross lazy route boundaries; allow the same five-second async render budget
// on a loaded Windows runner as on CI, while keeping the outer Vitest deadline bounded.
configure({ asyncUtilTimeout: 5000 });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
