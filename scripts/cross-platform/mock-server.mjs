// Development entry only. This deterministic fixture is NOT image recognition.
// dev.mjs starts this process with an allowlisted environment and memory storage.
import { buildApp } from "../../server/src/index.ts";
if (
  process.env.DB_PATH !== ":memory:" ||
  process.env.HOST !== "127.0.0.1" ||
  process.env.OFFICIAL_PROVIDER !== "mock" ||
  process.env.PAYMENT_PROVIDER !== "stub"
)
  throw new Error("Mock server requires isolated development configuration");
const provider = {
  name: "mock",
  async stream(request, onDelta, signal) {
    const raw = request.system.includes("TARGET_PERSONA_DATA")
      ? '1. 当てはまる\nNSPI_CONTEXT_V1: {"last":{"ordinal":"1","summary":"Development fixture","choice":"当てはまる"},"referenceable":[]}'
      : 'FINAL: B. 60 km/h\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B. 60 km/h","reason":"none"}';
    for (const chunk of raw.match(/.{1,5}|\n/g)) {
      signal.throwIfAborted();
      onDelta(chunk);
      await new Promise((r) => setTimeout(r, 20));
    }
    return { inputTokens: 100, outputTokens: 30 };
  },
};
const server = await buildApp({ provider });
await server.listen({ host: "127.0.0.1", port: Number(process.env.PORT) });
const close = async () => {
  await server.close();
  process.exit();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
