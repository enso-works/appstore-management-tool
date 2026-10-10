import AppKit
import SwiftUI

/// CSS colour strings the templates read (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba())
/// to and from SwiftUI colours for the native colour picker.
enum CSSColor {
  static func color(_ css: String) -> Color? {
    nsColor(css).map(Color.init(nsColor:))
  }

  static func nsColor(_ css: String) -> NSColor? {
    let s = css.trimmingCharacters(in: .whitespaces).lowercased()
    if s.hasPrefix("#") {
      var hex = String(s.dropFirst())
      if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
      guard hex.count == 6 || hex.count == 8, let v = UInt64(hex, radix: 16) else { return nil }
      let hasAlpha = hex.count == 8
      let r = Double((v >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
      let g = Double((v >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
      let b = Double((v >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
      let a = hasAlpha ? Double(v & 0xFF) / 255 : 1
      return NSColor(srgbRed: r, green: g, blue: b, alpha: a)
    }
    if s.hasPrefix("rgb") {
      let inner = s.drop { $0 != "(" }.dropFirst().prefix { $0 != ")" }
      let parts = inner.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).compactMap { Double($0) }
      guard parts.count >= 3 else { return nil }
      return NSColor(
        srgbRed: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts.count > 3 ? parts[3] : 1)
    }
    let named: [String: String] = ["white": "#ffffff", "black": "#000000", "transparent": "#00000000"]
    return named[s].flatMap(nsColor)
  }

  /// #rrggbb, or #rrggbbaa when not opaque.
  static func css(_ color: Color) -> String {
    guard let c = NSColor(color).usingColorSpace(.sRGB) else { return "#000000" }
    let hex = { (v: CGFloat) in String(format: "%02x", Int((v * 255).rounded())) }
    let base = "#\(hex(c.redComponent))\(hex(c.greenComponent))\(hex(c.blueComponent))"
    return c.alphaComponent < 0.999 ? base + hex(c.alphaComponent) : base
  }
}

/// A simple two-stop linear gradient, the kind the background editor makes.
struct SimpleGradient: Equatable {
  var angle: Double
  var from: String
  var to: String

  var css: String { "linear-gradient(\(Int(angle))deg, \(from) 0%, \(to) 100%)" }

  /// Parses `linear-gradient(<angle>deg, <c1> [p%], <c2> [p%])`; anything richer is left to the CSS field.
  init?(css: String) {
    let s = css.trimmingCharacters(in: .whitespaces)
    guard s.hasPrefix("linear-gradient("), s.hasSuffix(")"), !s.contains("radial") else { return nil }
    let inner = String(s.dropFirst("linear-gradient(".count).dropLast())
    var parts: [String] = []
    var depth = 0
    var current = ""
    for ch in inner {
      if ch == "(" { depth += 1 }
      if ch == ")" { depth -= 1 }
      if ch == ",", depth == 0 {
        parts.append(current.trimmingCharacters(in: .whitespaces))
        current = ""
      } else {
        current.append(ch)
      }
    }
    parts.append(current.trimmingCharacters(in: .whitespaces))
    guard parts.count == 3, parts[0].hasSuffix("deg"), let a = Double(parts[0].dropLast(3)) else { return nil }
    func color(_ p: String) -> String {
      // "#fff 0%" -> "#fff"; an rgba() keeps its spaces.
      if p.hasPrefix("rgb") { return String(p.prefix { $0 != ")" }) + ")" }
      return String(p.split(separator: " ").first ?? "")
    }
    angle = a
    from = color(parts[1])
    to = color(parts[2])
  }

  init(angle: Double, from: String, to: String) {
    self.angle = angle
    self.from = from
    self.to = to
  }
}
