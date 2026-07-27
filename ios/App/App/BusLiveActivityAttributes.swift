import ActivityKit
import Foundation

struct BusLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var arrivalStatus: String
        var nextArrivalTiming: String
        var thirdArrivalTiming: String
        var arrivalVisitNumber: Int?
        var nextArrivalVisitNumber: Int?
        var thirdArrivalVisitNumber: Int?
        var busType: String
        var wheelchairAccessible: Bool
        var seatAvailability: String
        var arrivalAt: Date
        var lastUpdatedAt: Date
    }

    var serviceNo: String
    var busStopName: String
    var busStopCode: String
    var startedAt: Date
}
