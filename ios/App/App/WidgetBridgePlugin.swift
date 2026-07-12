import Capacitor
import Foundation
import WidgetKit
import ActivityKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startBusLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateBusLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endBusLiveActivity", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupId = "group.com.daryledwin.bus"
    private let pushTokenObservationStore = PushTokenObservationStore()

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
            let pinnedBusServices = widgetData.pinnedBusServices ?? [:]
            let pinnedBusServicesData = try JSONEncoder().encode(pinnedBusServices)

            defaults.set(favouritesData, forKey: "widgetFavouriteStops")
            defaults.set(pinnedBusServicesData, forKey: "widgetPinnedBusServices")
            pinnedBusServices.keys.forEach { busStopCode in
                defaults.set(0, forKey: "widgetBusPageIndex_\(busStopCode)")
            }

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

    @objc func startBusLiveActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities are unavailable on this iOS version.")
            return
        }

        let activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        print("[LiveTrack] areActivitiesEnabled: \(activitiesEnabled)")

        guard activitiesEnabled else {
            call.reject("Live Activities are disabled.")
            return
        }

        guard let payload = decodeLiveActivityPayload(call) else {
            call.reject("Missing Live Activity payload.")
            return
        }

        Task {
            await endAllBusLiveActivities()

            do {
                let activity = try requestLiveActivity(payload: payload)
                observePushTokenUpdates(for: activity)
                print("[LiveTrack] Activity.request success id: \(activity.id)")
                print("[LiveTrack] push token pending")
                call.resolve([
                    "started": true,
                    "activityId": activity.id,
                    "pushEnabled": true,
                    "pushTokenPending": true
                ])
            } catch {
                print("[LiveTrack] Activity.request failed: \(String(describing: error))")
                call.reject("Could not start push-enabled Live Activity.", nil, error)
            }
        }
    }

    @objc func updateBusLiveActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities are unavailable on this iOS version.")
            return
        }

        guard let payload = decodeLiveActivityPayload(call) else {
            call.reject("Missing Live Activity payload.")
            return
        }

        print("[LiveTrack] updateBusLiveActivity payload decoded service=\(payload.serviceNo) stop=\(payload.busStopCode) arrival=\(payload.arrivalStatus) arrivalAtMs=\(payload.arrivalAt) lastUpdatedAtMs=\(payload.lastUpdatedAt) lastUpdatedAtDate=\(payload.contentState.lastUpdatedAt)")
        Task {
            guard let activity = Activity<BusLiveActivityAttributes>.activities.first(where: {
                $0.attributes.serviceNo == payload.serviceNo && $0.attributes.busStopCode == payload.busStopCode
            }) else {
                print("[LiveTrack] native update skipped: no matching ActivityKit activity service=\(payload.serviceNo) stop=\(payload.busStopCode)")
                call.resolve()
                return
            }

            print("[LiveTrack] native Activity.update called service=\(payload.serviceNo) stop=\(payload.busStopCode) arrival=\(payload.arrivalStatus) lastUpdatedAt=\(payload.contentState.lastUpdatedAt)")
            await activity.update(ActivityContent(
                state: payload.contentState,
                staleDate: payload.expiresAtDate
            ))
            print("[LiveTrack] native Activity.update called successfully service=\(payload.serviceNo) stop=\(payload.busStopCode) lastUpdatedAt=\(payload.contentState.lastUpdatedAt)")
            call.resolve()
        }
    }

    @objc func endBusLiveActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }

        Task {
            await endAllBusLiveActivities()
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private func endAllBusLiveActivities() async {
        for activity in Activity<BusLiveActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    @available(iOS 16.2, *)
    private func requestLiveActivity(
        payload: BusLiveActivityPayload
    ) throws -> Activity<BusLiveActivityAttributes> {
        let attributes = BusLiveActivityAttributes(
            serviceNo: payload.serviceNo,
            busStopName: payload.busStopName,
            busStopCode: payload.busStopCode,
            startedAt: payload.startedAtDate
        )
        let content = ActivityContent(
            state: payload.contentState,
            staleDate: payload.expiresAtDate
        )

        print("[LiveTrack] requesting Activity with pushType token")
        return try Activity<BusLiveActivityAttributes>.request(
            attributes: attributes,
            content: content,
            pushType: .token
        )
    }

    @available(iOS 16.2, *)
    private func observePushTokenUpdates(for activity: Activity<BusLiveActivityAttributes>) {
        let observationStore = pushTokenObservationStore

        Task { [weak self, observationStore] in
            guard let plugin = self else {
                return
            }

            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                await observationStore.insert(activity.id)
                print("[LiveTrack] push token received")
                plugin.notifyListeners("busLiveActivityPushToken", data: [
                    "activityId": activity.id,
                    "pushToken": token
                ])
            }
        }

        Task { [observationStore] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            let tokenWasObserved = await observationStore.contains(activity.id)

            if tokenWasObserved {
                return
            }

            #if targetEnvironment(simulator)
            print("[LiveTrack] push token unavailable on simulator")
            #else
            print("[LiveTrack] push token pending")
            #endif
        }
    }

    @available(iOS 16.2, *)
    private func decodeLiveActivityPayload(_ call: CAPPluginCall) -> BusLiveActivityPayload? {
        guard let payload = call.getString("payload"),
              let data = payload.data(using: .utf8) else {
            return nil
        }

        return try? JSONDecoder().decode(BusLiveActivityPayload.self, from: data)
    }
}

private actor PushTokenObservationStore {
    private var activityIds = Set<String>()

    func insert(_ activityId: String) {
        activityIds.insert(activityId)
    }

    func contains(_ activityId: String) -> Bool {
        activityIds.contains(activityId)
    }
}

private struct WidgetDataPayload: Codable {
    let favourites: [WidgetFavouriteStop]
    let selectedBusStop: WidgetFavouriteStop?
    let nearestBusStop: WidgetFavouriteStop?
    let pinnedBusServices: [String: [String]]?
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

private struct BusLiveActivityPayload: Codable {
    let serviceNo: String
    let busStopName: String
    let busStopCode: String
    let arrivalStatus: String
    let nextArrivalTiming: String
    let thirdArrivalTiming: String
    let busType: String
    let wheelchairAccessible: Bool
    let seatAvailability: String
    let arrivalAt: Double
    let lastUpdatedAt: Double
    let startedAt: Double
    let expiresAt: Double

    var startedAtDate: Date {
        Date(timeIntervalSince1970: startedAt / 1000)
    }

    var expiresAtDate: Date {
        Date(timeIntervalSince1970: expiresAt / 1000)
    }

    @available(iOS 16.2, *)
    var contentState: BusLiveActivityAttributes.ContentState {
        BusLiveActivityAttributes.ContentState(
            arrivalStatus: arrivalStatus,
            nextArrivalTiming: nextArrivalTiming,
            thirdArrivalTiming: thirdArrivalTiming,
            busType: busType,
            wheelchairAccessible: wheelchairAccessible,
            seatAvailability: seatAvailability,
            arrivalAt: Date(timeIntervalSince1970: arrivalAt / 1000),
            lastUpdatedAt: Date(timeIntervalSince1970: lastUpdatedAt / 1000)
        )
    }
}
