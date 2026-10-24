# Pinned Ghost renderer

MIT upstream: https://github.com/Jakubantalik/Libraries.dev
Revision: `bfcb86329da15235a5ee2dcdb6417c8a80f82bb1`
Original files: `packages/bot-avatars/src/{color,draw,engine,mesh,plastic,shapes,types,wear}.ts`.
These TypeScript files are unmodified. The generator erases types and resolves local `.mjs` imports; no network is needed at build/runtime after checkout.

`shared/ui/ghost-engine.mjs` is adapted to the **Swift port at that same revision**, which differs from the web engine: 0.5/0.45/1.4 second state transitions, 0.8 second wake-up, cubic non-sleep transitions, native wandering, winks, native jump recovery and 0.22-period hop exit, no web-only gaze lead. Multiplication for the seed uses exact UInt32 semantics (`Math.imul`). All 17 numeric pose fields and state weights are checked over 7,200 frames against the unchanged vendored Swift engine. Both shipping clients now consume this aligned JavaScript engine; the Swift engine remains the independent regression oracle.

`ghost-motion.mjs` owns NotchSPI's constrained header pose, thinking loop and completion envelope. `ghost.mjs` uses the pinned Canvas smooth-depth renderer; native Mac keeps BotAvatarsKit's existing SwiftUI Canvas renderer. Pixel rasterization remains platform-specific; pose equality is not a claim of pixel equality.
