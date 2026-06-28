import AppIntents
import SwiftUI
import WidgetKit

private let appGroupId = "group.com.daryledwin.bus"
private let arrivalEndpoint = URL(string: "https://bus-app-vk72.onrender.com/api/bus-arrival")!
private let widgetKind = "BusArrivalWidget"

struct FavouriteStop: Codable, Identifiable {
    let busStopCode: String
    let name: String
    let roadName: String
    let nickname: String?
    let latitude: Double?
    let longitude: Double?

    var id: String { busStopCode }

    var displayName: String {
        guard let nickname, !nickname.isEmpty else {
            return name
        }

        return nickname
    }
}

struct WidgetBus: Codable, Identifiable {
    let serviceNo: String
    let timing: String
    let load: String
    let wheelchairAccessible: Bool
    let type: String

    var id: String { serviceNo }

    init(serviceNo: String, timing: String, load: String, wheelchairAccessible: Bool, type: String) {
        self.serviceNo = serviceNo
        self.timing = timing
        self.load = load
        self.wheelchairAccessible = wheelchairAccessible
        self.type = type
    }

    enum CodingKeys: String, CodingKey {
        case serviceNo
        case timing
        case load
        case wheelchairAccessible
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        serviceNo = try container.decode(String.self, forKey: .serviceNo)
        timing = try container.decode(String.self, forKey: .timing)
        load = (try? container.decode(String.self, forKey: .load)) ?? "Load unavailable"
        wheelchairAccessible = (try? container.decode(Bool.self, forKey: .wheelchairAccessible)) ?? false
        type = (try? container.decode(String.self, forKey: .type)) ?? "Type unavailable"
    }
}

struct CachedArrivals: Codable {
    let buses: [WidgetBus]
    let updatedAt: Double
}

struct LtaArrivalResponse: Decodable {
    let services: [LtaService]

    enum CodingKeys: String, CodingKey {
        case services = "Services"
    }
}

struct LtaService: Decodable {
    let serviceNo: String
    let nextBus: LtaBus

    enum CodingKeys: String, CodingKey {
        case serviceNo = "ServiceNo"
        case nextBus = "NextBus"
    }
}

struct LtaBus: Decodable {
    let estimatedArrival: String?
    let load: String?
    let feature: String?
    let type: String?

    enum CodingKeys: String, CodingKey {
        case estimatedArrival = "EstimatedArrival"
        case load = "Load"
        case feature = "Feature"
        case type = "Type"
    }
}

struct WidgetStopEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Favourite Stop")
    static let defaultQuery = WidgetStopQuery()

    let id: String
    let name: String
    let roadName: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(roadName) · \(id)"
        )
    }
}

struct WidgetStopQuery: EntityQuery {
    func entities(for identifiers: [WidgetStopEntity.ID]) async throws -> [WidgetStopEntity] {
        WidgetStore.loadFavourites()
            .filter { identifiers.contains($0.busStopCode) }
            .map { WidgetStopEntity(id: $0.busStopCode, name: $0.displayName, roadName: $0.roadName) }
    }

    func suggestedEntities() async throws -> [WidgetStopEntity] {
        WidgetStore.loadFavourites()
            .map { WidgetStopEntity(id: $0.busStopCode, name: $0.displayName, roadName: $0.roadName) }
    }

    func defaultResult() async -> WidgetStopEntity? {
        WidgetStore.loadFavourites().first.map {
            WidgetStopEntity(id: $0.busStopCode, name: $0.displayName, roadName: $0.roadName)
        }
    }
}

struct BusWidgetConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "MyBus Widget"
    static var description = IntentDescription("Choose which favourite bus stop this widget displays.")

    @Parameter(title: "Favourite Stop")
    var favouriteStop: WidgetStopEntity?

    @Parameter(title: "Use Nearest Favourite", default: false)
    var useNearestFavourite: Bool
}

struct BusWidgetEntry: TimelineEntry {
    let date: Date
    let stop: FavouriteStop?
    let buses: [WidgetBus]
    let lastUpdatedAt: Date?
    let message: String
    let isPlaceholder: Bool
    let pageIndex: Int
}

enum WidgetStore {
    private static let favouritesKey = "widgetFavouriteStops"
    private static let selectedBusStopKey = "widgetSelectedBusStop"
    private static let nearestBusStopKey = "widgetNearestBusStop"

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static func selectedStop(for configuration: BusWidgetConfigurationIntent) -> FavouriteStop? {
        let favourites = loadFavourites()

        guard !favourites.isEmpty else {
            return nil
        }

        if configuration.useNearestFavourite {
            guard let nearestStop = loadNearestBusStop(),
                  favourites.contains(where: { $0.busStopCode == nearestStop.busStopCode }) else {
                return nil
            }

            return nearestStop
        }

        if let configuredStop = configuration.favouriteStop,
           let selected = favourites.first(where: { $0.busStopCode == configuredStop.id }) {
            return selected
        }

        return nil
    }

    static func loadFavourites() -> [FavouriteStop] {
        guard let data = defaults?.data(forKey: favouritesKey),
              let stops = try? JSONDecoder().decode([FavouriteStop].self, from: data) else {
            return []
        }

        return stops.filter { !$0.busStopCode.isEmpty && !$0.name.isEmpty }
    }

    static func loadSelectedBusStop() -> FavouriteStop? {
        loadSharedStop(forKey: selectedBusStopKey)
    }

    static func loadNearestBusStop() -> FavouriteStop? {
        loadSharedStop(forKey: nearestBusStopKey)
    }

    static func cachedArrivals(for busStopCode: String) -> CachedArrivals? {
        guard let data = defaults?.data(forKey: cachedArrivalsKey(busStopCode)) else {
            return nil
        }

        return try? JSONDecoder().decode(CachedArrivals.self, from: data)
    }

    static func saveCachedArrivals(_ buses: [WidgetBus], for busStopCode: String, updatedAt: Date = Date()) {
        guard let defaults,
              let data = try? JSONEncoder().encode(CachedArrivals(buses: buses, updatedAt: updatedAt.timeIntervalSince1970)) else {
            return
        }

        defaults.set(data, forKey: cachedArrivalsKey(busStopCode))
        defaults.synchronize()
    }

    static func loadArrivals(for busStopCode: String, fetchRemote: Bool = true) async -> CachedArrivals? {
        if !fetchRemote {
            return cachedArrivals(for: busStopCode)
        }

        var components = URLComponents(url: arrivalEndpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "busStopCode", value: busStopCode)]

        guard let url = components?.url else {
            return cachedArrivals(for: busStopCode)
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(LtaArrivalResponse.self, from: data)
            let buses = response.services.map {
                WidgetBus(
                    serviceNo: $0.serviceNo,
                    timing: arrivalText(from: $0.nextBus.estimatedArrival),
                    load: loadText(from: $0.nextBus.load),
                    wheelchairAccessible: $0.nextBus.feature == "WAB",
                    type: typeText(from: $0.nextBus.type)
                )
            }
            let updatedAt = Date()
            saveCachedArrivals(buses, for: busStopCode, updatedAt: updatedAt)
            return CachedArrivals(buses: buses, updatedAt: updatedAt.timeIntervalSince1970)
        } catch {
            return cachedArrivals(for: busStopCode)
        }
    }

    static func pageIndex(for busStopCode: String, pageSize: Int, totalServices: Int) -> Int {
        let totalPages = max(1, Int(ceil(Double(totalServices) / Double(max(1, pageSize)))))
        let page = defaults?.integer(forKey: pageIndexKey(busStopCode)) ?? 0
        return min(max(0, page), totalPages - 1)
    }

    static func setPageIndex(for busStopCode: String, pageIndex: Int, pageSize: Int, totalServices: Int) {
        let totalPages = max(1, Int(ceil(Double(totalServices) / Double(max(1, pageSize)))))
        let clampedPage = min(max(0, pageIndex), totalPages - 1)
        defaults?.set(clampedPage, forKey: pageIndexKey(busStopCode))
        defaults?.synchronize()
    }

    static func movePage(for busStopCode: String, direction: Int, pageSize: Int) {
        guard let cached = cachedArrivals(for: busStopCode), !cached.buses.isEmpty else {
            setPageIndex(for: busStopCode, pageIndex: 0, pageSize: pageSize, totalServices: 0)
            return
        }

        let totalPages = max(1, Int(ceil(Double(cached.buses.count) / Double(max(1, pageSize)))))
        let currentPage = pageIndex(for: busStopCode, pageSize: pageSize, totalServices: cached.buses.count)
        let nextPage = (currentPage + direction + totalPages) % totalPages
        setPageIndex(for: busStopCode, pageIndex: nextPage, pageSize: pageSize, totalServices: cached.buses.count)
    }

    private static func loadSharedStop(forKey key: String) -> FavouriteStop? {
        guard let data = defaults?.data(forKey: key),
              let stop = try? JSONDecoder().decode(FavouriteStop.self, from: data),
              !stop.busStopCode.isEmpty,
              !stop.name.isEmpty else {
            return nil
        }

        return stop
    }

    private static func cachedArrivalsKey(_ busStopCode: String) -> String {
        "widgetCachedArrivals_\(busStopCode)"
    }

    private static func pageIndexKey(_ busStopCode: String) -> String {
        "widgetBusPageIndex_\(busStopCode)"
    }

    private static func arrivalText(from value: String?) -> String {
        guard let value, !value.isEmpty, let date = ISO8601DateFormatter().date(from: value) else {
            return "--"
        }

        let minutes = Int(date.timeIntervalSince(Date()) / 60)
        if minutes <= 0 {
            return "Arr"
        }

        return "\(minutes) min"
    }

    private static func loadText(from value: String?) -> String {
        switch value {
        case "SEA":
            return "Seats available"
        case "SDA":
            return "Few seats left"
        case "LSD":
            return "No chance of a seat"
        default:
            return "Load unavailable"
        }
    }

    private static func typeText(from value: String?) -> String {
        switch value {
        case "SD":
            return "Single deck"
        case "DD":
            return "Double deck"
        case "BD":
            return "Bendy bus"
        default:
            return "Type unavailable"
        }
    }

}

struct BusWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> BusWidgetEntry {
        BusWidgetEntry(
            date: Date(),
            stop: FavouriteStop(busStopCode: "59009", name: "Opp Blk 932", roadName: "Yishun Ctrl 1", nickname: "Home", latitude: nil, longitude: nil),
            buses: [
                WidgetBus(serviceNo: "156", timing: "3 min", load: "Seats available", wheelchairAccessible: true, type: "Double deck"),
                WidgetBus(serviceNo: "53", timing: "Arr", load: "Few seats left", wheelchairAccessible: true, type: "Single deck")
            ],
            lastUpdatedAt: Date(),
            message: "",
            isPlaceholder: true,
            pageIndex: 0
        )
    }

    func snapshot(for configuration: BusWidgetConfigurationIntent, in context: Context) async -> BusWidgetEntry {
        await entry(for: configuration)
    }

    func timeline(for configuration: BusWidgetConfigurationIntent, in context: Context) async -> Timeline<BusWidgetEntry> {
        let currentEntry = await entry(for: configuration, fetchRemote: true, date: Date())
        let entries = timelineEntries(from: currentEntry)
        let refreshDate = Calendar.current.date(byAdding: .minute, value: 12, to: Date()) ?? Date().addingTimeInterval(720)
        return Timeline(entries: entries, policy: .after(refreshDate))
    }

    private func timelineEntries(from entry: BusWidgetEntry) -> [BusWidgetEntry] {
        guard entry.lastUpdatedAt != nil else {
            return [entry]
        }

        let now = Date()
        let offsets: [TimeInterval] = [0, 10, 30, 60, 120, 300, 600]

        return offsets.map { offset in
            BusWidgetEntry(
                date: now.addingTimeInterval(offset),
                stop: entry.stop,
                buses: entry.buses,
                lastUpdatedAt: entry.lastUpdatedAt,
                message: entry.message,
                isPlaceholder: entry.isPlaceholder,
                pageIndex: entry.pageIndex
            )
        }
    }

    private func entry(for configuration: BusWidgetConfigurationIntent, fetchRemote: Bool = true, date: Date = Date()) async -> BusWidgetEntry {
        guard let stop = WidgetStore.selectedStop(for: configuration) else {
            let hasFavourites = !WidgetStore.loadFavourites().isEmpty
            let message = configuration.useNearestFavourite
                ? (hasFavourites ? "Open the app to update nearest stop." : "Add favourite stops in MyBus to use this widget.")
                : (hasFavourites ? "Edit widget to choose a favourite stop." : "Add favourite stops in MyBus to use this widget.")
            return BusWidgetEntry(
                date: date,
                stop: nil,
                buses: [],
                lastUpdatedAt: nil,
                message: message,
                isPlaceholder: false,
                pageIndex: 0
            )
        }

        let cached = await WidgetStore.loadArrivals(for: stop.busStopCode, fetchRemote: fetchRemote)
        let buses = cached?.buses ?? []
        let pageIndex = WidgetStore.pageIndex(for: stop.busStopCode, pageSize: 3, totalServices: buses.count)

        return BusWidgetEntry(
            date: date,
            stop: stop,
            buses: buses,
            lastUpdatedAt: cached.map { Date(timeIntervalSince1970: $0.updatedAt) },
            message: "",
            isPlaceholder: false,
            pageIndex: pageIndex
        )
    }
}

struct RefreshWidgetArrivalsIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh Bus Arrivals"

    @Parameter(title: "Bus Stop Code")
    var busStopCode: String

    init() {
        busStopCode = ""
    }

    init(busStopCode: String) {
        self.busStopCode = busStopCode
    }

    func perform() async throws -> some IntentResult {
        if !busStopCode.isEmpty {
            _ = await WidgetStore.loadArrivals(for: busStopCode)
            WidgetStore.setPageIndex(for: busStopCode, pageIndex: 0, pageSize: 3, totalServices: WidgetStore.cachedArrivals(for: busStopCode)?.buses.count ?? 0)
        }

        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
        return .result()
    }
}

struct PageWidgetServicesIntent: AppIntent {
    static var title: LocalizedStringResource = "Change Widget Bus Page"

    @Parameter(title: "Bus Stop Code")
    var busStopCode: String

    @Parameter(title: "Direction")
    var direction: Int

    init() {
        busStopCode = ""
        direction = 1
    }

    init(busStopCode: String, direction: Int) {
        self.busStopCode = busStopCode
        self.direction = direction
    }

    func perform() async throws -> some IntentResult {
        if !busStopCode.isEmpty {
            WidgetStore.movePage(for: busStopCode, direction: direction, pageSize: 3)
        }

        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
        return .result()
    }
}

struct BusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BusWidgetEntry

    var body: some View {
        Group {
            if family == .systemSmall {
                smallBody
            } else {
                mediumBody
            }
        }
        .widgetBackground(widgetBackground)
        .widgetURL(widgetURL)
    }

    private var widgetBackground: some View {
        LinearGradient(
            colors: [Color(red: 0.88, green: 0.97, blue: 1.0), Color(red: 0.96, green: 0.99, blue: 1.0)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var mediumBody: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
                .frame(height: headerHeight, alignment: .top)
                .frame(maxWidth: .infinity)

            if let stop = entry.stop {
                Text(stop.roadName.isEmpty ? stop.busStopCode : "\(stop.roadName) · \(stop.busStopCode)")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                    .lineLimit(1)

                busList
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                Spacer(minLength: 4)
                Text(entry.message)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.top, 13)
        .padding(.horizontal, 13)
        .padding(.bottom, 8)
    }

    private var smallBody: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(entry.stop?.displayName ?? "MyBus SG")
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .foregroundColor(Color(red: 0.08, green: 0.18, blue: 0.30))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(alignment: .center, spacing: 6) {
                if let lastUpdatedAt = entry.lastUpdatedAt {
                    smallUpdatedStatus(from: lastUpdatedAt)
                } else if entry.stop == nil {
                    Text("MyBus SG")
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                }

                Spacer(minLength: 2)

                refreshControl
            }

            if entry.stop != nil {
                smallBusList
            } else {
                Spacer(minLength: 2)
                Text(entry.message)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.top, 12)
        .padding(.horizontal, 11)
        .padding(.bottom, 9)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(entry.stop?.displayName ?? "MyBus SG")
                .font(.system(size: 15, weight: .heavy, design: .rounded))
                .foregroundColor(Color(red: 0.08, green: 0.18, blue: 0.30))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .trailing, spacing: 3) {
                if let lastUpdatedAt = entry.lastUpdatedAt {
                    updatedStatus(from: lastUpdatedAt)
                }

                refreshControl
            }
            .frame(width: family == .systemMedium ? 122 : 90, alignment: .trailing)
        }
    }

    @ViewBuilder
    private var refreshControl: some View {
        if let code = entry.stop?.busStopCode {
            Button(intent: RefreshWidgetArrivalsIntent(busStopCode: code)) {
                refreshLabel
            }
            .buttonStyle(.plain)
        } else {
            Image(systemName: "bus.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                .padding(7)
                .background(Color.white.opacity(0.72))
                .clipShape(Circle())
        }
    }

    private var refreshLabel: some View {
        HStack(spacing: 4) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: family == .systemSmall ? 8 : 10, weight: .heavy))
            Text("LIVE")
                .font(.system(size: family == .systemSmall ? 8 : 9, weight: .heavy, design: .rounded))
        }
        .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
        .padding(.vertical, family == .systemSmall ? 3 : 4)
        .padding(.horizontal, family == .systemSmall ? 6 : 7)
        .background(Color.white.opacity(0.72))
        .clipShape(Capsule())
    }

    private func updatedStatus(from date: Date) -> some View {
        HStack(spacing: 2) {
            Text("Updated")
            Text(date, style: .relative)
        }
        .font(.system(size: family == .systemMedium ? 9 : 8, weight: .bold, design: .rounded))
        .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
        .lineLimit(1)
        .minimumScaleFactor(0.76)
        .monospacedDigit()
    }

    private func smallUpdatedStatus(from date: Date) -> some View {
        Text(date, style: .relative)
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .monospacedDigit()
    }

    private var busList: some View {
        VStack(spacing: family == .systemMedium ? 3 : 3) {
            ForEach(visibleBuses) { bus in
                HStack(spacing: family == .systemMedium ? 4 : 6) {
                    Text(bus.serviceNo)
                        .font(.system(size: family == .systemMedium ? 14 : 13, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .frame(width: family == .systemMedium ? 34 : 30, alignment: .leading)
                        .layoutPriority(3)

                    mediumBusIndicators(for: bus)

                    Spacer(minLength: 6)

                    Text(bus.timing)
                        .font(.system(size: family == .systemMedium ? 15 : 13, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 0.08, green: 0.18, blue: 0.30))
                        .lineLimit(1)
                        .layoutPriority(2)
                }
                .padding(.vertical, family == .systemMedium ? 3 : 2)
                .padding(.horizontal, family == .systemMedium ? 7 : 6)
                .background(Color.white.opacity(0.62))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }

            if entry.buses.isEmpty {
                Text("No arrivals available")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if canPageServices && totalPages > 1 {
                pageControls
            } else if remainingBusCount > 0 {
                moreIndicator
            }
        }
    }

    private var smallBusList: some View {
        VStack(spacing: 4) {
            ForEach(smallVisibleBuses) { bus in
                HStack(spacing: 6) {
                    Text(bus.serviceNo)
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)

                    Spacer(minLength: 4)

                    Text(bus.timing)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 0.08, green: 0.18, blue: 0.30))
                        .lineLimit(1)
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
                .background(Color.white.opacity(0.64))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }

            if entry.buses.isEmpty {
                Text("No arrivals available")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if smallRemainingBusCount > 0 {
                Text("+\(smallRemainingBusCount) more")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private func mediumBusIndicators(for bus: WidgetBus) -> some View {
        HStack(spacing: 3) {
            if bus.type != "Type unavailable" {
                busTypeMetadataChip(for: bus.type)
            }

            systemMetadataChip(
                systemName: "figure.roll",
                text: bus.wheelchairAccessible ? "Wheelchair" : "Not Wheelchair",
                color: bus.wheelchairAccessible ? appAccessibleColor : appNotAccessibleColor,
                background: (bus.wheelchairAccessible ? appAccessibleColor : appNotAccessibleColor).opacity(0.10),
                accessibilityLabel: bus.wheelchairAccessible ? "Wheelchair accessible" : "Not wheelchair accessible"
            )

            if bus.load != "Load unavailable" {
                systemMetadataChip(
                    systemName: "chair.fill",
                    text: loadCompactLabel(bus.load),
                    color: loadColor(bus.load),
                    background: loadBackgroundColor(bus.load),
                    accessibilityLabel: bus.load
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .layoutPriority(0)
    }

    private func busTypeMetadataChip(for type: String) -> some View {
        HStack(alignment: .center, spacing: 5) {
            WidgetBusTypeGlyph(type: type, color: busTypeColor(type))
                .frame(width: 12, height: 10, alignment: .center)
                .accessibilityHidden(true)

            Text(busTypeCompactLabel(type))
                .font(.system(size: 7.6, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .layoutPriority(-1)
        }
        .foregroundColor(busTypeColor(type))
        .padding(.vertical, 2.4)
        .padding(.horizontal, 3)
        .background(busTypeColor(type).opacity(0.10))
        .clipShape(Capsule())
        .accessibilityLabel(busTypeDisplayLabel(type))
    }

    private func systemMetadataChip(
        systemName: String,
        text: String,
        color: Color,
        background: Color,
        accessibilityLabel: String
    ) -> some View {
        HStack(spacing: 2) {
            Image(systemName: systemName)
                .font(.system(size: 7.4, weight: .bold))
                .accessibilityHidden(true)

            Text(text)
                .font(.system(size: 7.6, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .layoutPriority(-1)
        }
        .foregroundColor(color)
        .padding(.vertical, 2.4)
        .padding(.horizontal, 3)
        .background(background)
        .clipShape(Capsule())
        .accessibilityLabel(accessibilityLabel)
    }

    private var visibleBusLimit: Int {
        family == .systemMedium ? 3 : 2
    }

    private var headerHeight: CGFloat {
        family == .systemMedium ? 38 : 44
    }

    private var visibleBuses: [WidgetBus] {
        if !canPageServices {
            return Array(entry.buses.prefix(visibleBusLimit))
        }

        let startIndex = pageStartIndex
        let endIndex = min(entry.buses.count, startIndex + visibleBusLimit)

        guard startIndex < endIndex else {
            return Array(entry.buses.prefix(visibleBusLimit))
        }

        return Array(entry.buses[startIndex..<endIndex])
    }

    private var smallVisibleBuses: [WidgetBus] {
        Array(entry.buses.prefix(2))
    }

    private var smallRemainingBusCount: Int {
        max(0, entry.buses.count - smallVisibleBuses.count)
    }

    private var remainingBusCount: Int {
        max(0, entry.buses.count - visibleBuses.count)
    }

    private var pageStartIndex: Int {
        min(entry.buses.count, currentPageIndex * visibleBusLimit)
    }

    private var currentPageIndex: Int {
        if !canPageServices {
            return 0
        }

        return min(max(0, entry.pageIndex), max(0, totalPages - 1))
    }

    private var canPageServices: Bool {
        family == .systemMedium
    }

    private var totalPages: Int {
        guard entry.buses.count > visibleBusLimit else {
            return 1
        }

        return Int(ceil(Double(entry.buses.count) / Double(visibleBusLimit)))
    }

    private var pageControls: some View {
        HStack(spacing: 6) {
            pageButton(systemName: "chevron.left", direction: -1)

            HStack(spacing: 3) {
                ForEach(0..<totalPages, id: \.self) { page in
                    Circle()
                        .fill(page == currentPageIndex
                              ? Color(red: 0.10, green: 0.47, blue: 0.79)
                              : Color(red: 0.10, green: 0.47, blue: 0.79).opacity(0.24))
                        .frame(width: page == currentPageIndex ? 4.5 : 3.5, height: page == currentPageIndex ? 4.5 : 3.5)
                }
            }

            Text("Page \(currentPageIndex + 1)/\(totalPages)")
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                .lineLimit(1)

            Spacer(minLength: 0)

            pageButton(systemName: "chevron.right", direction: 1)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 1)
    }

    private var moreIndicator: some View {
        Text("+\(remainingBusCount) more")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func pageButton(systemName: String, direction: Int) -> some View {
        Button(intent: PageWidgetServicesIntent(busStopCode: entry.stop?.busStopCode ?? "", direction: direction)) {
            Image(systemName: systemName)
                .font(.system(size: 9, weight: .heavy))
                .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                .frame(width: 24, height: 19)
                .background(Color.white.opacity(0.66))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var widgetURL: URL? {
        guard let code = entry.stop?.busStopCode else {
            return URL(string: "skibidi://home")
        }

        return URL(string: "skibidi://stop/\(code)")
    }

    private func loadColor(_ load: String) -> Color {
        switch load {
        case "Seats available":
            return appAccessibleColor
        case "Few seats left":
            return appStandingColor
        case "No chance of a seat":
            return appCrowdedColor
        default:
            return appMutedColor
        }
    }

    private func loadBackgroundColor(_ load: String) -> Color {
        switch load {
        case "Seats available":
            return Color(red: 30 / 255, green: 190 / 255, blue: 149 / 255).opacity(0.14)
        case "Few seats left":
            return Color(red: 255 / 255, green: 215 / 255, blue: 75 / 255).opacity(0.28)
        case "No chance of a seat":
            return Color(red: 255 / 255, green: 167 / 255, blue: 107 / 255).opacity(0.22)
        default:
            return Color(red: 132 / 255, green: 115 / 255, blue: 100 / 255).opacity(0.10)
        }
    }

    private func busTypeColor(_ type: String) -> Color {
        switch type {
        case "Single deck":
            return appBlueColor
        case "Double deck":
            return appDoubleDeckColor
        case "Bendy bus":
            return appBendyBusColor
        default:
            return appMutedColor
        }
    }

    private func busTypeDisplayLabel(_ type: String) -> String {
        switch type {
        case "Single deck":
            return "Single Decker"
        case "Double deck":
            return "Double Decker"
        case "Bendy bus":
            return "Bendy Bus"
        default:
            return type
        }
    }

    private func busTypeCompactLabel(_ type: String) -> String {
        switch type {
        case "Single deck":
            return "Single"
        case "Double deck":
            return "Double"
        case "Bendy bus":
            return "Bendy"
        default:
            return type
        }
    }

    private func loadCompactLabel(_ load: String) -> String {
        switch load {
        case "No chance of a seat":
            return "No Seats"
        default:
            return load
        }
    }

    private var appBlueColor: Color {
        Color(red: 25 / 255, green: 119 / 255, blue: 201 / 255)
    }

    private var appMutedColor: Color {
        Color(red: 83 / 255, green: 109 / 255, blue: 132 / 255)
    }

    private var appAccessibleColor: Color {
        Color(red: 47 / 255, green: 158 / 255, blue: 110 / 255)
    }

    private var appNotAccessibleColor: Color {
        Color(red: 183 / 255, green: 90 / 255, blue: 99 / 255)
    }

    private var appDoubleDeckColor: Color {
        Color(red: 128 / 255, green: 111 / 255, blue: 174 / 255)
    }

    private var appBendyBusColor: Color {
        Color(red: 185 / 255, green: 120 / 255, blue: 34 / 255)
    }

    private var appStandingColor: Color {
        Color(red: 201 / 255, green: 138 / 255, blue: 31 / 255)
    }

    private var appCrowdedColor: Color {
        Color(red: 214 / 255, green: 90 / 255, blue: 90 / 255)
    }
}

private struct WidgetBusTypeGlyph: View {
    let type: String
    let color: Color

    var body: some View {
        Group {
            switch type {
            case "Double deck":
                doubleDeck
            case "Bendy bus":
                bendyBus
            default:
                singleDeck
            }
        }
        .foregroundColor(color)
    }

    private var singleDeck: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .stroke(color, lineWidth: 1)
                .frame(width: 16.5, height: 7.5)

            HStack(spacing: 1.5) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 0.8, style: .continuous)
                        .fill(color)
                        .frame(width: 3, height: 1.5)
                }
            }
            .offset(y: -0.8)

            HStack(spacing: 7.5) {
                Circle().fill(color).frame(width: 1.9, height: 1.9)
                Circle().fill(color).frame(width: 1.9, height: 1.9)
            }
            .offset(y: 4)
        }
    }

    private var doubleDeck: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2.6, style: .continuous)
                .stroke(color, lineWidth: 1)
                .frame(width: 15.5, height: 10.5)

            Rectangle()
                .fill(color.opacity(0.72))
                .frame(width: 12.4, height: 0.8)

            VStack(spacing: 1.5) {
                HStack(spacing: 1.2) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 0.7, style: .continuous)
                            .fill(color)
                            .frame(width: 2.6, height: 1.35)
                    }
                }

                HStack(spacing: 1.2) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 0.7, style: .continuous)
                            .fill(color)
                            .frame(width: 2.6, height: 1.35)
                    }
                }
            }
            .offset(y: -0.8)

            HStack(spacing: 6.8) {
                Circle().fill(color).frame(width: 1.8, height: 1.8)
                Circle().fill(color).frame(width: 1.8, height: 1.8)
            }
            .offset(y: 5.3)
        }
    }

    private var bendyBus: some View {
        ZStack {
            HStack(spacing: 1.3) {
                RoundedRectangle(cornerRadius: 2.3, style: .continuous)
                    .stroke(color, lineWidth: 1)
                    .frame(width: 8, height: 7.6)

                ZStack {
                    Rectangle().fill(color.opacity(0.68)).frame(width: 0.8, height: 6.8)
                    Rectangle().fill(color.opacity(0.42)).frame(width: 0.8, height: 6.8).offset(x: 1.5)
                    Rectangle().fill(color.opacity(0.42)).frame(width: 0.8, height: 6.8).offset(x: -1.5)
                }
                .frame(width: 3.8, height: 7.6)

                RoundedRectangle(cornerRadius: 2.3, style: .continuous)
                    .stroke(color, lineWidth: 1)
                    .frame(width: 8, height: 7.6)
            }

            HStack(spacing: 1.4) {
                RoundedRectangle(cornerRadius: 0.7, style: .continuous)
                    .fill(color)
                    .frame(width: 2.4, height: 1.4)
                RoundedRectangle(cornerRadius: 0.7, style: .continuous)
                    .fill(color)
                    .frame(width: 2.4, height: 1.4)
                Spacer().frame(width: 3.8)
                RoundedRectangle(cornerRadius: 0.7, style: .continuous)
                    .fill(color)
                    .frame(width: 2.4, height: 1.4)
                RoundedRectangle(cornerRadius: 0.7, style: .continuous)
                    .fill(color)
                    .frame(width: 2.4, height: 1.4)
            }
            .frame(width: 20)
            .offset(y: -1.1)

            HStack(spacing: 12.5) {
                Circle().fill(color).frame(width: 1.8, height: 1.8)
                Circle().fill(color).frame(width: 1.8, height: 1.8)
            }
            .offset(y: 4)
        }
    }
}

@main
struct BusWidgetBundle: WidgetBundle {
    var body: some Widget {
        BusArrivalWidget()
    }
}

struct BusArrivalWidget: Widget {
    let kind = widgetKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: BusWidgetConfigurationIntent.self, provider: BusWidgetProvider()) { entry in
            BusWidgetView(entry: entry)
        }
        .configurationDisplayName("MyBus SG Arrivals")
        .description("Live arrivals for a favourite stop you choose in Edit Widget.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private extension View {
    @ViewBuilder
    func widgetBackground<Background: View>(_ background: Background) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) {
                background
            }
        } else {
            self.background(background)
        }
    }
}
