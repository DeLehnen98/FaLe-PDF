import UIKit
import Capacitor

/// System print dialog for a PDF in the app cache – same JS API as the Android plugin:
/// FalePrint.printPdf({ path: "file:///…/Library/Caches/print/x.pdf", name })
@objc(FalePrintPlugin)
public class FalePrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FalePrintPlugin"
    public let jsName = "FalePrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printPdf", returnType: CAPPluginReturnPromise)
    ]

    @objc func printPdf(_ call: CAPPluginCall) {
        guard let raw = call.getString("path"), let url = FalePaths.fileURL(raw),
              FalePaths.isInside(url, FalePaths.caches()) else {
            call.reject("bad path", "failed")
            return
        }
        let name = call.getString("name") ?? "FaLe PDF"
        DispatchQueue.main.async {
            guard UIPrintInteractionController.canPrint(url) else {
                call.reject("cannot print", "failed")
                return
            }
            let pc = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = name
            info.outputType = .general
            pc.printInfo = info
            pc.printingItem = url
            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                try? FileManager.default.removeItem(at: url)
                if let error = error { call.reject(error.localizedDescription, "failed") } else { call.resolve(["ok": true, "completed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad, let view = self.bridge?.viewController?.view {
                pc.present(from: CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), in: view, animated: true, completionHandler: done)
            } else {
                pc.present(animated: true, completionHandler: done)
            }
        }
    }
}
