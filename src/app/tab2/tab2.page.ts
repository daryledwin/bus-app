import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { SelectedBusStopService } from '../services/selected-bus-stop.service';

interface NearbyBusStop extends BusStop {
  distanceMeters: number;
}

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss']
})
export class Tab2Page implements OnInit {
  nearbyStops: NearbyBusStop[] = [];
  isLoadingLocation = false;
  nearbyError = '';

  constructor(
    private readonly ltaBusStopsService: LtaBusStopsService,
    private readonly router: Router,
    private readonly selectedBusStopService: SelectedBusStopService
  ) {}

  ngOnInit(): void {
    this.loadNearbyStops();
  }

  async loadNearbyStops(): Promise<void> {
    this.isLoadingLocation = true;
    this.nearbyError = '';
    this.nearbyStops = [];

    try {
      const location = await this.currentLocation();
      const stops = await this.ltaBusStopsService.getBusStops().toPromise();

      this.nearbyStops = (Array.isArray(stops) ? stops : [])
        .filter((stop) => Number.isFinite(Number(stop.Latitude)) && Number.isFinite(Number(stop.Longitude)))
        .map((stop) => ({
          ...stop,
          distanceMeters: this.distanceMeters(
            location.latitude,
            location.longitude,
            Number(stop.Latitude),
            Number(stop.Longitude)
          )
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, 10);
    } catch (error) {
      this.nearbyError = this.nearbyErrorMessage(error);
    } finally {
      this.isLoadingLocation = false;
    }
  }

  viewBuses(stop: NearbyBusStop): void {
    this.selectedBusStopService.selectStop({
      BusStopCode: stop.BusStopCode,
      Description: stop.Description,
      RoadName: stop.RoadName,
      Latitude: stop.Latitude,
      Longitude: stop.Longitude
    });
    this.router.navigate(['/tabs/tab1']);
  }

  trackNearbyStop(index: number, stop: NearbyBusStop): string {
    return stop.BusStopCode;
  }

  distanceLabel(distanceMeters: number): string {
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)} m away`;
    }

    return `${(distanceMeters / 1000).toFixed(1)} km away`;
  }

  private currentLocation(): Promise<GeolocationCoordinates> {
    if (!navigator.geolocation) {
      return Promise.reject(new Error('geolocation-unavailable'));
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        reject,
        {
          enableHighAccuracy: true,
          maximumAge: 60000,
          timeout: 12000
        }
      );
    });
  }

  private distanceMeters(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number
  ): number {
    const earthRadiusMeters = 6371000;
    const latitudeDelta = this.degreesToRadians(toLatitude - fromLatitude);
    const longitudeDelta = this.degreesToRadians(toLongitude - fromLongitude);
    const fromLatitudeRadians = this.degreesToRadians(fromLatitude);
    const toLatitudeRadians = this.degreesToRadians(toLatitude);
    const haversine =
      Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2)
      + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians)
      * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);

    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private degreesToRadians(value: number): number {
    return value * Math.PI / 180;
  }

  private nearbyErrorMessage(error: unknown): string {
    if (this.isPermissionDenied(error)) {
      return 'Location is off. Search by stop name or code instead.';
    }

    return 'Nearby stops are taking a quiet pause. Try again in a moment.';
  }

  private isPermissionDenied(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && Number((error as GeolocationPositionError).code) === 1;
  }
}
