import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface WidgetFavouriteStop {
  busStopCode: string;
  name: string;
  roadName: string;
  nickname?: string;
  latitude?: number;
  longitude?: number;
}

interface StoredFavouriteStop {
  BusStopCode: string;
  Description: string;
  RoadName: string;
  nickname?: string;
  Latitude?: number;
  Longitude?: number;
}

interface WidgetBridgePlugin {
  syncWidgetData(payload: { payload: string }): Promise<void>;
}

interface WidgetDataPayload {
  favourites: WidgetFavouriteStop[];
  selectedBusStop?: WidgetFavouriteStop;
  nearestBusStop?: WidgetFavouriteStop;
  lastLocation?: {
    latitude: number;
    longitude: number;
    savedAt?: number;
  };
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

@Injectable({
  providedIn: 'root'
})
export class WidgetBridgeService {
  private readonly favouritesStorageKey = 'favouriteBusStops';
  private readonly lastLocationStorageKey = 'nearbyStopsLastLocation';
  private readonly selectedBusStopStorageKey = 'widgetSelectedBusStop';

  syncWidgetData(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const favourites = this.loadStoredFavouriteStops().map((stop) => this.toWidgetFavouriteStop(stop));
    const lastLocation = this.loadLastLocation();
    const payload: WidgetDataPayload = {
      favourites,
      selectedBusStop: this.loadSelectedBusStop(),
      nearestBusStop: this.nearestFavouriteStop(favourites, lastLocation),
      lastLocation
    };

    WidgetBridge.syncWidgetData({ payload: JSON.stringify(payload) })
      .then(() => {
        console.log('Widget data sync complete:', {
          favourites: payload.favourites.length,
          nearestBusStop: payload.nearestBusStop?.busStopCode
        });
      })
      .catch((error) => {
        console.warn('Widget data sync failed:', error);
      });
  }

  syncStoredFavouriteStop(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    this.syncWidgetData();
  }

  syncSelectedBusStop(stop: StoredFavouriteStop): void {
    const selectedStop = this.toWidgetFavouriteStop(stop);
    localStorage.setItem(this.selectedBusStopStorageKey, JSON.stringify(selectedStop));
    this.syncWidgetData();
  }

  private loadStoredFavouriteStops(): StoredFavouriteStop[] {
    const storedStops = localStorage.getItem(this.favouritesStorageKey);

    if (!storedStops) {
      return [];
    }

    try {
      const parsedStops = JSON.parse(storedStops) as StoredFavouriteStop[];

      if (!Array.isArray(parsedStops)) {
        return [];
      }

      return parsedStops.filter((stop) => stop?.BusStopCode && stop.Description);
    } catch {
      return [];
    }
  }

  private loadLastLocation(): WidgetDataPayload['lastLocation'] {
    const storedLocation = localStorage.getItem(this.lastLocationStorageKey);

    if (!storedLocation) {
      return undefined;
    }

    try {
      const parsedLocation = JSON.parse(storedLocation) as WidgetDataPayload['lastLocation'];

      if (!parsedLocation
        || !Number.isFinite(parsedLocation.latitude)
        || !Number.isFinite(parsedLocation.longitude)) {
        return undefined;
      }

      return parsedLocation;
    } catch {
      return undefined;
    }
  }

  private loadSelectedBusStop(): WidgetFavouriteStop | undefined {
    const storedStop = localStorage.getItem(this.selectedBusStopStorageKey);

    if (!storedStop) {
      return undefined;
    }

    try {
      const parsedStop = JSON.parse(storedStop) as WidgetFavouriteStop;

      if (!parsedStop?.busStopCode || !parsedStop.name) {
        return undefined;
      }

      return parsedStop;
    } catch {
      return undefined;
    }
  }

  private nearestFavouriteStop(
    favourites: WidgetFavouriteStop[],
    location: WidgetDataPayload['lastLocation']
  ): WidgetFavouriteStop | undefined {
    if (!location || !favourites.length) {
      return undefined;
    }

    return favourites
      .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
      .map((stop) => ({
        stop,
        distanceMeters: this.distanceMeters(
          location.latitude,
          location.longitude,
          stop.latitude as number,
          stop.longitude as number
        )
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0]?.stop;
  }

  private toWidgetFavouriteStop(stop: StoredFavouriteStop): WidgetFavouriteStop {
    return {
      busStopCode: stop.BusStopCode,
      name: stop.Description,
      roadName: stop.RoadName,
      nickname: stop.nickname,
      latitude: Number.isFinite(Number(stop.Latitude)) ? Number(stop.Latitude) : undefined,
      longitude: Number.isFinite(Number(stop.Longitude)) ? Number(stop.Longitude) : undefined
    };
  }

  private distanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number): number {
    const earthRadius = 6371000;
    const latitudeDelta = this.degreesToRadians(toLatitude - fromLatitude);
    const longitudeDelta = this.degreesToRadians(toLongitude - fromLongitude);
    const fromLatitudeRadians = this.degreesToRadians(fromLatitude);
    const toLatitudeRadians = this.degreesToRadians(toLatitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians)
      * Math.sin(longitudeDelta / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadius * c;
  }

  private degreesToRadians(degrees: number): number {
    return degrees * Math.PI / 180;
  }
}
