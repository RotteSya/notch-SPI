# Local interaction polish — 2026-10-31

Preserved the approved page layout, proportions, copy and hero lighting. No base added, dependency installation, system preference changes or deployment.

## Files changed in this pass
- `server/src/site-polish.ts`: measured word-width transition and clipped word entrance; keyboard focus on stage and pack controls; pointer/focus/press feedback on the comparison handle; disabled CTA hover suppression; pricing CTA feedback; FAQ focus and progressively enhanced height transitions. Reduced-motion rules cover the details-content pseudo-element as well.
- `server/src/site-continuation-script.ts`: measure the active word and resize its container; pause word cycling during comparison interaction; reset to the first word for reduced motion; update localized slider value descriptions, including zh-CN language tags.

## Browser verification
- 1440×1000 Chinese: keyboard arrows select all hero stages with visible focus; slider Home/End/ArrowLeft updates 0/100/99 and corresponding local/captured descriptions; selecting the 1,000-question pack opens the matching JPY 2200 purchase guidance; Enter collapses the purchase disclosure. All five FAQ summaries toggled with Enter, with focus visible. Privacy link opens its intended disclosure.
- Word transition: 10 captures; measured intermediate widths 113.77 → 87 → 70.73 → 67.98 → 66.59 → 65.90 → 65.63 px. The suffix follows the animated width; words are horizontally clipped during expansion so they do not overlap it.
- FAQ: 8 captures of expansion. Browser supports the progressive details-content height transition; snapshots sampled near its end, so these do not constitute a display-frame performance benchmark.
- 390×844 Chinese reduced-motion preview: answer remains selected, word and details transitions are both 0s; comparison remains operable. This uses the existing preview fixture, not an OS setting change.
- 768×1024 Japanese: no horizontal overflow, slider describes its percentage in Japanese.
- 320×800 English: pricing text wraps, no horizontal overflow or broken images.
- Browser warning/error log empty at the final check.

Evidence: `output/website-theater/detail-pass/` (keyboard-stage, comparison-focus, purchase, faq-keyboard, word and FAQ frame sequences, mobile-reduced, tablet-ja, narrow-en and final screenshots).

TypeScript, 27 website/demo/v3 tests, and diff whitespace checks passed. Downloads are existing links; native installation, real capture protection, model calls and payments were outside this website interaction check.

Repository quick verification passed: `output/verification/20261030T170026Z-50524/` (health, checker tests, shared generation, server/scheduler types and isolated smoke).
