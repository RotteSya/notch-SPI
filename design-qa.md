# 3.0 answer shelf — native design QA

final result: passed

Scope: selected second concept, native AppKit answer layout and its capture-to-answer transition. This is not a website build or a claim of complete hardware acceptance.

## Visual target and evidence

- Source: `/Users/shelingzhao/.codex/generated_images/01a1398a-f98e-7fd1-a14e-5b2f8c77de3a/exec-45d3a358-4c1a-4d16-8055-939e71c939e6.png` (1487 × 1058).
- Implementation: `output/v3-answer-shelf/answer.png` (1288 × 448, Retina 2×, 644pt window including shadow margins, 600pt content panel).
- State: completed single-image answer, `B. 60 km/h`, dark notch surface.
- Source has desktop wallpaper around the concept; implementation is an app-window capture. Compared the panel content rather than wallpaper or hardware depiction. No CSS viewport applies. Source panel is approximately 1264px wide; native painted panel is 1200px. Comparison concerns native hierarchy/proportions, not a claimed pixel-exact screenshot clone.
- Source and native screenshot reopened together in one comparison input; then the corrected long answer was inspected in the same input. Separate long top/bottom screenshots verify padding and scrolling. No further focused crop was needed: the panel screenshots show readable text and all controls at full resolution.

## Required surfaces

- Typography: native system font, existing user-adjustable answer size, periwinkle answer label and large white conclusion. Long explanation uses matching 16pt left/right insets. User preferences remain authoritative over raster mock font sizes.
- Layout: one rounded shelf holds answer, separator, compact reference row. No large image ahead of the result. Four previews remain ordered and accessible. Long content scrolls above the reference row.
- Tokens: existing obsidian surface, accent theme, subtle 0.5pt shelf border and native rounded corners. Existing white/active-accent rose retained instead of substituting the concept's pink logo.
- Images: actual capture thumbnails in existing native image controls; no mock image baked into production. Aspect-fit retained.
- Copy: original status/quota, thinking control and gear preserved. They are intentionally present although the concept omits quota/effort. No new mandatory action or onboarding.

## Comparison history

1. Short completed panel: hierarchy matches the selected concept; existing functional header controls intentionally retained.
2. [P2] Long explanation initially touched the shelf edge (`long-top.png`). Fixed by applying shelf paragraph padding in the shared rendering/measurement path; added a regression.
3. Recaptured `long-fixed.png`, then scrolled to bottom (`long-bottom.png`, scrollbar value 1). Body aligns with answer, all content remains scrollable. No remaining P0/P1/P2 visual finding in inspected states.

## Interaction and motion

- Native screenshot preview opens from the compact thumbnail.
- Offline single-image replay captured waiting, readable partial answer, completed shelf, close and reopen. Existing screenshot flight reused; no new submission gate.
- Offline four-image replay shows original countdown and automatic submission, then four compact preview controls (`multi-*.png`).
- Reduce-motion long reading verified; original capture/timer/preview tests and hardware matrix pass in the 475-test suite (4 skipped).

Residual limits: no production model call, no real external-monitor unplug/lid-close in this run, no claim that window-only screenshots prove the physical camera cutout. Native geometry tests provide automated safety evidence. Existing opening/closing curves are preserved and connected to the new reference transition, not represented as newly rewritten physics.
