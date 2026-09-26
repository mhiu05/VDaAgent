# VDa Navigator mascot assets

## Provenance

- Character: VDa Navigator, an original adult data navigator created for VDaAgent.
- Source artwork: `navigator-source.png`.
- Generator: OpenAI ImageGen, 2026-09-25. The source was generated from a text prompt with no reference image.
- Art direction: adult woman in modest indigo workwear, shoulder-length indigo hair, coral sakura clip, aqua accent, slim tablet; calm expression; clean cel shading; transparent background.
- No existing character, franchise, logo, or third-party image was supplied as a reference. The artwork contains no embedded copy or product logo.

## Runtime exports

| File | Use | Dimensions | Size |
| --- | --- | ---: | ---: |
| `/brand/mascot/navigator-hero.webp` | Login scene and workspace hero | 768 × 922 | 73,870 bytes |
| `/brand/mascot/navigator-avatar.webp` | Assistant avatar, cropped to the face | 256 × 256 | 13,290 bytes |

Four new transparent poses were generated on 2026-09-26 with the built-in OpenAI ImageGen edit workflow using only `navigator-hero.webp` as the character reference. The prompt preserved the adult analyst's face, indigo hair, coral flower pin, teal earrings and scarf, navy workwear, tablet, and cel-shaded style, then asked for a distinct calm gesture for each state. No third-party art was supplied. The generated PNGs in `poses/` are the source files; local Sharp exports keep alpha and are delivered through `next/image`.

- Art direction and generation: VDaAgent project / OpenAI ImageGen. Intended use: VDaAgent product UI and its documentation. The input is this project's original Navigator portrait; no separately licensed image or third-party character was used.
- Prompt set: each state requested an adult professional anime analyst matching the supplied Navigator reference, preserving the recognizable face, navy shoulder-length hair, coral flower hairpin, teal earrings, navy tailored blazer, cream blouse, teal scarf, slim tablet and premium cel-shaded linework. Welcome requested an open hand; progress requested attentive tablet reading; report-ready requested a calm pleased presentation gesture; recovery requested a reassuring next-step gesture. Every prompt required a genuine transparent background, waist-up framing, and no text, logos, watermark or additional people.

| State | Source | Full WebP | Small WebP | Placement |
| --- | --- | --- | --- | --- |
| Welcome/empty | `poses/welcome.png` | `navigator-welcome.webp` (73,886 B) | `navigator-welcome-small.webp` (15,768 B) | Dashboard hero; empty imports and automations |
| Persisted progress | `poses/progress.png` | `navigator-progress.webp` (72,226 B) | `navigator-progress-small.webp` (15,164 B) | Dashboard while a run is queued/running; loading |
| Report ready | `poses/report-ready.png` | `navigator-report-ready.webp` (73,752 B) | `navigator-report-ready-small.webp` (15,540 B) | Dashboard when a report exists |
| Recovery | `poses/recovery.png` | `navigator-recovery.webp` (71,626 B) | `navigator-recovery-small.webp` (15,206 B) | Dashboard load error; error boundary |

Full exports are 768 px wide and small exports 256 px wide. All are decorative (`alt=""`); adjacent Vietnamese copy states the actual status. Hide the large pose on data-dense surfaces and in print. On narrow screens the dashboard pose is reduced and subdued so text and controls have priority. Source prompts respectively specified an open-handed welcome, attentive tablet reading, a calm completed-report gesture, and a reassuring recovery gesture, all on genuine transparent backgrounds with no text, logos, or extra characters.

## State mapping

The current source portrait is reused to keep character identity consistent. `MascotAvatar` overlays a state-specific icon and uses a semantic token color; `AssistantPresence` also renders a Vietnamese state label and description. The contract supports `idle`, `thinking`, `analyzing`, `happy`, `success`, `warning`, `error`, `waiting`, and `report-ready` without using artwork as the sole status signal.

## Source prompt

> An original, reusable anime data navigator character portrait for a Vietnamese real-estate analytics workspace. A clearly adult woman in her late 20s with a calm, sharp, approachable expression; shoulder-length midnight-indigo hair with a small sakura-coral hair clip; warm brown eyes; modest tailored indigo jacket over a warm paper blouse with an aqua accent; holding a slim tablet. Transparent background, waist-up, centered, readable at avatar size. Clean cel-shaded anime editorial illustration with crisp line art and restrained flat colors. No text, numbers, logos, UI, watermark, franchise references, childlike proportions, school uniform, sexualized clothing, gradients, neon, or photorealism.
