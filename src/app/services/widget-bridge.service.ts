import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface WidgetFavouriteStop {
  busStopCode: string;
  name: string;
  roadName: string;
  nickname?: string;
}

interface StoredFavouriteStop {
  BusStopCode: string;
  Description: string;
  RoadName: string;
  nickname?: string;
}

interface WidgetBridgePlugin {
  syncFavouriteStop(stop: WidgetFavouriteStop | Record<string, never>): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

@Injectable({
  providedIn: 'root'
})
export class WidgetBridgeService {
  private readonly favouritesStorageKey = 'favouriteBusStops';

  syncFavouriteStop(stop?: WidgetFavouriteStop): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const isPluginAvailable = Capacitor.isPluginAvailable('WidgetBridge');
    console.log('Widget favourite sync starting:', {
      isPluginAvailable,
      stop: stop?.busStopCode ?? 'none'
    });

    WidgetBridge.syncFavouriteStop(stop ?? {})
      .then(() => {
        console.log('Widget favourite sync complete:', stop?.busStopCode ?? 'none');
      })
      .catch((error) => {
        console.warn('Widget favourite sync failed:', error);
      });
  }

  syncStoredFavouriteStop(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const firstFavourite = this.loadFirstStoredFavouriteStop();

    if (!firstFavourite) {
      this.syncFavouriteStop();
      return;
    }

    this.syncFavouriteStop({
      busStopCode: firstFavourite.BusStopCode,
      name: firstFavourite.Description,
      roadName: firstFavourite.RoadName,
      nickname: firstFavourite.nickname
    });
  }

  private loadFirstStoredFavouriteStop(): StoredFavouriteStop | undefined {
    const storedStops = localStorage.getItem(this.favouritesStorageKey);

    if (!storedStops) {
      return undefined;
    }

    try {
      const parsedStops = JSON.parse(storedStops) as StoredFavouriteStop[];

      if (!Array.isArray(parsedStops)) {
        return undefined;
      }

      return parsedStops.find((stop) => stop?.BusStopCode && stop.Description);
    } catch {
      return undefined;
    }
  }
}
