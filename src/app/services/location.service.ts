import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Geolocation, PermissionStatus, PositionOptions } from '@capacitor/geolocation';

export interface AppLocation {
  latitude: number;
  longitude: number;
}

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  async requestPermissionAndLocation(options: PositionOptions): Promise<AppLocation> {
    if (Capacitor.isNativePlatform()) {
      const permission = await Geolocation.requestPermissions({ permissions: ['location'] });

      if (!this.isGranted(permission)) {
        throw this.permissionDeniedError();
      }
    }

    return this.currentLocation(options);
  }

  async currentLocation(options: PositionOptions): Promise<AppLocation> {
    if (Capacitor.isNativePlatform()) {
      const position = await Geolocation.getCurrentPosition(options);
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
    }

    if (!navigator.geolocation) {
      throw new Error('geolocation-unavailable');
    }

    const coordinates = await new Promise<GeolocationCoordinates>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        reject,
        options
      );
    });

    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude
    };
  }

  private isGranted(permission: PermissionStatus): boolean {
    return permission.location === 'granted' || permission.coarseLocation === 'granted';
  }

  private permissionDeniedError(): Error & { code: number } {
    return Object.assign(new Error('location-permission-denied'), { code: 1 });
  }
}
