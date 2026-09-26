# Midnight Signal design contract

Midnight Signal is a dark analysis studio for a business analytics product. Clean cel-shaded character art frames welcome and empty states. Tables, charts, evidence, and report text use quiet, stable surfaces.

## Visual system

- Navigation uses `#0b1021`, the canvas `#101527`, and content surfaces `#171d31` to `#273249`. Coral `#ff8da0` marks primary actions and selection; aqua `#79d6cf` marks active signals. Amber and crimson remain warnings and errors. The print palette returns to white paper and dark ink.
- Use the semantic custom properties in `src/frontend/src/styles/tokens.css`. Feature styles should use those tokens instead of hard-coded colors.
- `--color-on-accent` remains the existing light text token for dark navigation and hero surfaces; use `--color-on-action` for text and icons on a filled coral control.
- Be Vietnam Pro carries body and data UI, Bricolage Grotesque is reserved for display headings, and IBM Plex Mono is reserved for IDs, hashes, and code.
- Prefer clear edges, dividers, and restrained elevation. Dashboard metrics form one strip; recent activity uses rows with separators. Report, chart, evidence, and form surfaces remain flat. A single low-opacity moonlight glow is permitted in the dashboard hero or login story.
- Manga cuts and character art belong in the hero or transition surfaces. Keep report text, tables, evidence payloads, and chart plotting areas quiet.

### Contrast reference

| Foreground / background | Ratio | Use |
| --- | ---: | --- |
| Primary text `#f4f3f8` / canvas `#101527` | 16.4:1 | Body and headings |
| Secondary text `#d0d3e1` / surface `#171d31` | 11.2:1 | Supporting copy |
| Muted text `#a9b1c6` / raised surface `#1d263c` | 7.0:1 | Metadata |
| Coral `#ff8da0` / canvas `#101527` | 8.3:1 | Links and emphasis |
| Button ink `#201424` / coral `#ff8da0` | 8.1:1 | Primary controls |

These are calculated sRGB token pairs. Hover, focus, chart labels, disabled states, and browser rendering still require visual review.

## VDa Navigator

VDa Navigator is an original adult data navigator: composed, observant, and approachable. Clothes are modest and workplace appropriate. The mascot never carries status by itself; visible labels and state icons remain the source of state meaning.

The four new cutouts map to welcome, persisted run progress, report ready, and recovery. Dashboard art follows recorded summary state. Empty imports and automations use the small welcome export. Loading and error use small progress and recovery exports. Character art is decorative and leaves chart, evidence, report, and print content clear.

## Interaction and accessibility

- Preserve keyboard operation, visible focus, labels, landmarks, status announcements, and native dialog behavior.
- The mobile navigation uses a native modal dialog so browser focus containment, Escape, and focus restoration remain available.
- All meaningful status colors are paired with text or a shape/icon. Decorative mascot images use empty alternative text and are hidden from assistive technology.
- Respect `prefers-reduced-motion` in CSS and GSAP; animation is short, stateful, and limited to opacity or transform. CSS uses instant (80 ms), fast (140 ms), normal (240 ms), slow (420 ms), and cinematic (700 ms) tokens; cinematic motion is reserved for sparse hero surfaces.
- At narrow widths, keep 44px touch targets, allow long IDs to wrap, and let data tables scroll without covering the viewport.

## Motion and assets

Use local, self-hosted image assets. Do not add copied fan art, franchise marks, or text baked into illustrations. Keep hero imagery below 250 KB and small mascot assets below 50 KB. Asset provenance and state mapping live with the mascot source in `src/frontend/brand/mascot/README.md`.
