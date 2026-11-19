export const windowIds = [
  "login",
  "workspace",
  "reports",
  "data",
  "skills",
  "automations",
  "about",
] as const;
export type WindowId = (typeof windowIds)[number];
export type Position = { x: number; y: number };
export type WindowState = Position & {
  status: "open" | "closed" | "minimized";
};
export type DesktopState = {
  windows: Record<WindowId, WindowState>;
  order: WindowId[];
};
export type WindowAction =
  | {
      type: "open" | "close" | "minimize" | "focus";
      id: WindowId;
      compact?: boolean;
    }
  | { type: "move"; id: WindowId; position: Position }
  | { type: "reset"; width: number; height: number };

export function initialDesktop(width: number, height: number): DesktopState {
  const compact = width < 1200;
  const stageWidth = Math.min(width, 1680);
  const left = stageWidth > 1450 ? 180 : 126;
  const positions: Record<WindowId, Position> = {
    login: {
      x: compact ? Math.max(12, (width - 410) / 2) : stageWidth - 458,
      y: compact ? 20 : Math.max(20, (height - 720) / 2),
    },
    workspace: {
      x: compact ? 12 : left,
      y: compact ? 20 : width >= 1600 ? 236 : width > 1450 ? 220 : 182,
    },
    reports: {
      x: compact
        ? 12
        : left + (width <= 1450 ? 500 : width >= 1600 ? 620 : 286),
      y: compact
        ? 20
        : width >= 1600
          ? Math.max(300, height - 560)
          : width <= 1450
            ? Math.max(140, height - 510)
            : Math.min(420, height - 450),
    },
    data: { x: compact ? 12 : left + 60, y: compact ? 20 : 150 },
    skills: { x: compact ? 12 : left + 100, y: compact ? 20 : 180 },
    automations: { x: compact ? 12 : left + 140, y: compact ? 20 : 210 },
    about: { x: compact ? 12 : left + 80, y: compact ? 20 : 130 },
  };
  return {
    windows: Object.fromEntries(
      windowIds.map((id) => [
        id,
        {
          ...positions[id],
          status:
            id === "login" ||
            (!compact && (id === "workspace" || id === "reports"))
              ? "open"
              : "closed",
        },
      ]),
    ) as DesktopState["windows"],
    order: [
      "data",
      "skills",
      "automations",
      "about",
      "workspace",
      "reports",
      "login",
    ],
  };
}

export function clampPosition(
  position: Position,
  bounds: { width: number; height: number },
  size: { width: number; height: number },
): Position {
  return {
    x: Math.max(
      0,
      Math.min(position.x, Math.max(0, bounds.width - size.width)),
    ),
    y: Math.max(
      0,
      Math.min(position.y, Math.max(0, bounds.height - size.height)),
    ),
  };
}

export function desktopReducer(
  state: DesktopState,
  action: WindowAction,
): DesktopState {
  if (action.type === "reset")
    return initialDesktop(action.width, action.height);
  const current = state.windows[action.id];
  if (action.type === "move")
    return {
      ...state,
      windows: {
        ...state.windows,
        [action.id]: { ...current, ...action.position },
      },
    };
  if (action.type === "focus" && current.status !== "open") return state;
  const windows = { ...state.windows };
  if (action.type === "open" && action.compact) {
    for (const id of windowIds) {
      if (id !== "login" && id !== action.id && windows[id].status === "open")
        windows[id] = { ...windows[id], status: "minimized" };
    }
  }
  windows[action.id] = {
    ...current,
    status:
      action.type === "close"
        ? "closed"
        : action.type === "minimize"
          ? "minimized"
          : "open",
  };
  return {
    windows,
    order:
      action.type === "open" || action.type === "focus"
        ? [...state.order.filter((id) => id !== action.id), action.id]
        : state.order,
  };
}
