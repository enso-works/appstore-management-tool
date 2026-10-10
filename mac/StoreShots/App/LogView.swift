import SwiftUI


struct LogView: View {
  @Environment(EditorServer.self) private var server

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        Text(server.log.isEmpty ? "Nothing logged yet." : server.log)
          .font(.system(size: 11, design: .monospaced))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
        Color.clear.frame(height: 1).id("end")
      }
      .onChange(of: server.log, initial: true) {
        proxy.scrollTo("end", anchor: .bottom)
      }
    }
    .frame(minWidth: 640, minHeight: 360)
    .toolbar {
      ToolbarItem {
        Text(server.statusText)
          .foregroundStyle(.secondary)
      }
      ToolbarItem {
        Button("Restart") { server.restart() }
      }
    }
  }
}
