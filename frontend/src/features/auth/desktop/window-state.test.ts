import { describe, expect, it } from "vitest";
import {
  clampPosition,
  desktopReducer,
  initialDesktop,
  windowIds,
} from "./window-state";

describe("private desktop window state", () => {
  it("keeps stacking bounded and unique across repeated focus and recovery", () => {
    let state = initialDesktop(1440, 900);
    for (let index = 0; index < 100; index++) {
      state = desktopReducer(state, { type: "open", id: "workspace" });
      state = desktopReducer(state, { type: "open", id: "login" });
    }
    expect(new Set(state.order).size).toBe(windowIds.length);
    expect(state.order.at(-1)).toBe("login");
    state = desktopReducer(state, { type: "close", id: "login" });
    state = desktopReducer(state, { type: "open", id: "login" });
    expect(state.windows.login.status).toBe("open");
  });
  it("opens one compact preview while retaining login and minimized preview state", () => {
    let state = initialDesktop(390, 844);
    expect(state.windows.workspace.status).toBe("closed");
    state = desktopReducer(state, {
      type: "open",
      id: "workspace",
      compact: true,
    });
    state = desktopReducer(state, {
      type: "open",
      id: "reports",
      compact: true,
    });
    expect(state.windows.workspace.status).toBe("minimized");
    expect(state.windows.reports.status).toBe("open");
    expect(state.windows.login.status).toBe("open");
    state = desktopReducer(state, { type: "open", id: "login", compact: true });
    expect(state.windows.reports.status).toBe("minimized");
  });
  it("constrains the whole window and handles a viewport smaller than its content", () => {
    expect(
      clampPosition(
        { x: -200, y: 2000 },
        { width: 1366, height: 624 },
        { width: 410, height: 580 },
      ),
    ).toEqual({ x: 0, y: 44 });
    expect(
      clampPosition(
        { x: 200, y: -30 },
        { width: 320, height: 400 },
        { width: 410, height: 580 },
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});
