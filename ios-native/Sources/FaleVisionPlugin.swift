import UIKit
import Vision
import Capacitor

/// Apple's on-device text recognition (Vision) for the web app's OCR (js/ocr/native.js) – faster and more accurate
/// than the WebAssembly engine, works offline, no language data to download.
///
///   FaleVision.languages() → { languages: ["en-US", "de-DE", …] }
///   FaleVision.recognize({ image: "<base64 JPEG/PNG>", languages: ["de-DE", "en-US"], fast: false })
///     → { width, height, lines: [{ text, conf, box: [x, y, w, h], words: [{ text, conf, box }] }] }
///   Boxes in image pixels, origin top left. conf 0…1. Nothing leaves the device.
@objc(FaleVisionPlugin)
public class FaleVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FaleVisionPlugin"
    public let jsName = "FaleVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "languages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "dev.fale.pdf.vision", qos: .userInitiated)
    private static let maxPixels = 40_000_000.0

    @objc func languages(_ call: CAPPluginCall) {
        queue.async {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            if #available(iOS 16.0, *) { request.revision = VNRecognizeTextRequestRevision3 }
            let list = (try? request.supportedRecognitionLanguages()) ?? []
            call.resolve(["languages": list])
        }
    }

    @objc func recognize(_ call: CAPPluginCall) {
        guard var b64 = call.getString("image"), !b64.isEmpty else { call.reject("no image", "bad_input"); return }
        if let comma = b64.firstIndex(of: ","), b64.hasPrefix("data:") { b64 = String(b64[b64.index(after: comma)...]) }
        let langs = (call.getArray("languages", String.self) ?? []).filter { !$0.isEmpty }
        let fast = call.getBool("fast") ?? false
        queue.async {
            guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
                  let image = UIImage(data: data), let cg = image.cgImage else {
                call.reject("image could not be read", "bad_input")
                return
            }
            let w = Double(cg.width), h = Double(cg.height)
            if w * h > FaleVisionPlugin.maxPixels { call.reject("image too large", "bad_input"); return }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = fast ? .fast : .accurate
            request.usesLanguageCorrection = true
            if #available(iOS 16.0, *) {
                request.revision = VNRecognizeTextRequestRevision3
                request.automaticallyDetectsLanguage = langs.isEmpty
            }
            if !langs.isEmpty { request.recognitionLanguages = langs }
            let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                call.reject(error.localizedDescription, "failed")
                return
            }
            // Vision: normalized, origin bottom left → pixels, origin top left
            func box(_ r: CGRect) -> [Double] {
                [Double(r.minX) * w, (1 - Double(r.maxY)) * h, Double(r.width) * w, Double(r.height) * h]
            }
            var lines: [[String: Any]] = []
            for obs in request.results ?? [] {
                guard let cand = obs.topCandidates(1).first else { continue }
                let text = cand.string
                var words: [[String: Any]] = []
                // words = runs of non-space characters (punctuation stays with its word, like the engine's words)
                var i = text.startIndex
                while i < text.endIndex {
                    while i < text.endIndex, text[i].isWhitespace { i = text.index(after: i) }
                    guard i < text.endIndex else { break }
                    var j = i
                    while j < text.endIndex, !text[j].isWhitespace { j = text.index(after: j) }
                    let r = i..<j
                    let rect = (try? cand.boundingBox(for: r))?.boundingBox ?? obs.boundingBox
                    words.append(["text": String(text[r]), "conf": Double(cand.confidence), "box": box(rect)])
                    i = j
                }
                if words.isEmpty, !text.trimmingCharacters(in: .whitespaces).isEmpty {
                    words.append(["text": text, "conf": Double(cand.confidence), "box": box(obs.boundingBox)])
                }
                lines.append(["text": text, "conf": Double(cand.confidence), "box": box(obs.boundingBox), "words": words])
            }
            call.resolve(["width": w, "height": h, "lines": lines])
        }
    }
}
