import Capacitor
import Foundation
import WidgetKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncFavouriteStop", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupId = "group.com.daryledwin.bus"

    @objc func syncFavouriteStop(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else {
            call.reject("App Group storage is unavailable. Check App Group signing capability.")
            return
        }

        guard let stopCode = call.getString("busStopCode") ?? call.getString("BusStopCode"),
              !stopCode.isEmpty else {
            defaults.removeObject(forKey: "widgetFavouriteStop")
            defaults.removeObject(forKey: "widgetFavouriteStopUpdatedAt")
            defaults.synchronize()
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
            return
        }

        let stop: [String: String] = [
            "busStopCode": stopCode,
            "name": call.getString("name") ?? call.getString("Description") ?? "Saved stop",
            "roadName": call.getString("roadName") ?? call.getString("RoadName") ?? "",
            "nickname": call.getString("nickname") ?? ""
        ]

        do {
            let data = try JSONEncoder().encode(stop)
            defaults.set(data, forKey: "widgetFavouriteStop")
            defaults.set(Date().timeIntervalSince1970, forKey: "widgetFavouriteStopUpdatedAt")
            defaults.synchronize()
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Could not sync favourite stop to the widget.", nil, error)
        }
    }
}
