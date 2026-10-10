import SwiftUI

/// The shown custom page or treatment, above the screen's inspector in Design.
struct PageInspector: View {
  @Bindable var document: ProjectDocument
  @Environment(Workspace.self) private var workspace

  var body: some View {
    if let page = document.page {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Image(systemName: page.isCustom ? "rectangle.stack" : "flask")
          TextField(
            "Name",
            text: Binding(
              get: { page.name },
              set: { v in document.patchPage(page.id, name: "Rename Page") { $0["name"] = .string(v) } })
          )
          .textFieldStyle(.plain)
          .font(.headline)
        }
        Text(
          page.isCustom
            ? "Custom product page: \(page.screens.count) screens in its own order."
            : "Treatment in \"\(page.experiment ?? "store-shots")\": \(page.screens.count) screens."
        )
        .font(.callout)
        .foregroundStyle(.secondary)
        Button("Text, Keywords and Upload in Pages") { workspace.open(document.name, section: .pages) }
          .buttonStyle(.link)
      }
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
