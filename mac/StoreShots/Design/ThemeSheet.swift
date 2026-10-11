import SwiftUI

/// A starter theme as the engine lists it (`GET /api/themes`).
struct ThemeInfo: Decodable, Identifiable, Hashable {
  let id: String
  let name: String
  let description: String
  let headlineFont: String
}

/// The themes as cards, each a preview the engine renders in the chosen colour: from the
/// app's own captures and copy when `project` names one, else as a new app starts.
struct ThemePicker: View {
  let api: APIClient
  @Binding var selection: String?
  @Binding var accent: Color
  var project: String?
  var orientation = "portrait"
  /// Offer "Plain": one screen with the template's defaults, as importing did before themes.
  var allowPlain = false
  /// Where the colour was found ("app.json primaryColor"), shown beside it.
  var accentSource = ""
  /// The app's headline font: the theme with that font is marked as in use (each theme has its own).
  var currentHeadlineFont: String?

  @State private var themes: [ThemeInfo] = []
  @State private var previewAccent = ""
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Colour")
        Spacer()
        Text(accentSource.isEmpty ? "Every theme is drawn in it" : "From \(accentSource)")
          .font(.callout)
          .foregroundStyle(.secondary)
        ColorPicker("Colour", selection: $accent, supportsOpacity: false).labelsHidden()
      }
      if let error { Text(error).foregroundStyle(.red).font(.callout) }
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) {
        if allowPlain {
          card(id: nil, title: "Plain", detail: "One screen with the template's defaults, to style yourself") {
            RoundedRectangle(cornerRadius: 6).fill(.quaternary)
              .overlay(Image(systemName: "rectangle.portrait").font(.largeTitle).foregroundStyle(.secondary))
          }
        }
        ForEach(themes) { t in
          card(
            id: t.id, title: t.name, detail: "\(t.description). Headlines in \(t.headlineFont).",
            inUse: t.headlineFont == currentHeadlineFont
          ) {
            AsyncImage(url: previewURL(t.id)) { phase in
              switch phase {
              case .success(let image): image.resizable().scaledToFit()
              case .failure: Image(systemName: "exclamationmark.triangle").foregroundStyle(.secondary)
              default: ProgressView().controlSize(.small)
              }
            }
            .id(previewURL(t.id))
          }
        }
      }
    }
    .task { await loadThemes() }
    .task(id: CSSColor.css(accent)) {
      // Previews follow the colour once it has settled, not on every step of the picker.
      try? await Task.sleep(for: .milliseconds(previewAccent.isEmpty ? 0 : 400))
      if !Task.isCancelled { previewAccent = CSSColor.css(accent) }
    }
  }

  private func card(
    id: String?, title: String, detail: String, inUse: Bool = false, @ViewBuilder image: () -> some View
  ) -> some View {
    let selected = selection == id
    return Button {
      selection = id
    } label: {
      VStack(alignment: .leading, spacing: 6) {
        image()
          .frame(height: 150)
          .frame(maxWidth: .infinity)
        HStack {
          Text(title).font(.headline)
          if inUse {
            Text("In use").font(.caption).foregroundStyle(.secondary)
              .padding(.horizontal, 6).padding(.vertical, 1)
              .background(Capsule().fill(.quaternary))
          }
        }
        Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(3, reservesSpace: true)
      }
      .padding(10)
      .background(RoundedRectangle(cornerRadius: 10).fill(selected ? Color.accentColor.opacity(0.12) : .clear))
      .overlay(
        RoundedRectangle(cornerRadius: 10)
          .strokeBorder(selected ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: selected ? 2 : 1))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private func previewURL(_ theme: String) -> URL? {
    guard !previewAccent.isEmpty else { return nil }
    var query = ["theme": theme, "accent": previewAccent, "orientation": orientation, "height": "300"]
    if let project { query["project"] = project }
    return api.url("api/themes/preview", query: query)
  }

  private func loadThemes() async {
    struct Body: Decodable { let themes: [ThemeInfo] }
    do {
      themes = try await api.get(Body.self, "api/themes").themes
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// Design > Theme...: restyle the app in a theme. Copy, captures, layers and the order of
/// screens stay; one Command-Z puts the app back as it was.
struct ThemeSheet: View {
  @Bindable var document: ProjectDocument
  @Environment(\.dismiss) private var dismiss
  @State private var selection: String?
  @State private var accent = Color.accentColor
  @State private var accentSource = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Theme").font(.title2.weight(.semibold))
        Text("Restyles every screen, the brand colours and the headline font. Copy, captures, layers and the order of screens stay as they are.")
          .font(.callout).foregroundStyle(.secondary)
      }
      .padding(20)
      ScrollView {
        ThemePicker(
          api: document.api, selection: $selection, accent: $accent, project: document.name,
          orientation: document.target?.orientation ?? "portrait", accentSource: accentSource,
          currentHeadlineFont: document.config["brand"]?["headlineFont"]?["family"]?.string
        )
        .padding([.horizontal, .bottom], 20)
      }
      if let error { Text(error).foregroundStyle(.red).padding(.horizontal, 20).padding(.bottom, 10) }
    }
    .frame(width: 820, height: 680)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Apply") {
          Task {
            guard let selection else { return }
            busy = true
            defer { busy = false }
            do {
              try await document.applyTheme(selection, accent: CSSColor.css(accent))
              dismiss()
            } catch {
              self.error = error.localizedDescription
            }
          }
        }
        .disabled(selection == nil || busy)
      }
    }
    .task {
      // Start from the app's own colour: what it states, else its icon's.
      guard let body = try? await document.api.get(document.api.project(document.name, "theme")),
        let hex = body["accent"]?["hex"]?.string, let color = CSSColor.color(hex)
      else { return }
      accent = color
      accentSource = body["accent"]?["source"]?.string ?? ""
    }
  }
}

extension ProjectDocument {
  /// Apply a theme on the engine, then reload. One undo step puts the config and manifest
  /// back as they were (registered after the reload, which drops older steps, on a target
  /// of its own so the reloads undo and redo make do not drop it either).
  func applyTheme(_ id: String, accent: String) async throws {
    await save()
    let answer = try await api.send(
      "POST", api.project(name, "theme"), body: ["theme": .string(id), "accent": .string(accent)])
    await load()
    if let previous = answer["previous"] { registerThemeUndo(previous: previous, theme: id, accent: accent) }
  }

  private func registerThemeUndo(previous: JSONValue, theme: String, accent: String) {
    guard let undoManager else { return }
    undoManager.registerUndo(withTarget: themeUndoTarget) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        // Redo applies the theme again, which registers this undo again.
        self.undoManager?.registerUndo(withTarget: self.themeUndoTarget) { [weak self] _ in
          MainActor.assumeIsolated {
            guard let self else { return }
            Task { try? await self.applyTheme(theme, accent: accent) }
          }
        }
        self.undoManager?.setActionName("Theme")
        Task {
          _ = try? await self.api.send("PUT", self.api.project(self.name, "theme"), body: previous)
          await self.load()
        }
      }
    }
    undoManager.setActionName("Theme")
  }
}
