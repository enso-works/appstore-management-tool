import AppKit
import Foundation
import Testing

@testable import StoreShotsCore

@Suite struct JSONTests {
  @Test func keepsKeyOrderAndRoundTrips() throws {
    let text = #"{"z":1,"a":[true,null,2.5,"x\"y\n"],"m":{"b":"é","a":{}}}"#
    let v = try JSONValue.parse(text)
    #expect(v.object?.keys == ["z", "a", "m"])
    #expect(v["m"]?.object?.keys == ["b", "a"])
    #expect(v.serialized == text)
    #expect(try JSONValue.parse(v.serialized) == v)
  }

  @Test func setsAndRemovesKeysInPlace() {
    var o: JSONObject = ["a": 1, "b": 2, "c": 3]
    o["b"] = "two"
    o["a"] = nil
    o["d"] = true
    #expect(o.keys == ["b", "c", "d"])
    #expect(JSONValue.object(o).serialized == #"{"b":"two","c":3,"d":true}"#)
  }

  @Test func readsEscapesAndSurrogatePairs() throws {
    let v = try JSONValue.parse(#"["é😀", -1.5e2, 0]"#)
    #expect(v[0]?.string == "é😀")
    #expect(v[1]?.number == -150)
    #expect(v.serialized == #"["é😀",-150,0]"#)
  }

  @Test func rejectsBrokenJSON() {
    #expect(throws: JSONError.self) { try JSONValue.parse(#"{"a":1,}"#) }
    #expect(throws: JSONError.self) { try JSONValue.parse("[1 2]") }
  }
}

@Suite struct ColorTests {
  @Test func readsAndWritesCSSColours() throws {
    let c = try #require(CSSColor.nsColor("#fff"))
    #expect(abs(c.redComponent - 1) < 0.001)
    let half = try #require(CSSColor.nsColor("rgba(255, 0, 0, 0.5)"))
    #expect(abs(half.alphaComponent - 0.5) < 0.001)
    #expect(CSSColor.css(.init(nsColor: NSColor(srgbRed: 1, green: 0, blue: 0, alpha: 1))) == "#ff0000")
    #expect(CSSColor.nsColor("linear-gradient(red, blue)") == nil)
  }

  @Test func parsesSimpleGradientsOnly() throws {
    let g = try #require(SimpleGradient(css: "linear-gradient(165deg, #6946F4 0%, rgba(0, 0, 0, 0.5) 100%)"))
    #expect(g.angle == 165)
    #expect(g.from == "#6946F4")
    #expect(g.to == "rgba(0, 0, 0, 0.5)")
    #expect(SimpleGradient(css: "radial-gradient(circle, #fff, #000)") == nil)
    #expect(SimpleGradient(css: "linear-gradient(90deg, #fff, #888 50%, #000)") == nil)
  }

  @Test func namesFieldsPlainly() {
    #expect(FieldName.of("headline") == "Headline")
    #expect(FieldName.of("caption2") == "Caption (slide 2)")
  }
}

/// A snapshot as the engine sends it, small enough to read.
private let snapshot = #"""
  {
    "name": "demo", "root": "/tmp/demo", "manifestEtag": "m1", "contentEtags": {"en-US": "c1", "de-DE": "c2"},
    "configEtag": "k1", "validation": {"issues": []}, "readiness": {"checks": [], "status": "pass"},
    "templates": [{"id": "hero-top", "name": "Hero Top", "requiredFields": ["headline"], "optionalFields": ["caption"],
      "families": ["iphone"], "orientations": ["portrait"], "overrideKeys": ["screenshotOffsetX"]}],
    "targets": [
      {"id": "iphone-6.9-1320x2868", "platform": "ios", "family": "iphone", "displayClass": "6.9-inch",
       "orientation": "portrait", "width": 1320, "height": 2868, "fileToken": "IPHONE_69"},
      {"id": "header-3840x1646", "platform": "ios", "family": "creative", "displayClass": "product page header",
       "orientation": "landscape", "width": 3840, "height": 1646, "fileToken": "HEADER"}],
    "fonts": {"stack": [], "missing": [], "available": {"app": [], "bundled": []}},
    "config": {"projectName": "Demo", "locales": ["en-US", "de-DE"], "defaultLocale": "en-US",
      "targets": ["iphone-6.9-1320x2868", "header-3840x1646"]},
    "manifest": {"screens": [
      {"id": "home", "order": 1, "enabled": true, "template": "hero-top", "source": {"filePattern": "x.png", "localized": true}, "overrides": {}},
      {"id": "plan", "order": 2, "enabled": true, "template": "hero-top", "source": {"filePattern": "y.png", "localized": true}, "overrides": {"screenshotOffsetX": 0.1}},
      {"id": "banner", "order": 3, "enabled": true, "template": "hero-top", "targets": ["header-3840x1646"], "source": {"filePattern": "z.png", "localized": true}, "overrides": {}}
    ]},
    "content": {
      "en-US": {"locale": "en-US", "screens": {"home": {"headline": "Hello"}}},
      "de-DE": {"locale": "de-DE", "screens": {"home": {"headline": "Hallo"}}}
    }
  }
  """#

@MainActor
@Suite struct DocumentTests {
  private func document() throws -> (ProjectDocument, UndoManager) {
    // Nothing listens there: saves fail quietly, edits stay in memory.
    let d = ProjectDocument(name: "demo", api: APIClient(base: URL(string: "http://127.0.0.1:9")!))
    try d.apply(snapshot: Data(snapshot.utf8))
    // Without a run loop to group by event, each test groups its own undo steps.
    let undo = UndoManager()
    undo.groupsByEvent = false
    undo.beginUndoGrouping()
    d.undoManager = undo
    return (d, undo)
  }

  @Test func loadsDraftsAndPicksWhatToShow() throws {
    let (d, _) = try document()
    #expect(d.screens.map(\.id) == ["home", "plan", "banner"])
    #expect(d.locale == "en-US")
    #expect(d.screenId == "home")
    #expect(d.targetId == "iphone-6.9-1320x2868")
    #expect(d.fields(locale: "de-DE", screen: "home")["headline"] == "Hallo")
  }

  @Test func editsAreUndoableAndTypingIsOneStep() throws {
    let (d, undo) = try document()
    undo.endUndoGrouping()
    undo.beginUndoGrouping()
    d.setField("headline", "H")
    d.setField("headline", "Hi")
    d.setField("headline", "Hi there")
    undo.endUndoGrouping()
    #expect(d.fields(locale: "en-US", screen: "home")["headline"] == "Hi there")
    #expect(d.isDirty)
    undo.undo()
    #expect(d.fields(locale: "en-US", screen: "home")["headline"] == "Hello")
    undo.redo()
    #expect(d.fields(locale: "en-US", screen: "home")["headline"] == "Hi there")
  }

  @Test func canvasPatchesReplaceKeysAndNullRemoves() throws {
    let (d, _) = try document()
    d.patchScreen("plan", patch: ["overrides": ["screenshotOffsetX": 0.25, "deviceTilt": 4]])
    #expect(d.screens.first { $0.id == "plan" }?.overrides["screenshotOffsetX"] == 0.25)
    d.screenId = "plan"
    d.setOverrides(["deviceTilt": nil])
    #expect(d.screen?.overrides["deviceTilt"] == nil)
    #expect(d.screen?.overrides.keys == ["screenshotOffsetX"])
  }

  @Test func reorderingRenumbersTheDefaultPage() throws {
    let (d, _) = try document()
    d.moveScreens(from: IndexSet(integer: 1), to: 0)
    #expect(d.screens.map(\.id) == ["plan", "home", "banner"])
    #expect(d.screens.map(\.order) == [1, 2, 3])
  }

  @Test func pagesKeepTheirOwnCopyAndGoCleanly() throws {
    let (d, _) = try document()
    let id = try #require(d.newPage(kind: "custom", name: "Runners!"))
    #expect(id == "runners")
    #expect(d.pageId == "runners")
    #expect(d.page?.screens == ["home", "plan", "banner"])
    d.setField("headline", "For runners")
    #expect(d.fields(locale: "en-US", screen: "home")["headline"] == "For runners")
    #expect(d.content["en-US"]?["screens"]?["home"]?["headline"] == "Hello")
    d.deletePage(id)
    #expect(d.sets.isEmpty)
    #expect(d.content["en-US"]?["sets"] == nil)
    #expect(d.pageId == "")
  }

  @Test func aReloadNeverDropsEditsItCouldNotSave() async throws {
    let (d, _) = try document()
    d.setField("headline", "Unsaved")
    await d.load()  // the engine is unreachable: the save fails, so the reload must not happen
    if case .failed = d.saveStatus {} else { Issue.record("expected a failed save, got \(d.saveStatus)") }
    #expect(d.isDirty)
    #expect(d.fields(locale: "en-US", screen: "home")["headline"] == "Unsaved")
  }

  @Test func theDeviceFollowsTheScreen() throws {
    let (d, _) = try document()
    d.screenId = "banner"
    #expect(d.targetId == "header-3840x1646")
    d.screenId = "home"
    #expect(d.targetId == "iphone-6.9-1320x2868")
  }
}
