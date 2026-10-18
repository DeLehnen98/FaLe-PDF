import UIKit
import Capacitor

/// Main view controller of the app (set in Main.storyboard by scripts/cap-patch-ios.mjs).
/// Registers the app's own plugins, which are not npm packages and therefore not found by `cap sync`.
@objc(FaleBridgeViewController)
open class FaleBridgeViewController: CAPBridgeViewController {
    open override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(FaleIncomingPlugin())
        bridge?.registerPluginInstance(FalePrintPlugin())
    }
}
