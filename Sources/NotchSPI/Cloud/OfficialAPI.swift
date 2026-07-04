import Foundation

/// Lightweight error wrapper so `Result` can carry a user-facing message
/// (`String` itself doesn't conform to `Error`).
struct OfficialAPIError: Error, Equatable {
    let message: String
}

/// Client for the NotchSPI 官方按量计费服务 (pay-as-you-go). The server side holds the vendor
/// API keys, proxies the model call, meters tokens, and deducts balance; this client only
/// registers an anonymous device (granting trial credits), streams answers, and mirrors the
/// account state for the UI. The wire contract lives in docs/official-api.md.
///
/// This file is used ONLY by the `.official` service channel — the custom-key and CLI paths
/// (`APIKeyRunner`, `CLIRunner`) never touch it.
enum OfficialAPI {

    // MARK: - Configuration

    /// Production endpoint of the official service. Overridable via the "official.baseURL"
    /// default for staging/self-hosted deployments (no UI; `defaults write` only).
    static let defaultBaseURL = "https://api.notchspi.app"

    static var baseURL: String {
        var v = (UserDefaults.standard.string(forKey: "official.baseURL") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while v.hasSuffix("/") { v = String(v.dropLast()) } // avoid "https://host//v1/…"
        return v.isEmpty ? defaultBaseURL : v
    }

    /// Posted whenever balance / usage / registration state changes, so open panels refresh.
    static let accountDidChange = Notification.Name("OfficialAPI.accountDidChange")

    // MARK: - Local account state (UserDefaults-backed cache; the server is authoritative)

    private static var d: UserDefaults { .standard }

    static var deviceToken: String? {
        get {
            let v = d.string(forKey: "official.deviceToken") ?? ""
            return v.isEmpty ? nil : v
        }
        set {
            d.set(newValue ?? "", forKey: "official.deviceToken")
            notifyAccountChanged()
        }
    }

    /// Last balance reported by the server, in cents. nil = never synced.
    static var balanceCents: Int? {
        get { d.object(forKey: "official.balanceCents") as? Int }
        set {
            if let v = newValue { d.set(v, forKey: "official.balanceCents") }
            else { d.removeObject(forKey: "official.balanceCents") }
            notifyAccountChanged()
        }
    }

    static var currency: String {
        get { d.string(forKey: "official.currency") ?? "CNY" }
        set { d.set(newValue, forKey: "official.currency") }
    }

    static var totalInputTokens: Int { d.integer(forKey: "official.totalInputTokens") }
    static var totalOutputTokens: Int { d.integer(forKey: "official.totalOutputTokens") }

    /// Metered cost of the most recent capture, for the "完成 · 本次 ¥…" status line.
    /// UserDefaults-backed so the cross-thread write (stream task → main-queue read) is safe.
    static var lastCaptureCostCents: Int? {
        get { d.object(forKey: "official.lastCostCents") as? Int }
        set {
            if let v = newValue { d.set(v, forKey: "official.lastCostCents") }
            else { d.removeObject(forKey: "official.lastCostCents") }
        }
    }

    /// Fold one capture's metered usage into the local mirror (totals + balance snapshot).
    static func recordUsage(inputTokens: Int, outputTokens: Int, costCents: Int?, balanceCentsAfter: Int?) {
        d.set(totalInputTokens + max(0, inputTokens), forKey: "official.totalInputTokens")
        d.set(totalOutputTokens + max(0, outputTokens), forKey: "official.totalOutputTokens")
        lastCaptureCostCents = costCents
        if let b = balanceCentsAfter { d.set(b, forKey: "official.balanceCents") }
        notifyAccountChanged()
    }

    /// The server said our device token is no longer valid — drop the local account state so
    /// the UI falls back to the "初始化账户" path instead of dead-ending on generic errors.
    private static func handleInvalidToken() {
        d.set("", forKey: "official.deviceToken")
        d.removeObject(forKey: "official.balanceCents")
        notifyAccountChanged()
    }

    private static let invalidTokenMessage =
        "官方服务登录状态已失效。请打开齿轮菜单 →「账户与额度…」重新初始化账户（重新领取设备令牌）。"

    /// Guidance appended to unexpected official-service failures so novice users always have a way out.
    private static let fallbackHint = "\n\n如持续出现，可在齿轮菜单切换到「自定义 API Key」或「本机 CLI」模式继续使用。"

    private static func notifyAccountChanged() {
        if Thread.isMainThread {
            NotificationCenter.default.post(name: accountDidChange, object: nil)
        } else {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: accountDidChange, object: nil)
            }
        }
    }

    // MARK: - Pure helpers (testable)

    /// "¥12.34" / "$5.00" from server cents. Unknown currency falls back to the code itself.
    static func formatBalance(cents: Int?, currency: String) -> String {
        guard let cents else { return "—" }
        let symbol: String
        switch currency.uppercased() {
        case "CNY", "RMB": symbol = "¥"
        case "USD": symbol = "$"
        default: symbol = currency + " "
        }
        return String(format: "%@%.2f", symbol, Double(cents) / 100)
    }

    /// Resolved endpoint under the configured base. Never force-unwraps user input: a
    /// hand-typed `official.baseURL` override that doesn't parse falls back to the production
    /// default instead of crashing. Path components are appended WITHOUT a leading slash so a
    /// path-bearing base ("https://host/api") is preserved.
    static func endpointURL(base: String, path: String) -> URL {
        let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = URL(string: base) ?? URL(string: defaultBaseURL)! // default is a compile-time constant
        return url.appendingPathComponent(clean)
    }

    /// The web top-up page for this device (账户与额度面板的「充值」按钮). Appends to the
    /// base URL's path (same as the API endpoints) so self-hosted bases like
    /// "https://host/api" keep working.
    static func topUpURL(baseURL: String, deviceToken: String?) -> URL? {
        var comps = URLComponents(url: endpointURL(base: baseURL, path: "topup"), resolvingAgainstBaseURL: false)
        if let t = deviceToken, !t.isEmpty {
            comps?.queryItems = [URLQueryItem(name: "device", value: t)]
        }
        return comps?.url
    }

    /// One SSE line from the capture stream. The official service uses a small fixed event set.
    enum StreamEvent: Equatable {
        case delta(String)
        case usage(inputTokens: Int, outputTokens: Int, costCents: Int?, balanceCents: Int?)
        case error(String)
        case done
    }

    static func parseStreamLine(_ line: String) -> StreamEvent? {
        guard let payload = APIKeyRunner.sseData(line) else { return nil }
        if payload == "[DONE]" { return .done }
        guard let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        switch obj["type"] as? String {
        case "delta":
            guard let text = obj["text"] as? String else { return nil }
            return .delta(text)
        case "usage":
            return .usage(
                inputTokens: obj["input_tokens"] as? Int ?? 0,
                outputTokens: obj["output_tokens"] as? Int ?? 0,
                costCents: obj["cost_cents"] as? Int,
                balanceCents: obj["balance_cents"] as? Int
            )
        case "error":
            let err = obj["error"] as? [String: Any]
            return .error((err?["message"] as? String) ?? (obj["message"] as? String) ?? "未知错误")
        default:
            return nil
        }
    }

    static func makeRegisterRequest(baseURL: String, appVersion: String) -> URLRequest {
        var req = URLRequest(url: endpointURL(base: baseURL, path: "v1/devices"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "platform": "macos",
            "app_version": appVersion,
        ])
        return req
    }

    static func makeAccountRequest(baseURL: String, deviceToken: String) -> URLRequest {
        var req = URLRequest(url: endpointURL(base: baseURL, path: "v1/account"))
        req.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 30
        return req
    }

    static func makeCaptureRequest(
        baseURL: String, deviceToken: String,
        systemText: String, taskText: String, imageBase64: String
    ) -> URLRequest {
        var req = URLRequest(url: endpointURL(base: baseURL, path: "v1/captures"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 120
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "system": systemText,
            "task": "Analyze the attached screenshot image, then \(taskText)",
            "image_base64": imageBase64,
            "image_media_type": "image/jpeg",
            "stream": true,
        ])
        return req
    }

    // MARK: - Async operations

    /// Anonymous device registration — the onboarding "开箱即用" step. Grants trial credits
    /// server-side. Safe to call repeatedly: returns the existing token when already registered.
    @discardableResult
    static func registerIfNeeded() async -> Result<String, OfficialAPIError> {
        if let token = deviceToken { return .success(token) }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        let req = makeRegisterRequest(baseURL: baseURL, appVersion: version)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = obj["device_token"] as? String, !token.isEmpty
            else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                return .failure(OfficialAPIError(message: APIKeyRunner.errorMessage(from: data, statusCode: code)))
            }
            deviceToken = token
            if let b = obj["balance_cents"] as? Int { balanceCents = b }
            if let c = obj["currency"] as? String { currency = c }
            return .success(token)
        } catch {
            return .failure(OfficialAPIError(message: "无法连接官方服务：\(error.localizedDescription)"))
        }
    }

    /// Pull the authoritative balance + lifetime usage from the server.
    @discardableResult
    static func refreshAccount() async -> Result<Void, OfficialAPIError> {
        guard let token = deviceToken else { return .failure(OfficialAPIError(message: "尚未初始化官方服务账户")) }
        let req = makeAccountRequest(baseURL: baseURL, deviceToken: token)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            if code == 401 {
                handleInvalidToken()
                return .failure(OfficialAPIError(message: invalidTokenMessage))
            }
            guard code == 200,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                return .failure(OfficialAPIError(message: APIKeyRunner.errorMessage(from: data, statusCode: code)))
            }
            if let b = obj["balance_cents"] as? Int { balanceCents = b }
            if let c = obj["currency"] as? String { currency = c }
            // The server's lifetime totals are authoritative; overwrite the local mirror.
            if let ti = obj["total_input_tokens"] as? Int { d.set(ti, forKey: "official.totalInputTokens") }
            if let to = obj["total_output_tokens"] as? Int { d.set(to, forKey: "official.totalOutputTokens") }
            notifyAccountChanged()
            return .success(())
        } catch {
            return .failure(OfficialAPIError(message: "无法连接官方服务：\(error.localizedDescription)"))
        }
    }

    /// Stream one capture through the official service. Mirrors the other runners' contract:
    /// `onDelta` / `onDone` fire on the main queue. Metered usage from the stream's `usage`
    /// event updates the local balance mirror automatically.
    static func run(
        imagePath: String,
        depth: String,
        mode: String,
        personaName: String,
        personaText: String,
        onDelta: @escaping (String) -> Void,
        onDone: @escaping (_ ok: Bool, _ stderr: String) -> Void
    ) {
        guard let token = deviceToken else {
            DispatchQueue.main.async { onDone(false, "官方服务尚未初始化，请在「账户与额度…」中重试。") }
            return
        }
        let sys = Prompts.systemText(mode: mode, depth: depth, personaName: personaName, personaText: personaText)
        let task = Prompts.taskInstruction(mode: mode)
        lastCaptureCostCents = nil

        Task.detached(priority: .userInitiated) {
            // File read + base64 of a multi-MB screenshot stays off the main thread.
            guard let imageData = FileManager.default.contents(atPath: imagePath) else {
                await MainActor.run { onDone(false, "无法读取截图文件") }
                return
            }
            let request = makeCaptureRequest(
                baseURL: baseURL, deviceToken: token,
                systemText: sys, taskText: task,
                imageBase64: imageData.base64EncodedString()
            )
            #if DEBUG
            print("[NotchSPI] official API run → \(request.url?.host ?? "?")")
            #endif
            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                guard let http = response as? HTTPURLResponse else {
                    await MainActor.run { onDone(false, "无效的服务器响应") }
                    return
                }
                if http.statusCode != 200 {
                    var body = Data()
                    for try await byte in bytes {
                        body.append(byte)
                        if body.count > 65_536 { break }
                    }
                    switch http.statusCode {
                    case 402:
                        // The server said the balance is gone — mirror that so the billing
                        // gate blocks further official captures until a top-up.
                        balanceCents = 0
                        await MainActor.run {
                            onDone(false, "余额不足，本次未产生扣费。请在齿轮菜单 →「账户与额度…」充值，或切换到自定义 API Key / 本机 CLI 模式。")
                        }
                    case 401:
                        handleInvalidToken()
                        await MainActor.run { onDone(false, invalidTokenMessage) }
                    default:
                        let msg = APIKeyRunner.errorMessage(from: body, statusCode: http.statusCode) + fallbackHint
                        await MainActor.run { onDone(false, msg) }
                    }
                    return
                }
                var streamError: String?
                for try await line in bytes.lines {
                    switch parseStreamLine(line) {
                    case .delta(let text):
                        await MainActor.run { onDelta(text) }
                    case .usage(let input, let output, let cost, let balanceAfter):
                        recordUsage(inputTokens: input, outputTokens: output,
                                    costCents: cost, balanceCentsAfter: balanceAfter)
                    case .error(let message):
                        streamError = message
                    case .done, .none:
                        break
                    }
                    if streamError != nil { break }
                }
                if let streamError {
                    await MainActor.run { onDone(false, "官方服务返回错误：\(streamError)" + fallbackHint) }
                } else {
                    await MainActor.run { onDone(true, "") }
                }
            } catch {
                await MainActor.run { onDone(false, "网络请求失败：\(error.localizedDescription)") }
            }
        }
    }
}
