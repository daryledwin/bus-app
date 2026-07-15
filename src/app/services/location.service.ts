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
  private readonly fallbackTimeoutPaddingMs = 1500;
  private activeNativeLocationRequest?: Promise<AppLocation>;

  async requestPermissionAndLocation(options: PositionOptions): Promise<AppLocation> {
    if (Capacitor.isNativePlatform()) {
      const permission = await Geolocation.requestPermissions({ permissions: ['location'] });

      if (!this.isGranted(permission)) {
        throw this.permissionDeniedError();
      }
    }

    return this.currentLocation(options);
  }

  currentLocation(options: PositionOptions): Promise<AppLocation> {
    if (Capacitor.isNativePlatform()) {
      return this.serializedNativeLocation(options);
    }

    if (!navigator.geolocation) {
      return Promise.reject(new Error('geolocation-unavailable'));
    }

    return this.withTimeout(
      new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position.coords),
          reject,
          options
        );
      }),
      this.timeoutMs(options),
      'browser-geolocation-timeout'
    ).then((coordinates) => ({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude
    }));
  }

  hasActiveNativeLocationRequest(): boolean {
    return this.activeNativeLocationRequest !== undefined;
  }

  private serializedNativeLocation(options: PositionOptions): Promise<AppLocation> {
    if (this.activeNativeLocationRequest) {
      return this.activeNativeLocationRequest;
    }

    let activeRequest: Promise<AppLocation>;
    activeRequest = this.withTimeout(
      Geolocation.getCurrentPosition(options),
      this.timeoutMs(options),
      'native-geolocation-timeout'
    )
      .then((position) => ({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }))
      .finally(() => {
        if (this.activeNativeLocationRequest === activeRequest) {
          this.activeNativeLocationRequest = undefined;
        }
      });

    this.activeNativeLocationRequest = activeRequest;
    return activeRequest;
  }

  private isGranted(permission: PermissionStatus): boolean {
    return permission.location === 'granted' || permission.coarseLocation === 'granted';
  }

  private permissionDeniedError(): Error & { code: number } {
    return Object.assign(new Error('location-permission-denied'), { code: 1 });
  }

  private timeoutMs(options: PositionOptions): number {
    const requestedTimeout = typeof options.timeout === 'number' && Number.isFinite(options.timeout)
      ? options.timeout
      : 8000;

    return Math.max(3000, requestedTimeout + this.fallbackTimeoutPaddingMs);
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        console.warn(`[LocationService] ${message} after ${timeoutMs}ms`);
        reject(Object.assign(new Error(message), { code: 3 }));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise])
      .finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
  }
}
