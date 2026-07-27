import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.961, green: 0.961, blue: 0.949, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
        print("[Startup] native bridge viewDidLoad \(Date().timeIntervalSince1970)")
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
        print("[Startup] Capacitor loaded \(Date().timeIntervalSince1970)")
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(AppReviewPlugin())
    }
}
