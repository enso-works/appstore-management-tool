import Foundation

/// Plain names for copy fields: "headline" -> "Headline", "caption2" -> "Caption (slide 2)".
enum FieldName {
  static func of(_ field: String) -> String {
    let base = field.trimmingCharacters(in: .decimalDigits)
    let slide = field.dropFirst(base.count)
    let name = base.prefix(1).uppercased() + base.dropFirst()
    return slide.isEmpty ? name : "\(name) (slide \(slide))"
  }
}

/// "en-US" -> "English (United States)", in the system language.
enum LocaleName {
  static func of(_ code: String) -> String {
    Locale.current.localizedString(forIdentifier: code) ?? code
  }
}
