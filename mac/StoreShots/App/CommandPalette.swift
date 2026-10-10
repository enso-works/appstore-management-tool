import SwiftUI

/// Command-K: type a few letters to jump to an app, section, screen, page, language or
/// device, or to run an action.
struct CommandPalette: View {
  @Environment(EditorServer.self) private var server
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var index = 0
  @FocusState private var focused: Bool

  struct Command: Identifiable {
    let id: String
    let title: String
    let kind: String
    let icon: String
    let run: () -> Void
  }

  var body: some View {
    let found = matches
    VStack(spacing: 0) {
      HStack {
        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
        TextField("Go to or do...", text: $query)
          .textFieldStyle(.plain)
          .font(.title3)
          .focused($focused)
          .onSubmit { if !query.isEmpty { run(found) } }
          .onExitCommand { dismiss() }
          .onKeyPress(.downArrow) {
            index = min(index + 1, max(found.count - 1, 0))
            return .handled
          }
          .onKeyPress(.upArrow) {
            index = max(index - 1, 0)
            return .handled
          }
      }
      .padding(14)
      Divider()
      ScrollViewReader { proxy in
        List(Array(found.enumerated()), id: \.element.id) { i, c in
          HStack {
            Image(systemName: c.icon).frame(width: 20).foregroundStyle(.secondary)
            Text(c.title)
            Spacer()
            Text(c.kind).font(.caption).foregroundStyle(.secondary)
          }
          .padding(.vertical, 2)
          .listRowBackground(i == index ? Color.accentColor.opacity(0.2) : Color.clear)
          .contentShape(Rectangle())
          .onTapGesture {
            index = i
            run(found)
          }
          .id(i)
        }
        .listStyle(.plain)
        .onChange(of: index) { _, i in proxy.scrollTo(i) }
      }
    }
    .frame(width: 560, height: 420)
    .background {
      Button("Close") { dismiss() }
        .keyboardShortcut(.cancelAction)
        .hidden()
    }
    .onAppear { focused = true }
    .onChange(of: query) { index = 0 }
  }

  private func run(_ found: [Command]) {
    guard found.indices.contains(index) else { return }
    dismiss()
    found[index].run()
  }

  /// Every word typed must appear in the title or kind.
  private var matches: [Command] {
    let words = query.lowercased().split(separator: " ")
    let all = commands
    guard !words.isEmpty else { return all }
    return all.filter { c in
      let text = "\(c.title) \(c.kind)".lowercased()
      return words.allSatisfy { text.contains($0) }
    }
  }

  private var commands: [Command] {
    var out: [Command] = []
    let doc = workspace.currentDocument
    if let doc, let name = workspace.selection?.appName {
      out.append(
        Command(id: "generate", title: "Generate", kind: "Action", icon: "square.and.arrow.down.on.square") {
          Task { await doc.generate(.all) }
        })
      out.append(
        Command(id: "generate-screen", title: "Generate This Screen", kind: "Action", icon: "square.and.arrow.down") {
          Task { await doc.generate(.screen) }
        })
      for s in SidebarItem.Section.allCases {
        out.append(Command(id: "section-\(s.rawValue)", title: s.title, kind: "Section", icon: s.systemImage) {
          workspace.open(name, section: s)
        })
      }
      for m in ProjectDocument.CanvasMode.allCases {
        out.append(Command(id: "mode-\(m.rawValue)", title: "View: \(m.title)", kind: "Canvas", icon: "rectangle.3.group") {
          workspace.open(name, section: .design)
          doc.mode = m
        })
      }
      out.append(Command(id: "guides", title: doc.guides ? "Hide Guides" : "Show Guides", kind: "Canvas", icon: "squareshape.split.3x3") {
        doc.guides.toggle()
      })
      out.append(Command(id: "store", title: doc.storeLook ? "Plain Look" : "App Store Look", kind: "Canvas", icon: "app.badge") {
        doc.storeLook.toggle()
      })
      for s in doc.screens {
        out.append(Command(id: "screen-\(s.id)", title: s.id, kind: "Screen", icon: "iphone") {
          workspace.open(name, section: .design)
          doc.screenId = s.id
        })
      }
      out.append(Command(id: "page-default", title: "Default Page", kind: "Page", icon: "app") { doc.pageId = "" })
      for p in doc.sets {
        out.append(Command(id: "page-\(p.id)", title: p.name, kind: p.isCustom ? "Custom page" : "Treatment", icon: "rectangle.stack") {
          doc.pageId = p.id
        })
      }
      for l in doc.locales {
        out.append(Command(id: "locale-\(l)", title: LocaleName.of(l), kind: "Language", icon: "globe") { doc.locale = l })
      }
      for t in doc.targets {
        out.append(Command(id: "target-\(t.id)", title: t.label(among: doc.targets), kind: "Device", icon: t.systemImage) {
          doc.targetId = t.id
        })
      }
    }
    for p in server.projects {
      out.append(Command(id: "app-\(p.name)", title: p.title, kind: "App", icon: "square.stack") { workspace.open(p.name) })
    }
    out.append(Command(id: "apps", title: "All Apps", kind: "Go", icon: "square.grid.2x2") { workspace.selection = .apps })
    return out
  }
}
