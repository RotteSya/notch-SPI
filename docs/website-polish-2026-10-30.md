# Local website design pass — 2026-10-30

## Changes
- `server/src/site-polish.ts`: complete dark device stage in place of the white fade/cropped screen; balanced headline and controls; alternating image/text feature stories; clear pricing hierarchy, selected pack state and FAQ rhythm; narrow-screen buttons, Japanese phrase wrapping, focus styling and slider bounds.
- `server/src/site-demo.ts`: preserve stage time across pause/resume; suspend active CSS transitions while paused and resume them; retain final answer entrance.
- `server/test/site-demo.test.ts`: deterministic clock and remaining-time regression.
- `scripts/preview-site.mjs`: localhost-only `qa-motion=reduce` fixture to force the same reduced-motion CSS and script branches without changing OS/browser preferences, with recalculated CSP hash.

Existing working-tree changes preserved. No dependencies installed, no production changes, no deployment.

## Validation
- TypeScript passed. Website/demo/v3 tests: 26/26 passed. Diff whitespace check passed.
- Browser: 320×800 English, 390×844 Chinese, 768×1024 Japanese, 1440×1000 Chinese, 1920×1080 Chinese. Checked layout and images; no horizontal overflow at measured sizes. Japanese mid-word title break fixed and visually rechecked.
- Screenshot flight: 30 sequential captures over about 2.9 seconds; reviewed contact sheet, including appearance, travel, shrink and arrival. Answer entrance: 8 captured frames reviewed.
- Pause: computed flight transform identical in two observations, animation-play-state paused and data-paused=true.
- Reduced-motion preview fixture: answer selected, animation none and transition 0s; visual checked. This is branch testing, not OS-level preference emulation.
- Subscription CTA opens correct purchase guidance with CNY 69/month. No payment or download installation performed.
- Browser error/warning log empty at inspection.

## Evidence and limits
`output/website-theater/final-polish/`: desktop.jpg, hero.jpg, mobile.jpg, en-320.jpg, ja-768.jpg, wide.jpg, features.jpg, reduced.jpg, paused.jpg, motion-contact.jpg, answer-contact.jpg and individual frames with flight state JSON.

These are sampled frames, not a 60/120 fps hardware benchmark or proof of every display frame. Screenshots use existing offline native UI examples. Design quality is reviewable in the local page, not represented as an award or percentile certification.

Preview: http://127.0.0.1:4176/?lang=zh (watch mode). Stopped superseded previews started during this task on 4174/4175; original 4173 service left alone.

Repository quick verification also passed: `output/verification/20261030T111547Z-910/` (health, checker tests, shared generation, server/scheduler typecheck, isolated smoke).

## 2026-10-31 — hero composition correction
User requested the concept's large screen while keeping the notebook within the first viewport, with its lower metal body visible and no keyboard keys. Updated only the hero markup/presentation in site.ts and site-polish.ts: near edge-to-edge screen, viewport-dependent height, low-angle metallic base with front lip/opening recess, restrained background glow and restored working demo CTA. Real native answer imagery retained.

Visually checked 1435×789, 1366×768 and 390×844. At 1366×768 the metal base ends at y722 and controls at y767; horizontal overflow is zero. At 1435×789 the base ends at y743. Mobile base is visible at the bottom of the first viewport. Typecheck, 26 website/demo tests and diff whitespace checks passed. Evidence in output/website-theater/hero-notebook/. Local preview only, no deployment.

## 2026-10-31 — preserve notebook proportions
Replaced the preceding independently sized width/height with a fixed 16:10 display aspect ratio. Available viewport height now limits the device width proportionally; the desktop header, headline, copy and actions use less vertical space. Rebalanced the surrounding wallpaper light and rim glow. Only site-polish.ts and this record changed in this pass.

Browser checks: 1435×789 (ratio 1.6, base bottom 751.8), 1366×768 (ratio 1.60002 from subpixel rounding, base bottom 730.8), 1440×1000, 390×844 and Japanese 768×1024. The tested desktop bases stay in the first viewport; mobile also keeps natural proportions. No horizontal overflow at measured Chinese desktop/mobile widths. Captures: output/website-theater/hero-proportion/. Typecheck, 26 website/demo/v3 tests and whitespace checks passed. No deployment.


User rollback: restored the hero composition immediately before the fixed-16:10 proportion pass. The preserve-proportions section above describes the reverted experiment, not the current page.
