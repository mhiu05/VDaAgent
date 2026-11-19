# 0022 · UI from the built frontend, UX from the spec

- **Context.** Two sources describe the frontend:
  - the frontend already built in this repo, which runs on mock services and has its own visual system;
  - the PoC spec, which defines the product's flows and a Zalo/Telegram-style look.

  They disagree on stack, look, routes, the chat layout and the agent model.
- **Decision.**
  - **The look comes from the built frontend.** That covers design tokens, components, Radix overlays, Be Vietnam Pro, Lucide icons, GSAP motion, the SVG chart renderer, density and reduced-motion preferences, and the stack (React 19, plain CSS, i18next).
  - **The behaviour comes from the spec.** That covers routes and landing, username login, the agent team (lead, starters and user-created agents), the three-pane chat with its status line, task banner, choices and info pane, the builder, the folder viewer, the admin pages, SSE and the header theme toggle.
  - The workspace pages that only the built frontend has stay, with the backend described in [19](../19-reports-dashboard-notifications.md).
- **Rejected.**
  - Adopting the spec's stack and palette (React 18, Tailwind, shadcn/ui, TanStack Query, Zalo/Telegram tokens): it means rewriting working, tested UI.
  - Keeping the built chat as the target: it was designed around fixed agents, capabilities and streaming, which don't match the harness.
- **Consequences.** The chat, the login and the admin users page must change to reach the target. [14](../14-frontend.md#current-implementation-vs-target) lists every gap.
