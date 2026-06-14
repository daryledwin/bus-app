import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { LocationService } from './location.service';

export type LocationChoice = 'granted' | 'deferred' | 'denied';

@Injectable({
  providedIn: 'root'
})
export class OnboardingService implements CanActivate {
  private readonly completionStorageKey = 'myBusOnboardingComplete';
  private readonly locationChoiceStorageKey = 'myBusLocationChoice';
  private readonly lastLocationStorageKey = 'nearbyStopsLastLocation';

  constructor(
    private readonly locationService: LocationService,
    private readonly router: Router
  ) {}

  canActivate(): boolean | UrlTree {
    return this.isComplete() ? true : this.router.parseUrl('/onboarding');
  }

  isComplete(): boolean {
    return localStorage.getItem(this.completionStorageKey) === 'true';
  }

  complete(locationChoice: LocationChoice): void {
    localStorage.setItem(this.locationChoiceStorageKey, locationChoice);
    localStorage.setItem(this.completionStorageKey, 'true');
  }

  locationChoice(): LocationChoice | undefined {
    const choice = localStorage.getItem(this.locationChoiceStorageKey);
    return choice === 'granted' || choice === 'deferred' || choice === 'denied' ? choice : undefined;
  }

  shouldRequestLocationAutomatically(): boolean {
    return this.locationChoice() === 'granted';
  }

  async requestLocation(): Promise<LocationChoice> {
    try {
      const location = await this.locationService.requestPermissionAndLocation({
        enableHighAccuracy: false,
        maximumAge: 1000 * 60 * 15,
        timeout: 8000
      });

      localStorage.setItem(this.lastLocationStorageKey, JSON.stringify({
        ...location,
        savedAt: Date.now()
      }));
      localStorage.setItem(this.locationChoiceStorageKey, 'granted');
      return 'granted';
    } catch (error) {
      const choice = this.isPermissionDenied(error) ? 'denied' : 'deferred';
      localStorage.setItem(this.locationChoiceStorageKey, choice);
      return choice;
    }
  }

  private isPermissionDenied(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && Number((error as GeolocationPositionError).code) === 1;
  }
}
