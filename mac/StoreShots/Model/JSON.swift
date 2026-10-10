import Foundation

/// A JSON value that keeps the order of object keys, so a document the app
/// edits is written back with its fields where they were, and fields the app
/// does not know about survive untouched.
enum JSONValue: Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object(JSONObject)

  // MARK: Reading

  var string: String? { if case .string(let s) = self { s } else { nil } }
  var number: Double? { if case .number(let n) = self { n } else { nil } }
  var int: Int? { number.map { Int($0) } }
  var bool: Bool? { if case .bool(let b) = self { b } else { nil } }
  var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
  var object: JSONObject? { if case .object(let o) = self { o } else { nil } }
  var isNull: Bool { self == .null }

  subscript(key: String) -> JSONValue? {
    get { object?[key] }
    set {
      guard case .object(var o) = self else { return }
      o[key] = newValue
      self = .object(o)
    }
  }

  subscript(index: Int) -> JSONValue? {
    guard let a = array, a.indices.contains(index) else { return nil }
    return a[index]
  }
}

/// An object whose keys keep their insertion order.
struct JSONObject: Hashable, Sendable, Sequence {
  private(set) var keys: [String] = []
  private var values: [String: JSONValue] = [:]

  init() {}

  init(_ pairs: [(String, JSONValue)]) {
    for (k, v) in pairs { self[k] = v }
  }

  var isEmpty: Bool { keys.isEmpty }
  var count: Int { keys.count }

  /// Setting nil removes the key; setting an existing key keeps its place.
  subscript(key: String) -> JSONValue? {
    get { values[key] }
    set {
      if let newValue {
        if values[key] == nil { keys.append(key) }
        values[key] = newValue
      } else if values.removeValue(forKey: key) != nil {
        keys.removeAll { $0 == key }
      }
    }
  }

  func makeIterator() -> AnyIterator<(key: String, value: JSONValue)> {
    var i = 0
    return AnyIterator {
      guard i < keys.count else { return nil }
      defer { i += 1 }
      return (keys[i], values[keys[i]]!)
    }
  }

  static func == (a: JSONObject, b: JSONObject) -> Bool {
    a.keys == b.keys && a.values == b.values
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(keys)
    for k in keys { hasher.combine(values[k]) }
  }
}

// MARK: Literals

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
  ExpressibleByBooleanLiteral, ExpressibleByNilLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
  init(stringLiteral value: String) { self = .string(value) }
  init(integerLiteral value: Int) { self = .number(Double(value)) }
  init(floatLiteral value: Double) { self = .number(value) }
  init(booleanLiteral value: Bool) { self = .bool(value) }
  init(nilLiteral: ()) { self = .null }
  init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(JSONObject(elements)) }
}

// MARK: Parsing

enum JSONError: Error, LocalizedError {
  case invalid(String, offset: Int)
  var errorDescription: String? {
    if case .invalid(let what, let offset) = self { return "Invalid JSON: \(what) at byte \(offset)" }
    return nil
  }
}

extension JSONValue {
  /// Parses JSON keeping object key order (Foundation's parser does not).
  static func parse(_ data: Data) throws -> JSONValue {
    var parser = Parser(bytes: [UInt8](data))
    parser.skipSpace()
    let value = try parser.value()
    parser.skipSpace()
    guard parser.i == parser.bytes.count else { throw JSONError.invalid("trailing characters", offset: parser.i) }
    return value
  }

  static func parse(_ text: String) throws -> JSONValue { try parse(Data(text.utf8)) }

  private struct Parser {
    let bytes: [UInt8]
    var i = 0

    mutating func skipSpace() {
      while i < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[i]) { i += 1 }
    }

    mutating func value() throws -> JSONValue {
      guard i < bytes.count else { throw JSONError.invalid("unexpected end", offset: i) }
      switch bytes[i] {
      case UInt8(ascii: "{"): return try objectValue()
      case UInt8(ascii: "["): return try arrayValue()
      case UInt8(ascii: "\""): return .string(try stringValue())
      case UInt8(ascii: "t"): try literal("true"); return .bool(true)
      case UInt8(ascii: "f"): try literal("false"); return .bool(false)
      case UInt8(ascii: "n"): try literal("null"); return .null
      default: return .number(try numberValue())
      }
    }

    mutating func literal(_ word: String) throws {
      let w = Array(word.utf8)
      guard i + w.count <= bytes.count, Array(bytes[i..<i + w.count]) == w else {
        throw JSONError.invalid("expected \(word)", offset: i)
      }
      i += w.count
    }

    mutating func objectValue() throws -> JSONValue {
      i += 1
      var o = JSONObject()
      skipSpace()
      if i < bytes.count, bytes[i] == UInt8(ascii: "}") { i += 1; return .object(o) }
      while true {
        skipSpace()
        guard i < bytes.count, bytes[i] == UInt8(ascii: "\"") else { throw JSONError.invalid("expected a key", offset: i) }
        let key = try stringValue()
        skipSpace()
        guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { throw JSONError.invalid("expected :", offset: i) }
        i += 1
        skipSpace()
        o[key] = try value()
        skipSpace()
        guard i < bytes.count else { throw JSONError.invalid("unexpected end", offset: i) }
        if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
        if bytes[i] == UInt8(ascii: "}") { i += 1; return .object(o) }
        throw JSONError.invalid("expected , or }", offset: i)
      }
    }

    mutating func arrayValue() throws -> JSONValue {
      i += 1
      var a: [JSONValue] = []
      skipSpace()
      if i < bytes.count, bytes[i] == UInt8(ascii: "]") { i += 1; return .array(a) }
      while true {
        skipSpace()
        a.append(try value())
        skipSpace()
        guard i < bytes.count else { throw JSONError.invalid("unexpected end", offset: i) }
        if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
        if bytes[i] == UInt8(ascii: "]") { i += 1; return .array(a) }
        throw JSONError.invalid("expected , or ]", offset: i)
      }
    }

    mutating func stringValue() throws -> String {
      i += 1
      var out: [UInt8] = []
      while i < bytes.count {
        let c = bytes[i]
        if c == UInt8(ascii: "\"") { i += 1; return String(decoding: out, as: UTF8.self) }
        if c == UInt8(ascii: "\\") {
          i += 1
          guard i < bytes.count else { break }
          let e = bytes[i]
          i += 1
          switch e {
          case UInt8(ascii: "\""): out.append(0x22)
          case UInt8(ascii: "\\"): out.append(0x5C)
          case UInt8(ascii: "/"): out.append(0x2F)
          case UInt8(ascii: "b"): out.append(0x08)
          case UInt8(ascii: "f"): out.append(0x0C)
          case UInt8(ascii: "n"): out.append(0x0A)
          case UInt8(ascii: "r"): out.append(0x0D)
          case UInt8(ascii: "t"): out.append(0x09)
          case UInt8(ascii: "u"):
            var code = try hex4()
            // A surrogate pair is two \u escapes.
            if (0xD800...0xDBFF).contains(code), i + 1 < bytes.count, bytes[i] == UInt8(ascii: "\\"),
              bytes[i + 1] == UInt8(ascii: "u")
            {
              i += 2
              let low = try hex4()
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
            }
            out.append(contentsOf: Array(String(UnicodeScalar(code).map(Character.init) ?? "\u{FFFD}").utf8))
          default: throw JSONError.invalid("bad escape", offset: i)
          }
          continue
        }
        out.append(c)
        i += 1
      }
      throw JSONError.invalid("unterminated string", offset: i)
    }

    mutating func hex4() throws -> UInt32 {
      guard i + 4 <= bytes.count, let v = UInt32(String(decoding: bytes[i..<i + 4], as: UTF8.self), radix: 16) else {
        throw JSONError.invalid("bad \\u escape", offset: i)
      }
      i += 4
      return v
    }

    mutating func numberValue() throws -> Double {
      let start = i
      while i < bytes.count, "+-0123456789.eE".utf8.contains(bytes[i]) { i += 1 }
      guard let d = Double(String(decoding: bytes[start..<i], as: UTF8.self)) else {
        throw JSONError.invalid("bad number", offset: start)
      }
      return d
    }
  }
}

// MARK: Writing

extension JSONValue {
  /// Compact JSON, keys in their order. Whole numbers are written without a fraction.
  var serialized: String {
    var out = ""
    write(into: &out)
    return out
  }

  var data: Data { Data(serialized.utf8) }

  private func write(into out: inout String) {
    switch self {
    case .null: out += "null"
    case .bool(let b): out += b ? "true" : "false"
    case .number(let n):
      if n.isFinite, n == n.rounded(), abs(n) < 1e15 { out += String(Int64(n)) } else { out += "\(n)" }
    case .string(let s): JSONValue.writeString(s, into: &out)
    case .array(let a):
      out += "["
      for (idx, v) in a.enumerated() {
        if idx > 0 { out += "," }
        v.write(into: &out)
      }
      out += "]"
    case .object(let o):
      out += "{"
      for (idx, pair) in o.enumerated() {
        if idx > 0 { out += "," }
        JSONValue.writeString(pair.key, into: &out)
        out += ":"
        pair.value.write(into: &out)
      }
      out += "}"
    }
  }

  private static func writeString(_ s: String, into out: inout String) {
    out += "\""
    for scalar in s.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{2028}": out += "\\u2028"
      case "\u{2029}": out += "\\u2029"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    out += "\""
  }
}

extension JSONObject: ExpressibleByDictionaryLiteral {
  init(dictionaryLiteral elements: (String, JSONValue)...) { self.init(elements) }
}
