import UIKit
import Capacitor
import UniformTypeIdentifiers

/// Paths the plugins may touch.
enum FalePaths {
    static func caches() -> URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
    static func documents() -> URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    static func incoming() -> URL {
        let dir = caches().appendingPathComponent("incoming", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    /// "file:///…", "/…" or a path relative to the caches directory → file URL
    static func fileURL(_ raw: String) -> URL? {
        if raw.hasPrefix("file://") { return URL(string: raw)?.standardizedFileURL }
        if raw.hasPrefix("/") { return URL(fileURLWithPath: raw).standardizedFileURL }
        if raw.isEmpty || raw.contains("..") { return nil }
        return caches().appendingPathComponent(raw).standardizedFileURL
    }
    static func isInside(_ url: URL, _ dir: URL) -> Bool {
        let p = url.resolvingSymlinksInPath().path
        let d = dir.resolvingSymlinksInPath().path
        return p.hasPrefix(d + "/")
    }
}

/// Files opened with FaLe PDF from the Files app, Mail, Safari … ("Öffnen in", "Teilen → FaLe PDF").
/// Same JS API as the Android plugin (js/platform.js): event "filesReady", takePending(), readFile(), release(),
/// writeBack(), setBarColors() and setSecure() (no-ops on iOS).
/// Files opened in place (Files app, LSSupportsOpeningDocumentsInPlace) keep a security-scoped bookmark under a
/// random token while the app runs – writeBack() replaces the original with the edited version (coordinated write).
@objc(FaleIncomingPlugin)
public class FaleIncomingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FaleIncomingPlugin"
    public let jsName = "FaleIncoming"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeBack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBarColors", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecure", returnType: CAPPluginReturnPromise)
    ]

    static let maxBytes: Int64 = 100 * 1024 * 1024
    private let lock = NSLock()
    private var pending: [[String: Any]] = []
    private var skipped: [[String: Any]] = []
    private var origins: [String: (bookmark: Data, writable: Bool)] = [:]
    private var counter = 0
    private var handledLaunchURL = false
    private let io = DispatchQueue(label: "dev.fale.pdf.incoming")

    public override func load() {
        // old copies from an earlier run
        if let items = try? FileManager.default.contentsOfDirectory(at: FalePaths.incoming(), includingPropertiesForKeys: nil) {
            items.forEach { try? FileManager.default.removeItem(at: $0) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(openURL(_:)), name: .capacitorOpenURL, object: nil)
        CAPLog.print("FaleIncoming: loaded")
        // cold start: the URL may have arrived before this plugin was loaded
        if let url = ApplicationDelegateProxy.shared.lastURL, !handledLaunchURL {
            handledLaunchURL = true
            handle(url, inPlace: nil)
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func openURL(_ n: Notification) {
        let obj = (n.object as? [String: Any]) ?? (n.userInfo as? [String: Any]) ?? [:]
        guard let url = obj["url"] as? URL else { CAPLog.print("FaleIncoming: openURL without url (\(String(describing: n.object)))"); return }
        CAPLog.print("FaleIncoming: openURL \(url.scheme ?? "?")://…")
        let options = obj["options"] as? [UIApplication.OpenURLOptionsKey: Any] ?? [:]
        handledLaunchURL = true
        handle(url, inPlace: options[.openInPlace] as? Bool)
    }

    /// Simulator test builds only (Info.plist FaleE2E = true, set by cap-patch-ios.mjs with FALE_E2E=1):
    /// fale-e2e://open?name=<file in Documents> opens that file like the Files app would (in place).
    private func e2eFileURL(_ url: URL) -> URL? {
        guard url.scheme == "fale-e2e", Bundle.main.object(forInfoDictionaryKey: "FaleE2E") as? Bool == true,
              let name = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "name" })?.value,
              !name.isEmpty, !name.contains("/"), !name.contains("..") else { return nil }
        return FalePaths.documents().appendingPathComponent(name)
    }

    /// inPlace nil (cold start, options unknown): everything except iOS' Inbox copies counts as the original.
    private func handle(_ incoming: URL, inPlace given: Bool?) {
        let e2e = e2eFileURL(incoming)
        let url = e2e ?? incoming
        let inbox = FalePaths.documents().appendingPathComponent("Inbox")
        let inPlace = e2e != nil ? true : (given ?? !FalePaths.isInside(url, inbox))
        guard url.isFileURL else { return } // custom schemes / links are not files
        io.async {
            self.importURL(url, inPlace: inPlace)
            self.lock.lock(); let count = self.pending.count + self.skipped.count; self.lock.unlock()
            self.notifyListeners("filesReady", data: ["count": count])
        }
    }

    private static func cleanName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var n = name.components(separatedBy: bad).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if n.isEmpty { n = "Datei" }
        return String(n.prefix(150))
    }

    private func addSkipped(_ name: String, _ reason: String) {
        lock.lock(); skipped.append(["name": name, "reason": reason]); lock.unlock()
    }

    private func importURL(_ url: URL, inPlace: Bool) {
        let name = Self.cleanName(url.lastPathComponent)
        // never re-import our own private files (only Documents – visible in the Files app – and Inbox copies are fine)
        let docs = FalePaths.documents()
        let appRoot = docs.deletingLastPathComponent()
        if FalePaths.isInside(url, appRoot) && !FalePaths.isInside(url, docs) { addSkipped(name, "blocked"); return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map { Int64($0) } ?? -1
        if size > Self.maxBytes { addSkipped(name, "too-large"); return }
        lock.lock(); counter += 1; let n = counter; lock.unlock()
        let dest = FalePaths.incoming().appendingPathComponent("\(n)-\(name)")
        var copyError: Error?
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordError) { readURL in
            do {
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.copyItem(at: readURL, to: dest)
            } catch { copyError = error }
        }
        if coordError != nil || copyError != nil { addSkipped(name, "unreadable"); return }
        let real = (try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize).map { Int64($0) } ?? 0
        if real > Self.maxBytes { try? FileManager.default.removeItem(at: dest); addSkipped(name, "too-large"); return }
        var o: [String: Any] = [
            "name": name,
            "mimeType": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "",
            "size": real,
            "path": dest.path
        ]
        if inPlace, let bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            let token = UUID().uuidString
            let writable = FileManager.default.isWritableFile(atPath: url.path)
            lock.lock(); origins[token] = (bookmark, writable); lock.unlock()
            o["origin"] = token
            o["writable"] = writable
        } else if FalePaths.isInside(url, docs.appendingPathComponent("Inbox")) {
            try? FileManager.default.removeItem(at: url) // iOS copied it into our Inbox – we keep our own copy
        }
        lock.lock(); pending.append(o); lock.unlock()
        CAPLog.print("FaleIncoming: \(name) inPlace=\(inPlace) writable=\(o["writable"] as? Bool ?? false)")
    }

    @objc func takePending(_ call: CAPPluginCall) {
        lock.lock()
        let files = pending, skip = skipped
        pending.removeAll(); skipped.removeAll()
        lock.unlock()
        call.resolve(["action": "VIEW", "files": files, "skipped": skip])
    }

    private func insideIncoming(_ path: String?) -> URL? {
        guard let p = path, let url = FalePaths.fileURL(p), FalePaths.isInside(url, FalePaths.incoming()) else { return nil }
        return url
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let url = insideIncoming(call.getString("path")) else { call.reject("readFile failed: bad path"); return }
        io.async {
            do { call.resolve(["data": try Data(contentsOf: url).base64EncodedString()]) } catch { call.reject("readFile failed: \(error.localizedDescription)") }
        }
    }

    @objc func release(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        for p in paths { if let url = insideIncoming(p) { try? FileManager.default.removeItem(at: url) } }
        call.resolve()
    }

    /// Replace the original (opened in place) with the edited version. {token, path}: path is relative to the
    /// caches directory, below writeback/ (written by JS through the Filesystem plugin, directory CACHE).
    @objc func writeBack(_ call: CAPPluginCall) {
        let token = call.getString("token") ?? ""
        lock.lock(); let origin = origins[token]; lock.unlock()
        guard let o = origin else { call.reject("unknown", "unknown"); return }
        guard o.writable else { call.reject("readonly", "readonly"); return }
        let wbDir = FalePaths.caches().appendingPathComponent("writeback", isDirectory: true)
        guard let rel = call.getString("path"), let src = FalePaths.fileURL(rel), FalePaths.isInside(src, wbDir) else {
            call.reject("failed", "failed"); return
        }
        io.async {
            defer { try? FileManager.default.removeItem(at: src) }
            do {
                let data = try Data(contentsOf: src)
                if Int64(data.count) > Self.maxBytes { call.reject("failed", "failed"); return }
                var stale = false
                let url = try URL(resolvingBookmarkData: o.bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                var coordError: NSError?
                var writeError: Error?
                NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: [.forReplacing], error: &coordError) { wurl in
                    do { try data.write(to: wurl, options: []) } catch { writeError = error }
                }
                if let e = writeError ?? coordError {
                    let ns = e as NSError
                    let denied = ns.domain == NSCocoaErrorDomain && (ns.code == NSFileWriteNoPermissionError || ns.code == NSFileReadNoPermissionError)
                    call.reject(denied ? "readonly" : "failed", denied ? "readonly" : "failed")
                    return
                }
                CAPLog.print("FaleIncoming: writeBack ok (\(data.count) bytes)")
                call.resolve(["ok": true, "size": data.count])
            } catch {
                call.reject("failed", "failed")
            }
        }
    }

    @objc func setBarColors(_ call: CAPPluginCall) { call.resolve() }
    @objc func setSecure(_ call: CAPPluginCall) { call.resolve() }
}
