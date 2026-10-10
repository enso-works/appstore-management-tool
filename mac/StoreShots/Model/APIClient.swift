import Foundation

/// An error the engine returned (`{ error, details }`), or a transport failure.
struct APIError: Error, LocalizedError, Sendable {
  let status: Int
  let message: String
  let details: [String]

  var errorDescription: String? {
    details.isEmpty ? message : "\(message): \(details.joined(separator: "; "))"
  }
}

/// The engine's JSON API on localhost (app/api in this repo).
struct APIClient: Sendable {
  let base: URL

  private static let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 600
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: c)
  }()

  func url(_ path: String, query: [String: String] = [:]) -> URL {
    var components = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
    return components.url!
  }

  /// `/api/projects/<name>/<rest>`.
  func project(_ name: String, _ rest: String = "") -> String {
    let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? name
    return rest.isEmpty ? "api/projects/\(encoded)" : "api/projects/\(encoded)/\(rest)"
  }

  /// GET, returning the raw body.
  func getData(_ path: String, query: [String: String] = [:]) async throws -> Data {
    try await send(URLRequest(url: url(path, query: query)))
  }

  func get(_ path: String, query: [String: String] = [:]) async throws -> JSONValue {
    try JSONValue.parse(try await getData(path, query: query))
  }

  func get<T: Decodable>(_ type: T.Type, _ path: String, query: [String: String] = [:]) async throws -> T {
    try JSONDecoder().decode(T.self, from: try await getData(path, query: query))
  }

  /// POST, PUT or DELETE with a JSON body, returning the parsed answer.
  @discardableResult
  func send(_ method: String, _ path: String, body: JSONValue = .object(JSONObject())) async throws -> JSONValue {
    var request = URLRequest(url: url(path))
    request.httpMethod = method
    request.httpBody = body.data
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    // The engine refuses cross-site writes; the app is same-origin.
    request.setValue(base.absoluteString.trimmingCharacters(in: ["/"]), forHTTPHeaderField: "origin")
    let data = try await send(request)
    return data.isEmpty ? .null : try JSONValue.parse(data)
  }

  /// POST returning the raw body and headers (previews are HTML).
  func post(_ path: String, body: JSONValue) async throws -> (Data, HTTPURLResponse) {
    var request = URLRequest(url: url(path))
    request.httpMethod = "POST"
    request.httpBody = body.data
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    let (data, response) = try await Self.session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError(status: 0, message: "no answer", details: []) }
    guard (200..<300).contains(http.statusCode) else { throw Self.error(from: data, status: http.statusCode) }
    return (data, http)
  }

  /// Server-sent events from a POST: each `event:` with its parsed `data:`.
  func events(_ path: String, body: JSONValue) -> AsyncThrowingStream<(String, JSONValue), Error> {
    var request = URLRequest(url: url(path))
    request.httpMethod = "POST"
    request.httpBody = body.data
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    let sent = request
    return AsyncThrowingStream { continuation in
      let task = Task { @Sendable in
        do {
          let (bytes, response) = try await Self.session.bytes(for: sent)
          if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            var data = Data()
            for try await b in bytes { data.append(b) }
            throw Self.error(from: data, status: http.statusCode)
          }
          var event = "message"
          for try await line in bytes.lines {
            if line.hasPrefix("event: ") {
              event = String(line.dropFirst(7))
            } else if line.hasPrefix("data: ") {
              continuation.yield((event, (try? JSONValue.parse(String(line.dropFirst(6)))) ?? .null))
              event = "message"
            }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Newline-delimited JSON from a POST (fastlane lanes), each line parsed as it arrives.
  func lines(_ path: String, body: JSONValue) -> AsyncThrowingStream<JSONValue, Error> {
    var request = URLRequest(url: url(path))
    request.httpMethod = "POST"
    request.httpBody = body.data
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue(base.absoluteString.trimmingCharacters(in: ["/"]), forHTTPHeaderField: "origin")
    let sent = request
    return AsyncThrowingStream { continuation in
      let task = Task { @Sendable in
        do {
          let (bytes, response) = try await Self.session.bytes(for: sent)
          if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            var data = Data()
            for try await b in bytes { data.append(b) }
            throw Self.error(from: data, status: http.statusCode)
          }
          for try await line in bytes.lines {
            if let v = try? JSONValue.parse(line) { continuation.yield(v) }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  private func send(_ request: URLRequest) async throws -> Data {
    let (data, response) = try await Self.session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError(status: 0, message: "no answer", details: []) }
    guard (200..<300).contains(http.statusCode) else { throw Self.error(from: data, status: http.statusCode) }
    return data
  }

  private static func error(from data: Data, status: Int) -> APIError {
    let body = try? JSONValue.parse(data)
    return APIError(
      status: status,
      message: body?["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: status),
      details: body?["details"]?.array?.compactMap(\.string) ?? []
    )
  }
}
