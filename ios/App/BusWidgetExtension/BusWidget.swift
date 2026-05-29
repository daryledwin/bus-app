import SwiftUI
import WidgetKit

private let appGroupId = "group.com.daryledwin.bus"
private let arrivalEndpoint = URL(string: "https://bus-app-vk72.onrender.com/api/bus-arrival")!

struct FavouriteStop: Decodable {
    let busStopCode: String
    let name: String
    let roadName: String
    let nickname: String

    var displayName: String {
        nickname.isEmpty ? name : nickname
    }
}

struct WidgetBus: Decodable, Identifiable {
    let id = UUID()
    let serviceNo: String
    let timing: String
    let load: String

    enum CodingKeys: String, CodingKey {
        case serviceNo
        case timing
        case load
    }
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

    enum CodingKeys: String, CodingKey {
        case estimatedArrival = "EstimatedArrival"
        case load = "Load"
    }
}

struct BusWidgetEntry: TimelineEntry {
    let date: Date
    let stop: FavouriteStop?
    let buses: [WidgetBus]
    let message: String
    let isPlaceholder: Bool
}

struct BusWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> BusWidgetEntry {
        BusWidgetEntry(
            date: Date(),
            stop: FavouriteStop(busStopCode: "59009", name: "Opp Blk 932", roadName: "Yishun Ctrl 1", nickname: "Home"),
            buses: [
                WidgetBus(serviceNo: "156", timing: "3 min", load: "Seats"),
                WidgetBus(serviceNo: "53", timing: "Arr", load: "Standing")
            ],
            message: "wishing you a seated ride",
            isPlaceholder: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (BusWidgetEntry) -> Void) {
        Task {
            completion(await entry())
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BusWidgetEntry>) -> Void) {
        Task {
            let currentEntry = await entry()
            let refreshDate = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
            completion(Timeline(entries: [currentEntry], policy: .after(refreshDate)))
        }
    }

    private func entry() async -> BusWidgetEntry {
        guard let stop = loadFavouriteStop() else {
            return BusWidgetEntry(
                date: Date(),
                stop: nil,
                buses: [],
                message: "save a stop to make this yours",
                isPlaceholder: false
            )
        }

        let buses = await loadArrivals(for: stop.busStopCode)
        return BusWidgetEntry(
            date: Date(),
            stop: stop,
            buses: buses,
            message: "wishing you a seated ride",
            isPlaceholder: false
        )
    }

    private func loadFavouriteStop() -> FavouriteStop? {
        guard let defaults = UserDefaults(suiteName: appGroupId),
              let data = defaults.data(forKey: "widgetFavouriteStop") else {
            return nil
        }

        return try? JSONDecoder().decode(FavouriteStop.self, from: data)
    }

    private func loadArrivals(for busStopCode: String) async -> [WidgetBus] {
        var components = URLComponents(url: arrivalEndpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "busStopCode", value: busStopCode)]

        guard let url = components?.url else {
            return []
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(LtaArrivalResponse.self, from: data)
            return response.services.prefix(4).map {
                WidgetBus(
                    serviceNo: $0.serviceNo,
                    timing: arrivalText(from: $0.nextBus.estimatedArrival),
                    load: loadText(from: $0.nextBus.load)
                )
            }
        } catch {
            return []
        }
    }

    private func arrivalText(from value: String?) -> String {
        guard let value, !value.isEmpty, let date = ISO8601DateFormatter().date(from: value) else {
            return "--"
        }

        let minutes = Int(date.timeIntervalSince(Date()) / 60)
        if minutes <= 0 {
            return "Arr"
        }

        return "\(minutes) min"
    }

    private func loadText(from value: String?) -> String {
        switch value {
        case "SEA":
            return "Seats"
        case "SDA":
            return "Standing"
        case "LSD":
            return "Crowded"
        default:
            return "Live"
        }
    }
}

struct BusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BusWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemMedium ? 10 : 8) {
            header

            if let stop = entry.stop {
                Text(stop.roadName.isEmpty ? stop.busStopCode : "\(stop.roadName) · \(stop.busStopCode)")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                    .lineLimit(1)

                busList
            } else {
                Spacer(minLength: 4)
                Text("Bookmark your usual stop in the app.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                    .lineLimit(3)
            }

            Spacer(minLength: 0)

            Text(entry.message)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                .lineLimit(1)
        }
        .padding(14)
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

    private var header: some View {
        HStack(spacing: 8) {
            Text(entry.stop?.displayName ?? "My Bus")
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .foregroundColor(Color(red: 0.08, green: 0.18, blue: 0.30))
                .lineLimit(1)

            Spacer(minLength: 0)

            Image(systemName: "bus.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                .padding(7)
                .background(Color.white.opacity(0.72))
                .clipShape(Circle())
        }
    }

    private var busList: some View {
        VStack(spacing: 6) {
            ForEach(entry.buses.prefix(family == .systemMedium ? 4 : 2)) { bus in
                HStack(spacing: 8) {
                    Text(bus.serviceNo)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 0.10, green: 0.47, blue: 0.79))
                        .frame(minWidth: 35, alignment: .leading)

                    Text(bus.load)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(loadColor(bus.load))
                        .lineLimit(1)

                    Spacer(minLength: 6)

                    Text(bus.timing)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundColor(Color(red: 0.08, green: 0.18, blue: 0.30))
                        .lineLimit(1)
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
                .background(Color.white.opacity(0.62))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            if entry.buses.isEmpty {
                Text("Live arrivals are taking a quiet pause.")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundColor(Color(red: 0.39, green: 0.49, blue: 0.57))
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var widgetURL: URL? {
        guard let code = entry.stop?.busStopCode else {
            return URL(string: "skibidi://home")
        }

        return URL(string: "skibidi://stop/\(code)")
    }

    private func loadColor(_ load: String) -> Color {
        switch load {
        case "Seats":
            return Color(red: 0.10, green: 0.47, blue: 0.79)
        case "Standing":
            return Color(red: 0.62, green: 0.45, blue: 0.08)
        case "Crowded":
            return Color(red: 0.66, green: 0.33, blue: 0.22)
        default:
            return Color(red: 0.39, green: 0.49, blue: 0.57)
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
    let kind = "BusArrivalWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BusWidgetProvider()) { entry in
            BusWidgetView(entry: entry)
        }
        .configurationDisplayName("My Bus Arrivals")
        .description("Live arrivals for your saved bus stop.")
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
