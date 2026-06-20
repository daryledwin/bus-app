import Capacitor
import Foundation
import WidgetKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncWidgetData", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupId = "group.com.daryledwin.bus"

    @objc func syncWidgetData(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else {
            call.reject("App Group storage is unavailable. Check App Group signing capability.")
            return
        }

        guard let payload = call.getString("payload"),
              let data = payload.data(using: .utf8) else {
            call.reject("Missing widget data payload.")
            return
        }

        do {
            let widgetData = try JSONDecoder().decode(WidgetDataPayload.self, from: data)
            let favouritesData = try JSONEncoder().encode(widgetData.favourites)

            defaults.set(favouritesData, forKey: "widgetFavouriteStops")

            if let selectedBusStop = widgetData.selectedBusStop {
                let selectedBusStopData = try JSONEncoder().encode(selectedBusStop)
                defaults.set(selectedBusStopData, forKey: "widgetSelectedBusStop")
            } else {
                defaults.removeObject(forKey: "widgetSelectedBusStop")
            }

            if let nearestBusStop = widgetData.nearestBusStop {
                let nearestBusStopData = try JSONEncoder().encode(nearestBusStop)
                defaults.set(nearestBusStopData, forKey: "widgetNearestBusStop")
            } else {
                defaults.removeObject(forKey: "widgetNearestBusStop")
            }

            if let location = widgetData.lastLocation {
                let locationData = try JSONEncoder().encode(location)
                defaults.set(locationData, forKey: "widgetLastLocation")
            } else {
                defaults.removeObject(forKey: "widgetLastLocation")
            }

            defaults.synchronize()
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Could not sync widget data.", nil, error)
        }
    }
}

private struct WidgetDataPayload: Codable {
    let favourites: [WidgetFavouriteStop]
    let selectedBusStop: WidgetFavouriteStop?
    let nearestBusStop: WidgetFavouriteStop?
    let lastLocation: WidgetLocation?
}

private struct WidgetFavouriteStop: Codable {
    let busStopCode: String
    let name: String
    let roadName: String
    let nickname: String?
    let latitude: Double?
    let longitude: Double?
}

private struct WidgetLocation: Codable {
    let latitude: Double
    let longitude: Double
    let savedAt: Double?
}
