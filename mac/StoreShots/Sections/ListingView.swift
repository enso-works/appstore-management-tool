import SwiftUI

/// Listing: name, subtitle, keywords and the rest of the store text, per language.
struct ListingView: View {
  let document: ProjectDocument
  @State private var locale = ""

  var body: some View {
    let model = document.listing
    Group {
      if model.loaded {
        HSplitView {
          List(selection: $locale) {
            ForEach(document.locales, id: \.self) { l in
              HStack {
                Text(LocaleName.of(l))
                Spacer()
                completeness(model, l)
              }
              .tag(l)
            }
          }
          .frame(minWidth: 200, idealWidth: 240, maxWidth: 320)
          ListingForm(model: model, locale: locale, defaultLocale: document.defaultLocale)
            .frame(minWidth: 480)
        }
        .toolbar {
          ToolbarItem {
            Text(model.status ?? "").foregroundStyle(.secondary)
          }
        }
      } else {
        ProgressView()
      }
    }
    .task {
      await model.load()
      if locale.isEmpty { locale = document.locale.isEmpty ? document.defaultLocale : document.locale }
    }
  }

  @ViewBuilder
  private func completeness(_ m: ListingModel, _ l: String) -> some View {
    if m.dirExists[l] == false {
      Image(systemName: "plus.circle").foregroundStyle(.secondary).help("No text in this language yet")
    } else if (m.fields[l] ?? []).contains(where: { $0.value.count > $0.limit && $0.limit > 0 }) {
      Image(systemName: "xmark.circle.fill").foregroundStyle(.red).help("Something is over Apple's limit")
    } else if ["name", "description", "keywords"].contains(where: { m.value(l, $0).isEmpty }) {
      Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange).help("Missing text")
    } else {
      Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
    }
  }
}

struct ListingForm: View {
  let model: ListingModel
  let locale: String
  let defaultLocale: String

  private static let titles: [String: (String, String)] = [
    "name": ("Name", "The app's name on the App Store"),
    "subtitle": ("Subtitle", "Under the name"),
    "keywords": ("Keywords", "Words people search for, comma separated"),
    "promotional_text": ("Promotional Text", "Above the description; change it any time"),
    "description": ("Description", ""),
    "release_notes": ("What's New", "For this version"),
    "support_url": ("Support URL", ""),
    "marketing_url": ("Marketing URL", ""),
    "privacy_url": ("Privacy Policy URL", ""),
  ]

  var body: some View {
    if model.dirExists[locale] == false {
      ContentUnavailableView {
        Label("No \(LocaleName.of(locale)) text yet", systemImage: "text.badge.plus")
      } actions: {
        Button("Start from \(LocaleName.of(defaultLocale))") {
          Task { await model.createLocale(locale, from: defaultLocale) }
        }
        .buttonStyle(.borderedProminent)
      }
    } else {
      Form {
        ForEach(model.fields[locale] ?? []) { f in
          field(f)
        }
      }
      .formStyle(.grouped)
    }
  }

  @ViewBuilder
  private func field(_ f: ListingModel.Field) -> some View {
    let title = Self.titles[f.field] ?? (f.field, "")
    let long = f.field == "description" || f.field == "release_notes" || f.field == "promotional_text"
    let bytes = f.field == "keywords" ? f.value.utf8.count : f.value.count
    Section {
      if long {
        TextEditor(text: Binding(get: { f.value }, set: { model.set(locale, f.field, $0) }))
          .font(.body)
          .frame(minHeight: f.field == "promotional_text" ? 60 : 160)
          .scrollContentBackground(.hidden)
      } else {
        TextField(title.0, text: Binding(get: { f.value }, set: { model.set(locale, f.field, $0) }), prompt: Text(title.1))
          .labelsHidden()
      }
      if f.field == "keywords" {
        ForEach(model.findings[locale] ?? [], id: \.self) { finding in
          Label(finding.text, systemImage: finding.level == "fail" ? "xmark.circle" : "exclamationmark.triangle")
            .foregroundStyle(finding.level == "fail" ? .red : .orange)
            .font(.callout)
        }
      }
      if f.field == "release_notes", locale == defaultLocale {
        Button("Use for Every Language") { model.copyToAll("release_notes", from: locale) }
          .help("Give every language this text, to translate later")
      }
    } header: {
      HStack {
        Text(title.0)
        Spacer()
        if f.limit > 0 {
          Text(f.field == "keywords" ? "\(bytes) of \(f.limit) bytes" : "\(bytes) of \(f.limit)")
            .monospacedDigit()
            .foregroundStyle(bytes > f.limit ? .red : .secondary)
        }
      }
    }
  }
}
