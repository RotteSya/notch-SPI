import Foundation

/// Direct-API channel: when the user supplies their own API key, the capture is sent straight to
/// the vendor endpoint (Anthropic for "claude", OpenAI for "codex") instead of spawning the local
/// CLI. `CLIRunner` is untouched and remains the path whenever no key is set, so the two modes
/// coexist: key present → direct API, key empty → CLI fallback (decided per capture in
/// `NotchController.runTapped`).
enum APIKeyRunner {

    // MARK: - Request building (pure, testable)

    static let anthropicEndpoint = "https://api.anthropic.com/v1/messages"
    static let openAIEndpoint = "https://api.openai.com/v1/chat/completions"

    /// Build the streaming HTTP request for the chosen backend. The screenshot travels inline as
    /// base64 JPEG (ScreenCapture always writes JPEG), so no file paths leak to the vendor.
    static func makeRequest(
        cliId: String,
        apiKey: String,
        model: String,
        systemText: String,
        taskText: String,
        imageBase64: String
    ) -> URLRequest {
        let userText = "Analyze the attached screenshot image, then \(taskText)"
        var req: URLRequest
        let body: [String: Any]
        if cliId == "claude" {
            req = URLRequest(url: URL(string: anthropicEndpoint)!)
            req.setValue(apiKey, forHTTPHeaderField: "x-api-key")
            req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            body = [
                "model": model,
                "max_tokens": 8192,
                "stream": true,
                "system": systemText,
                "messages": [[
                    "role": "user",
                    "content": [
                        ["type": "image",
                         "source": ["type": "base64", "media_type": "image/jpeg", "data": imageBase64]],
                        ["type": "text", "text": userText],
                    ],
                ]],
            ]
        } else {
            req = URLRequest(url: URL(string: openAIEndpoint)!)
            req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            body = [
                "model": model,
                "stream": true,
                "messages": [
                    ["role": "system", "content": systemText],
                    ["role": "user", "content": [
                        ["type": "text", "text": userText],
                        ["type": "image_url",
                         "image_url": ["url": "data:image/jpeg;base64,\(imageBase64)"]],
                    ]],
                ],
            ]
        }
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 120
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return req
    }

    // MARK: - SSE parsing (pure, testable)

    /// The JSON payload of an SSE `data:` line, or nil for non-data lines (`event:`, blanks).
    static func sseData(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("data:") else { return nil }
        return String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
    }

    /// Text delta from one Anthropic Messages-API stream line (`content_block_delta` / `text_delta`).
    static func parseAnthropicDelta(_ line: String) -> String? {
        guard let obj = jsonObject(fromSSELine: line),
              obj["type"] as? String == "content_block_delta",
              let delta = obj["delta"] as? [String: Any],
              delta["type"] as? String == "text_delta",
              let text = delta["text"] as? String
        else { return nil }
        return text
    }

    /// Text delta from one OpenAI Chat Completions stream line (`choices[0].delta.content`).
    static func parseOpenAIDelta(_ line: String) -> String? {
        guard let payload = sseData(line), payload != "[DONE]" else { return nil }
        guard let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = obj["choices"] as? [[String: Any]],
              let delta = choices.first?["delta"] as? [String: Any],
              let text = delta["content"] as? String, !text.isEmpty
        else { return nil }
        return text
    }

    static func parseDelta(cliId: String, line: String) -> String? {
        cliId == "claude" ? parseAnthropicDelta(line) : parseOpenAIDelta(line)
    }

    /// An in-stream error event (both vendors can emit `{"error": {...}}` mid-stream).
    static func parseStreamError(_ line: String) -> String? {
        guard let obj = jsonObject(fromSSELine: line),
              let err = obj["error"] as? [String: Any],
              let msg = err["message"] as? String
        else { return nil }
        return msg
    }

    /// Human-readable message from a non-200 response body.
    static func errorMessage(from data: Data, statusCode: Int) -> String {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let err = obj["error"] as? [String: Any],
           let msg = err["message"] as? String {
            return "API 错误（HTTP \(statusCode)）：\(msg)"
        }
        let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty
            ? "API 错误（HTTP \(statusCode)）"
            : "API 错误（HTTP \(statusCode)）：\(String(text.prefix(300)))"
    }

    private static func jsonObject(fromSSELine line: String) -> [String: Any]? {
        guard let payload = sseData(line), payload != "[DONE]",
              let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }

    // MARK: - Run (streaming)

    /// Stream the answer via the vendor API. Mirrors `CLIRunner.run`'s contract: `onDelta` /
    /// `onDone` fire on the main queue, and a request-level 120s timeout guards a stalled stream.
    static func run(
        cliId: String,
        apiKey: String,
        imagePath: String,
        depth: String,
        mode: String,
        personaName: String,
        personaText: String,
        onDelta: @escaping (String) -> Void,
        onDone: @escaping (_ ok: Bool, _ stderr: String) -> Void
    ) {
        let sys = Prompts.systemText(mode: mode, depth: depth, personaName: personaName, personaText: personaText)
        let task = Prompts.taskInstruction(mode: mode)
        guard let imageData = FileManager.default.contents(atPath: imagePath) else {
            DispatchQueue.main.async { onDone(false, "无法读取截图文件") }
            return
        }
        let request = makeRequest(
            cliId: cliId, apiKey: apiKey,
            model: Settings.shared.apiModel(for: cliId),
            systemText: sys, taskText: task,
            imageBase64: imageData.base64EncodedString()
        )
        #if DEBUG
        print("[NotchSPI] direct API run \(cliId) → \(request.url?.host ?? "?")")
        #endif

        Task.detached(priority: .userInitiated) {
            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                guard let http = response as? HTTPURLResponse else {
                    await finish(onDone, ok: false, err: "无效的服务器响应")
                    return
                }
                if http.statusCode != 200 {
                    var body = Data()
                    for try await byte in bytes {
                        body.append(byte)
                        if body.count > 65_536 { break }
                    }
                    await finish(onDone, ok: false, err: errorMessage(from: body, statusCode: http.statusCode))
                    return
                }
                var streamError: String?
                for try await line in bytes.lines {
                    if let text = parseDelta(cliId: cliId, line: line) {
                        await MainActor.run { onDelta(text) }
                    } else if let err = parseStreamError(line) {
                        streamError = err
                        break
                    }
                }
                if let streamError {
                    await finish(onDone, ok: false, err: "API 流式响应中断：\(streamError)")
                } else {
                    await finish(onDone, ok: true, err: "")
                }
            } catch {
                await finish(onDone, ok: false, err: "网络请求失败：\(error.localizedDescription)")
            }
        }
    }

    private static func finish(
        _ onDone: @escaping (Bool, String) -> Void, ok: Bool, err: String
    ) async {
        await MainActor.run { onDone(ok, err) }
    }
}
