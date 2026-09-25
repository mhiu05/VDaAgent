# Sakura Signal design contract

Sakura Signal is an anime intelligence studio for a business analytics product. The interface uses clean cel-shaded character art and editorial framing around calm, readable data surfaces. Tables, charts, evidence, and report text remain plain and easy to inspect.

## Visual system

- Midnight indigo anchors navigation and high contrast surfaces; warm paper carries the workspace canvas; sakura coral marks primary actions; aqua signal marks active and successful work. Amber and crimson are reserved for warnings and errors.
- Use the semantic custom properties in `src/frontend/src/styles/tokens.css`. Feature styles should use those tokens instead of hard-coded colors.
- Be Vietnam Pro carries body and data UI, Bricolage Grotesque is reserved for display headings, and IBM Plex Mono is reserved for IDs, hashes, and code.
- Prefer clear edges, dividers, and restrained elevation. Use the three shared radii and avoid nested card framing, pill-heavy UI, gradients on charts, glass effects, and ambient glow.
- Manga cuts and character art belong in the hero or transition surfaces. Keep report text, tables, evidence payloads, and chart plotting areas quiet.

## VDa Navigator

VDa Navigator is an original adult data navigator: composed, observant, and approachable. Clothes are modest and workplace appropriate. The mascot never carries status by itself; visible labels and state icons remain the source of state meaning.

## Interaction and accessibility

- Preserve keyboard operation, visible focus, labels, landmarks, status announcements, and native dialog behavior.
- The mobile navigation uses a native modal dialog so browser focus containment, Escape, and focus restoration remain available.
- All meaningful status colors are paired with text or a shape/icon. Decorative mascot images use empty alternative text and are hidden from assistive technology.
- Respect `prefers-reduced-motion`; animation is short, stateful, and limited to opacity or transform.
- At narrow widths, keep 44px touch targets, allow long IDs to wrap, and let data tables scroll without covering the viewport.

## Motion and assets

Use local, self-hosted image assets. Do not add copied fan art, franchise marks, or text baked into illustrations. Keep hero imagery below 250 KB and small mascot assets below 50 KB. Asset provenance and state mapping live with the mascot source in `src/frontend/brand/mascot/README.md`.
