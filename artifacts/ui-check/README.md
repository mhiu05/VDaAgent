# Midnight Signal visual check — 2026-09-26

Screenshots were captured in headless Chromium against the local Next development server. `*-login.png` shows the unauthenticated entry; `after-*-workspace.png` shows the final dashboard with the development owner role. The other route screenshots show the same role on `/chat`, `/runs`, `/reports`, `/data/imports`, and `/automations` at 1440, 390, and 320 px. `720-*`, `1024-*`, and `1280-*` cover dashboard and chat breakpoint transitions.

No tested viewport had document-level horizontal overflow or a browser page error. At 390 px, the mobile navigation dialog opened, closed with Escape, and returned focus to its trigger. Both owner and viewer saw their appropriate dashboard CTA; reduced-motion left the hero at full opacity with no transform. Print media resolved to a light color scheme and white paper background.

`pnpm --filter @vda/web typecheck`, `pnpm --filter @vda/web build`, `pnpm --filter @vda/web check:design-tokens`, and `pnpm lint` passed. The four full Navigator exports are 71–74 KB each; the small exports are 15–16 KB each.

These are implementation screenshots, not a pre-change baseline. The local seed had no completed runs or reports, so run and report detail, populated charts, evidence lineage, and CSV/JSON export were not visually exercised. LCP, CLS, interaction latency, and before/after bundle comparisons need an instrumented production baseline.
