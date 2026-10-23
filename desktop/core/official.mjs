import { randomBytes, randomUUID } from "node:crypto";
import { version } from "../generated/product.mjs";
import {
  product,
  capturePrompt,
  contextTask,
  screenQueryClause,
  taskText,
  acceptsVersion,
} from "./product.mjs";
import {
  OfficialStream,
  SSEFramer,
  readJSON,
  validAccount,
  validSettlement,
} from "./stream.mjs";
export function serviceURL(value, development = false) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        development &&
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Use HTTPS, or explicit loopback in development");
  return url.href.replace(/\/$/, "");
}
export class OfficialClient {
  token = null;
  account = null;
  config = null;
  plus = null;
  registration = null;
  generation = 0;
  accountSync = { status: "idle", error: null, plusError: null };
  refreshing = null;
  constructor({ base, store, fetchImpl = fetch, development = false, onChange = () => {} }) {
    this.base = serviceURL(base, development);
    this.store = store;
    this.fetch = fetchImpl;
    this.onChange = onChange;
  }
  async initialize() {
    this.token = await this.store.get(`device:${this.base}`);
  }
  owner() {
    return `${this.generation}:${this.base}:${this.token}`;
  }
  apply(v, owner) {
    if (owner !== this.owner() || !validAccount(v)) return false;
    if (
      this.account?.balance_version &&
      !acceptsVersion(v.balance_version, this.account.balance_version)
    )
      return false;
    this.account = { ...this.account, ...v };
    return true;
  }
  async request(
    route,
    body,
    { token = this.token, signal, timeout = 12000 } = {},
  ) {
    const response = await this.fetch(this.base + route, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
      headers: {
        "Content-Type": "application/json",
        "x-app-version": version.APP_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await readJSON(response);
    if (!response.ok) {
      if (response.status === 401 && token === this.token) this.account = null;
      throw Object.assign(
        new Error(data.error?.message || `HTTP ${response.status}`),
        { status: response.status, code: data.error?.code },
      );
    }
    return data;
  }
  async register() {
    if (this.token) return this.token;
    if (this.registration) return this.registration;
    const owner = this.owner();
    const work = async () => {
      const key = `attempt:${this.base}`;
      let attempt = await this.store.get(key);
      if (!attempt) {
        attempt = randomBytes(32).toString("base64url");
        await this.store.set(key, attempt);
      }
      const v = await this.request("/v1/devices", {
        platform: process.platform === "win32" ? "windows" : "macos",
        app_version: version.APP_VERSION,
        registration_attempt_id: attempt,
      });
      if (owner !== this.owner()) throw new Error("Account changed");
      if (
        typeof v.device_token !== "string" ||
        !v.device_token.startsWith("dev_") ||
        !validAccount(v)
      )
        throw new Error("Invalid registration response");
      await this.store.set(`device:${this.base}`, v.device_token);
      this.token = v.device_token;
      this.account = v;
      this.acceptConfig(v.client_config);
      await this.store.set(key, null);
      return this.token;
    };
    this.registration = work();
    try {
      return await this.registration;
    } finally {
      this.registration = null;
    }
  }
  acceptConfig(v) {
    if (
      v?.schema_version === 1 &&
      [null, undefined, "objective_v1"].includes(
        v.objective_result_v1?.protocol,
      )
    )
      this.config = v;
  }
  refresh() {
    const generation = this.generation;
    if (this.refreshing?.generation === generation) return this.refreshing.promise;
    this.accountSync = { status: "loading", error: null, plusError: null };
    this.onChange();
    const promise = this.refreshAccount(generation).catch(error => {
      if (generation === this.generation) this.accountSync = { status: "error", error: error.message, plusError: null };
      throw error;
    }).finally(() => {
      if (this.refreshing?.promise === promise) this.refreshing = null;
      this.onChange();
    });
    this.refreshing = { generation, promise };
    return promise;
  }
  async refreshAccount(generation) {
    await this.register();
    if (generation !== this.generation) return;
    const owner = this.owner();
    const [account, config, plus] = await Promise.allSettled([
      this.request("/v1/account"), this.request("/v1/client-config"), this.request("/v1/plus"),
    ]);
    if (owner !== this.owner()) return;
    if (account.status === "rejected") throw account.reason;
    if (!validAccount(account.value)) throw new Error("Invalid account snapshot");
    this.apply(account.value, owner);
    if (config.status === "fulfilled") this.acceptConfig(config.value);
    const validPlus = plus.status === "fulfilled" && ["active", "inactive", "pending", "expired"].includes(plus.value.status);
    if (validPlus) this.plus = plus.value;
    this.accountSync = { status: "ready", error: null, plusError: validPlus ? null : (plus.reason?.message ?? "Invalid subscription snapshot") };
    return this.account;
  }
  async restore(token) {
    if (!/^dev_[A-Za-z0-9_-]{8,256}$/.test(token))
      throw new Error("Invalid recovery credential");
    const owner = this.owner(),
      v = await this.request("/v1/account", undefined, { token });
    if (owner !== this.owner() || !validAccount(v))
      throw new Error("Account changed or response invalid");
    await this.store.set(`device:${this.base}`, token);
    this.token = token;
    this.generation++;
    this.account = v;
    this.config = null;
    this.plus = null;
    await this.refresh();
    return v;
  }
  async claimTrial() {
    await this.register();
    const owner = this.owner();
    const v = await this.request("/v1/free-trial/claim", {});
    this.apply(v, owner);
    return this.refresh();
  }
  async freeze(images, settings, mode = "tutor", sessionContext = "") {
    await this.register();
    if (!this.config || !this.account) await this.refresh();
    if (
      !settings.allowPurchasedCredits &&
      this.account?.spending_policy_supported !== true
    )
      throw new Error(
        "Refresh account to confirm pack protection before asking",
      );
    const objective =
      mode !== "personality" &&
      this.config?.objective_result_v1?.protocol === "objective_v1";
    const screenQuery =
      objective &&
      this.config?.screen_query?.capabilities?.includes("screen_query_v1") &&
      this.config.screen_query.enabled_profiles?.includes("general");
    const prompt = capturePrompt({
      language: settings.language,
      objective,
      mode,
      persona: settings.persona,
      sessionContext,
    });
    if (images.length > 1 && mode === "tutor") prompt.task = contextTask;
    if (images.length < 1 || images.length > product.capture.limit)
      throw new Error("Capture 1–4 images");
    const id = randomUUID(),
      encoded = images.map((x) => x.base64);
    const body = {
      system: prompt.system + (screenQuery ? "\n" + screenQueryClause : ""),
      task: taskText(prompt.task, images.length),
      image_base64: encoded.at(-1),
      image_media_type: "image/jpeg",
      stream: true,
      capture_id: id,
      reasoning_effort: settings.reasoning,
    };
    if (!settings.allowPurchasedCredits) body.allow_purchased_credits = false;
    if (encoded.length > 1) body.images_base64 = encoded;
    if (objective) body.result_protocol = "objective_v1";
    if (screenQuery)
      Object.assign(body, {
        response_contract: "screen_query_v1",
        operation: "solve",
        profile_id: "general",
        profile_version: product.contractVersion,
        prompt_version: product.contractVersion,
        ui_language: settings.language,
        scope: {
          target_count: 1,
          question_image_index: encoded.length - 1,
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
      });
    if (Buffer.byteLength(JSON.stringify(body)) > product.capture.bodyLimit)
      throw new Error(
        "Images exceed the 4 MiB request limit; capture a smaller target",
      );
    return {
      id,
      body,
      owner: this.owner(),
      token: this.token,
      base: this.base,
      screenQuery: Boolean(screenQuery),
      objective,
      mode,
      createdAt: Date.now(),
      receipt: null,
      status: null,
    };
  }
  assertOwner(run) {
    if (
      run.owner !== this.owner() ||
      Date.now() - run.createdAt > product.capture.retentionSeconds * 1000
    )
      throw new Error("Capture expired or account changed; capture again");
  }
  async status(run) {
    this.assertOwner(run);
    const v = await this.request(`/v1/captures/${run.id}/status`, undefined, {
      token: run.token,
    });
    this.assertOwner(run);
    if (!(
      validSettlement(v, run.id) ||
      (v.capture_id === run.id &&
        v.settlement_status === "held" &&
        validAccount(v))
    ))
      throw new Error("Invalid settlement snapshot");
    this.apply(v, run.owner);
    run.status = v;
    return v;
  }
  async stream(
    run,
    { signal, onDelta, operation = "solve", finalAnswer } = {},
  ) {
    this.assertOwner(run);
    let id = run.id,
      body = structuredClone(run.body),
      route = "/v1/captures";
    if (operation !== "solve") {
      if (!run.screenQuery)
        throw new Error(
          "This service does not support result recovery/explanation",
        );
      if (
        operation === "recover" &&
        !(run.status?.can_recover ?? run.receipt?.can_recover)
      )
        throw new Error("Recovery is not available");
      if (operation === "explain" && !run.receipt?.explanation_available)
        throw new Error("Explanation is not available");
      id = randomUUID();
      route = `/v1/captures/${run.id}/${operation === "explain" ? "explanation" : "recovery"}`;
      body[operation === "explain" ? "explanation_id" : "recovery_id"] = id;
      if (operation === "explain") {
        body.final_answer = finalAnswer;
        if (run.answerID) body.answer_capture_id = run.answerID;
      }
    }
    const decoder = new OfficialStream(id, run.screenQuery, operation),
      framer = new SSEFramer();
    let reader;
    try {
      const response = await this.fetch(run.base + route, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([
          signal ?? new AbortController().signal,
          AbortSignal.timeout(110000),
        ]),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${run.token}`,
          "x-app-version": version.APP_VERSION,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const v = await readJSON(response);
        if (response.status === 401 && run.owner === this.owner())
          this.account = null;
        throw Object.assign(
          new Error(v.error?.message ?? `HTTP ${response.status}`),
          { status: response.status, code: v.error?.code },
        );
      }
      if (!response.headers.get("content-type")?.includes("text/event-stream"))
        throw new Error("Expected event stream");
      reader = response.body.getReader();
      outer: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.assertOwner(run);
        signal?.throwIfAborted();
        for (const payload of framer.feed(value)) {
          const event = decoder.accept(payload);
          if (event.type === "delta") onDelta?.(event.text);
          if (event.type === "usage") {
            this.apply(event, run.owner);
            if (operation !== "explain") run.receipt = event;
          }
          if (decoder.done) break outer;
        }
      }
      framer.finish();
      const receipt = decoder.finish();
      signal?.throwIfAborted();
      this.assertOwner(run);
      if (operation === "recover") run.answerID = id;
      return { raw: decoder.content, receipt };
    } catch (error) {
      // Never auto-replay a potentially charged POST. Metadata does not mean answer delivery.
      if (
        !signal?.aborted &&
        run.owner === this.owner() &&
        operation === "solve"
      ) {
        try {
          await this.status(run);
        } catch {}
      }
      throw error;
    } finally {
      await reader?.cancel().catch(() => {});
    }
  }
}
