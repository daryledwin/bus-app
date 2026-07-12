import { Component, HostListener, OnInit, Optional } from '@angular/core';
import { IonRouterOutlet, NavController } from '@ionic/angular';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { LocationService } from '../services/location.service';
import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { WidgetBridgeService } from '../services/widget-bridge.service';
import { formatBusStopName as formatBusStopDisplayName } from '../utils/bus-stop-display';

type PinnedBusServicesByStop = Record<string, string[]>;
type PinnedBusSortMode = 'recent' | 'distance' | 'name';

interface PinnedBusServicesUpdatedAtByStop {
  [busStopCode: string]: number;
}

interface PinnedBusStopGroup {
  busStopCode: string;
  name: string;
  roadName: string;
  services: string[];
  latitude?: number;
  longitude?: number;
  updatedAt: number;
}

@Component({
  selector: 'app-pinned-buses',
  templateUrl: './pinned-buses.page.html',
  styleUrls: ['./pinned-buses.page.scss']
})
export class PinnedBusesPage implements OnInit {
  pinnedGroups: PinnedBusStopGroup[] = [];
  isLoading = true;
  isReordering = false;
  isSortPopoverOpen = false;
  sortMode: PinnedBusSortMode = 'recent';

  private readonly pinnedBusServicesStorageKey = 'pinnedBusServicesByStop';
  private readonly pinnedBusServicesUpdatedAtStorageKey = 'pinnedBusServicesUpdatedAtByStop';
  private readonly pinnedBusSortStorageKey = 'pinnedBusesSortMode';
  private readonly lastLocationStorageKey = 'nearbyStopsLastLocation';
  private busStopsByCode = new Map<string, BusStop>();
  private currentLocation?: { latitude: number; longitude: number };
  private reorderTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly ltaBusStopsService: LtaBusStopsService,
    private readonly locationService: LocationService,
    private readonly navController: NavController,
    private readonly refreshFeedbackService: RefreshFeedbackService,
    private readonly widgetBridgeService: WidgetBridgeService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  async ngOnInit(): Promise<void> {
    this.sortMode = this.loadSortMode();
    this.currentLocation = this.loadLastLocation();
    await this.loadPinnedBuses();
  }

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = true;
    }
  }

  goBack(): void {
    this.navController.back();
  }

  trackPinnedGroup(index: number, group: PinnedBusStopGroup): string {
    return group.busStopCode;
  }

  trackService(index: number, serviceNo: string): string {
    return serviceNo;
  }

  @HostListener('document:click')
  closeSortPopoverFromOutside(): void {
    this.closeSortPopover();
  }

  openSortPopover(event: Event): void {
    event.stopPropagation();
    this.isSortPopoverOpen = !this.isSortPopoverOpen;
    void this.refreshFeedbackService.lightImpact();
  }

  closeSortPopover(event?: Event): void {
    event?.stopPropagation();
    this.isSortPopoverOpen = false;
  }

  async unpinService(group: PinnedBusStopGroup, serviceNo: string): Promise<void> {
    const pinnedServices = this.loadPinnedServices();
    const currentServices = pinnedServices[group.busStopCode] || [];
    const updatedServices = currentServices.filter((currentServiceNo) => currentServiceNo !== serviceNo);

    if (updatedServices.length) {
      pinnedServices[group.busStopCode] = updatedServices;
    } else {
      delete pinnedServices[group.busStopCode];
    }

    this.savePinnedServices(pinnedServices);
    this.markPinnedBusStopUpdated(group.busStopCode, pinnedServices[group.busStopCode]?.length ? Date.now() : undefined);
    this.applySortedGroups(this.groupsFromPins(pinnedServices));
    this.widgetBridgeService.syncWidgetData();
    await this.refreshFeedbackService.info(`Bus ${serviceNo} unpinned`);
  }

  async selectSortMode(mode: PinnedBusSortMode, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.sortMode = mode;
    this.saveSortMode();
    await this.refreshFeedbackService.lightImpact();

    if (mode === 'distance') {
      await this.refreshCurrentLocationForDistanceSort();
    }

    this.applySortedGroups(this.groupsFromPins(this.loadPinnedServices()));
    this.closeSortPopover();
  }

  private async loadPinnedBuses(): Promise<void> {
    this.isLoading = true;

    try {
      const busStops = await this.ltaBusStopsService.getBusStops().toPromise() || [];
      this.busStopsByCode = new Map(
        busStops
          .filter((stop) => stop?.BusStopCode)
          .map((stop) => [stop.BusStopCode, stop])
      );
    } catch {
      this.busStopsByCode = new Map();
    } finally {
      this.applySortedGroups(this.groupsFromPins(this.loadPinnedServices()), false);
      this.isLoading = false;
      if (this.sortMode === 'distance') {
        void this.refreshCurrentLocationForDistanceSort().then(() => {
          this.applySortedGroups(this.groupsFromPins(this.loadPinnedServices()));
        });
      }
    }
  }

  private groupsFromPins(pinnedServices: PinnedBusServicesByStop): PinnedBusStopGroup[] {
    const updatedAtByStop = this.loadPinnedServicesUpdatedAt();

    return Object.entries(pinnedServices)
      .map(([busStopCode, services]) => {
        const stop = this.busStopsByCode.get(busStopCode);

        return {
          busStopCode,
          name: stop ? formatBusStopDisplayName(stop) : `Bus stop ${busStopCode}`,
          roadName: stop?.RoadName || 'Pinned stop',
          services,
          latitude: Number.isFinite(Number(stop?.Latitude)) ? Number(stop?.Latitude) : undefined,
          longitude: Number.isFinite(Number(stop?.Longitude)) ? Number(stop?.Longitude) : undefined,
          updatedAt: updatedAtByStop[busStopCode] || 0
        };
      })
      .sort((a, b) => this.comparePinnedGroups(a, b));
  }

  private loadPinnedServices(): PinnedBusServicesByStop {
    const storedPins = localStorage.getItem(this.pinnedBusServicesStorageKey);

    if (!storedPins) {
      return {};
    }

    try {
      const parsedPins = JSON.parse(storedPins) as PinnedBusServicesByStop;

      if (!parsedPins || typeof parsedPins !== 'object' || Array.isArray(parsedPins)) {
        return {};
      }

      return Object.entries(parsedPins).reduce<PinnedBusServicesByStop>((pins, [busStopCode, serviceNos]) => {
        if (!busStopCode || !Array.isArray(serviceNos)) {
          return pins;
        }

        const normalizedServices = serviceNos
          .filter((serviceNo): serviceNo is string => typeof serviceNo === 'string')
          .map((serviceNo) => serviceNo.trim().toUpperCase())
          .filter(Boolean);

        if (normalizedServices.length) {
          pins[busStopCode] = Array.from(new Set(normalizedServices));
        }

        return pins;
      }, {});
    } catch {
      return {};
    }
  }

  private savePinnedServices(pinnedServices: PinnedBusServicesByStop): void {
    if (Object.keys(pinnedServices).length) {
      localStorage.setItem(this.pinnedBusServicesStorageKey, JSON.stringify(pinnedServices));
    } else {
      localStorage.removeItem(this.pinnedBusServicesStorageKey);
    }
  }

  private applySortedGroups(groups: PinnedBusStopGroup[], animate = true): void {
    if (animate) {
      this.isReordering = true;

      if (this.reorderTimer) {
        clearTimeout(this.reorderTimer);
      }
    }

    this.pinnedGroups = [...groups].sort((a, b) => this.comparePinnedGroups(a, b));

    if (animate) {
      this.reorderTimer = setTimeout(() => {
        this.isReordering = false;
      }, 260);
    }
  }

  private comparePinnedGroups(a: PinnedBusStopGroup, b: PinnedBusStopGroup): number {
    if (this.sortMode === 'distance') {
      const distanceSort = this.compareByDistance(a, b);

      if (distanceSort !== 0) {
        return distanceSort;
      }
    }

    if (this.sortMode === 'name' || this.sortMode === 'distance') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }

    return b.updatedAt - a.updatedAt
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  private compareByDistance(a: PinnedBusStopGroup, b: PinnedBusStopGroup): number {
    if (!this.currentLocation) {
      return 0;
    }

    return this.distanceToGroup(a) - this.distanceToGroup(b);
  }

  private distanceToGroup(group: PinnedBusStopGroup): number {
    if (!this.currentLocation
      || !Number.isFinite(group.latitude)
      || !Number.isFinite(group.longitude)) {
      return Number.MAX_SAFE_INTEGER;
    }

    return this.distanceMeters(
      this.currentLocation.latitude,
      this.currentLocation.longitude,
      group.latitude as number,
      group.longitude as number
    );
  }

  private async refreshCurrentLocationForDistanceSort(): Promise<void> {
    try {
      const location = await this.locationService.currentLocation({
        enableHighAccuracy: false,
        maximumAge: 1000 * 60 * 5,
        timeout: 8000
      });

      this.currentLocation = location;
    } catch {
      this.currentLocation = this.loadLastLocation();
    }
  }

  private loadLastLocation(): { latitude: number; longitude: number } | undefined {
    const storedLocation = localStorage.getItem(this.lastLocationStorageKey);

    if (!storedLocation) {
      return undefined;
    }

    try {
      const parsedLocation = JSON.parse(storedLocation) as { latitude?: number; longitude?: number };

      if (!Number.isFinite(parsedLocation.latitude) || !Number.isFinite(parsedLocation.longitude)) {
        return undefined;
      }

      return {
        latitude: parsedLocation.latitude as number,
        longitude: parsedLocation.longitude as number
      };
    } catch {
      return undefined;
    }
  }

  private loadSortMode(): PinnedBusSortMode {
    const storedSortMode = localStorage.getItem(this.pinnedBusSortStorageKey);
    return storedSortMode === 'distance' || storedSortMode === 'name' || storedSortMode === 'recent'
      ? storedSortMode
      : 'recent';
  }

  private saveSortMode(): void {
    localStorage.setItem(this.pinnedBusSortStorageKey, this.sortMode);
  }

  private loadPinnedServicesUpdatedAt(): PinnedBusServicesUpdatedAtByStop {
    const storedUpdatedAt = localStorage.getItem(this.pinnedBusServicesUpdatedAtStorageKey);

    if (!storedUpdatedAt) {
      return {};
    }

    try {
      const parsedUpdatedAt = JSON.parse(storedUpdatedAt) as PinnedBusServicesUpdatedAtByStop;

      if (!parsedUpdatedAt || typeof parsedUpdatedAt !== 'object' || Array.isArray(parsedUpdatedAt)) {
        return {};
      }

      return parsedUpdatedAt;
    } catch {
      return {};
    }
  }

  private markPinnedBusStopUpdated(busStopCode: string, updatedAt?: number): void {
    const updatedAtByStop = this.loadPinnedServicesUpdatedAt();

    if (updatedAt) {
      updatedAtByStop[busStopCode] = updatedAt;
    } else {
      delete updatedAtByStop[busStopCode];
    }

    localStorage.setItem(this.pinnedBusServicesUpdatedAtStorageKey, JSON.stringify(updatedAtByStop));
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
}
