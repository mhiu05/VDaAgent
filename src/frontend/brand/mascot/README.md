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

## State mapping

The current source portrait is reused to keep character identity consistent. `MascotAvatar` overlays a state-specific icon and uses a semantic token color; `AssistantPresence` also renders a Vietnamese state label and description. The contract supports `idle`, `thinking`, `analyzing`, `happy`, `success`, `warning`, `error`, `waiting`, and `report-ready` without using artwork as the sole status signal.

## Source prompt

> An original, reusable anime data navigator character portrait for a Vietnamese real-estate analytics workspace. A clearly adult woman in her late 20s with a calm, sharp, approachable expression; shoulder-length midnight-indigo hair with a small sakura-coral hair clip; warm brown eyes; modest tailored indigo jacket over a warm paper blouse with an aqua accent; holding a slim tablet. Transparent background, waist-up, centered, readable at avatar size. Clean cel-shaded anime editorial illustration with crisp line art and restrained flat colors. No text, numbers, logos, UI, watermark, franchise references, childlike proportions, school uniform, sexualized clothing, gradients, neon, or photorealism.
