import { Component, HostListener, OnInit, Optional } from '@angular/core';
import { IonRouterOutlet, NavController } from '@ionic/angular';
import { LtaBusRoutesService } from '../services/lta-bus-routes.service';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { LocationService } from '../services/location.service';
import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { WidgetBridgeService } from '../services/widget-bridge.service';
import { formatBusStopName as formatBusStopDisplayName } from '../utils/bus-stop-display';
import { rankBusStopSearchResults } from '../utils/bus-stop-search';
import { normalizeBusServiceNumber, uniqueSortedBusServiceNumbers } from '../utils/bus-service-number';

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
  isAddBusSheetOpen = false;
  addBusStep: 'stop' | 'service' = 'stop';
  busStopQuery = '';
  matchingBusStops: BusStop[] = [];
  selectedBusStop?: BusStop;
  availableServices: string[] = [];
  isLoadingPickerStops = false;
  pickerStopsError = '';
  isLoadingStopServices = false;
  stopServicesError = '';
  hasNoStopServices = false;

  private readonly pinnedBusServicesStorageKey = 'pinnedBusServicesByStop';
  private readonly pinnedBusServicesUpdatedAtStorageKey = 'pinnedBusServicesUpdatedAtByStop';
  private readonly pinnedBusSortStorageKey = 'pinnedBusesSortMode';
  private readonly lastLocationStorageKey = 'nearbyStopsLastLocation';
  private busStops: BusStop[] = [];
  private busStopsByCode = new Map<string, BusStop>();
  private busStopsLoadFailed = false;
  private currentLocation?: { latitude: number; longitude: number };
  private reorderTimer?: ReturnType<typeof setTimeout>;
  private serviceRequestId = 0;

  constructor(
    private readonly ltaBusStopsService: LtaBusStopsService,
    private readonly ltaBusRoutesService: LtaBusRoutesService,
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

  trackBusStop(index: number, stop: BusStop): string {
    return stop.BusStopCode;
  }

  formatBusStopName(stop: BusStop): string {
    return formatBusStopDisplayName(stop);
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

  async openAddBusSheet(): Promise<void> {
    this.closeSortPopover();
    this.resetAddBusFlow();
    this.isAddBusSheetOpen = true;
    await this.refreshFeedbackService.lightImpact();

    if (!this.busStops.length) {
      await this.loadPickerBusStops();
    }
  }

  closeAddBusSheet(): void {
    this.isAddBusSheetOpen = false;
  }

  addBusSheetDismissed(): void {
    this.isAddBusSheetOpen = false;
    this.resetAddBusFlow();
  }

  busStopSearchChanged(query: string): void {
    this.busStopQuery = query;
    this.updateMatchingBusStops();
  }

  clearBusStopSearch(): void {
    this.busStopQuery = '';
    this.matchingBusStops = [];
  }

  async retryBusStopLoading(): Promise<void> {
    await this.loadPickerBusStops(true);
  }

  async selectBusStop(stop: BusStop): Promise<void> {
    this.selectedBusStop = stop;
    this.addBusStep = 'service';
    this.availableServices = [];
    this.stopServicesError = '';
    this.hasNoStopServices = false;
    await this.refreshFeedbackService.lightImpact();
    await this.loadServicesForSelectedStop();
  }

  changeSelectedStop(): void {
    this.serviceRequestId++;
    this.selectedBusStop = undefined;
    this.availableServices = [];
    this.stopServicesError = '';
    this.hasNoStopServices = false;
    this.isLoadingStopServices = false;
    this.addBusStep = 'stop';
    this.updateMatchingBusStops();
    void this.refreshFeedbackService.lightImpact();
  }

  async retryStopServices(): Promise<void> {
    await this.loadServicesForSelectedStop();
  }

  async pinSelectedService(serviceNo: string): Promise<void> {
    const stop = this.selectedBusStop;

    if (!stop) {
      return;
    }

    const normalizedServiceNo = normalizeBusServiceNumber(serviceNo);
    const pinnedServices = this.loadPinnedServices();
    const currentServices = pinnedServices[stop.BusStopCode] || [];
    const stopName = stop.Description?.trim() || this.formatBusStopName(stop);

    if (currentServices.includes(normalizedServiceNo)) {
      this.closeAddBusSheet();
      await this.refreshFeedbackService.info(
        `Bus ${normalizedServiceNo} is already pinned at ${stopName}`
      );
      return;
    }

    pinnedServices[stop.BusStopCode] = [normalizedServiceNo, ...currentServices];
    this.savePinnedServices(pinnedServices);
    this.markPinnedBusStopUpdated(stop.BusStopCode, Date.now());
    this.applySortedGroups(this.groupsFromPins(pinnedServices));
    this.widgetBridgeService.syncWidgetData();
    this.closeAddBusSheet();
    await this.refreshFeedbackService.info(`Bus ${normalizedServiceNo} pinned at ${stopName}`);
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
      this.busStops = busStops;
      this.busStopsLoadFailed = false;
      this.busStopsByCode = new Map(
        busStops
          .filter((stop) => stop?.BusStopCode)
          .map((stop) => [stop.BusStopCode, stop])
      );
    } catch {
      this.busStops = [];
      this.busStopsLoadFailed = true;
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

  private resetAddBusFlow(): void {
    this.serviceRequestId++;
    this.addBusStep = 'stop';
    this.busStopQuery = '';
    this.matchingBusStops = [];
    this.selectedBusStop = undefined;
    this.availableServices = [];
    this.pickerStopsError = '';
    this.stopServicesError = '';
    this.hasNoStopServices = false;
    this.isLoadingPickerStops = false;
    this.isLoadingStopServices = false;
  }

  private async loadPickerBusStops(forceRefresh = false): Promise<void> {
    this.isLoadingPickerStops = true;
    this.pickerStopsError = '';

    try {
      const stops = await this.ltaBusStopsService
        .getBusStops(forceRefresh || this.busStopsLoadFailed)
        .toPromise() || [];

      this.busStops = stops;
      this.busStopsLoadFailed = false;
      this.busStopsByCode = new Map(
        stops
          .filter((stop) => stop?.BusStopCode)
          .map((stop) => [stop.BusStopCode, stop])
      );
      this.updateMatchingBusStops();
    } catch {
      this.busStopsLoadFailed = true;
      this.pickerStopsError = 'Bus stops couldn’t be loaded. Check your connection and try again.';
    } finally {
      this.isLoadingPickerStops = false;
    }
  }

  private updateMatchingBusStops(): void {
    const query = this.busStopQuery.trim();
    this.matchingBusStops = query
      ? rankBusStopSearchResults(this.busStops, query, 30)
      : [];
  }

  private async loadServicesForSelectedStop(): Promise<void> {
    const stop = this.selectedBusStop;

    if (!stop) {
      return;
    }

    const requestId = ++this.serviceRequestId;
    this.isLoadingStopServices = true;
    this.stopServicesError = '';
    this.hasNoStopServices = false;
    this.availableServices = [];

    try {
      const routes = await this.ltaBusRoutesService.getBusRoutesForStop(stop.BusStopCode).toPromise() || [];

      if (requestId !== this.serviceRequestId || this.selectedBusStop?.BusStopCode !== stop.BusStopCode) {
        return;
      }

      this.availableServices = uniqueSortedBusServiceNumbers(routes);
      this.hasNoStopServices = !this.availableServices.length;
    } catch {
      if (requestId === this.serviceRequestId) {
        this.hasNoStopServices = false;
        this.stopServicesError = 'Bus services couldn’t be loaded. Check your connection and try again.';
      }
    } finally {
      if (requestId === this.serviceRequestId) {
        this.isLoadingStopServices = false;
      }
    }
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
