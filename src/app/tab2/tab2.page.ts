import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, Optional, ViewChild } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { IonContent, IonRouterOutlet } from '@ionic/angular';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { SelectedBusStopService } from '../services/selected-bus-stop.service';
import { SameTabScrollService } from '../services/same-tab-scroll.service';
import { OnboardingService } from '../services/onboarding.service';
import { LocationService } from '../services/location.service';
import { ReviewService } from '../services/review.service';
import { WidgetBridgeService } from '../services/widget-bridge.service';
import { formatBusStopName as formatBusStopDisplayName } from '../utils/bus-stop-display';

interface NearbyBusStop extends BusStop {
  distanceMeters: number;
}

interface NearbyLocation {
  latitude: number;
  longitude: number;
}

interface StoredNearbyLocation extends NearbyLocation {
  savedAt: number;
}

interface FavouriteBusStop {
  BusStopCode: string;
  Description: string;
  RoadName: string;
  nickname?: string;
  Latitude?: number;
  Longitude?: number;
}

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

interface NearbyLoadOptions {
  forceFreshLocation?: boolean;
  preserveVisibleStopsOnFreshLocationError?: boolean;
}

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss']
})
export class Tab2Page implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild('nearbyMap') private readonly nearbyMapElement?: ElementRef<HTMLElement>;

  nearbyStops: NearbyBusStop[] = [];
  selectedNearbyStop?: NearbyBusStop;
  favouriteBusStops: FavouriteBusStop[] = [];
  recentlyToggledFavouriteCode = '';
  recentFavouriteAction: 'saved' | 'removed' | '' = '';
  isLoadingLocation = false;
  isProgrammaticScroll = false;
  hasUserLocation = false;
  isUsingFallbackLocation = false;
  locationAccessDeferred = false;
  nearbyError = '';
  private readonly singaporeCenter = { latitude: 1.3521, longitude: 103.8198 };
  private readonly lastLocationStorageKey = 'nearbyStopsLastLocation';
  private readonly favouritesStorageKey = 'favouriteBusStops';
  private readonly lastLocationMaxAgeMs = 1000 * 60 * 60 * 12;
  private mapCenter = this.singaporeCenter;
  private map?: L.Map;
  private userMarker?: L.Marker;
  private stopMarkers = new Map<string, L.Marker>();
  private selectedStopPopup?: L.Popup;
  private favouritePopTimer?: ReturnType<typeof setTimeout>;
  private nearbyLoadRequestId = 0;
  private didUseVisibleStopsRefreshFallback = false;
  private lastNavTapAt = 0;
  private lastNavRoute = '';

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home-outline', route: '/tabs/tab1' },
    { label: 'Nearby', icon: 'navigate-outline', route: '/tabs/tab2' },
    { label: 'Settings', icon: 'settings-outline', route: '/tabs/settings' }
  ];

  constructor(
    private readonly ltaBusStopsService: LtaBusStopsService,
    private readonly locationService: LocationService,
    private readonly ngZone: NgZone,
    private readonly onboardingService: OnboardingService,
    private readonly refreshFeedbackService: RefreshFeedbackService,
    private readonly reviewService: ReviewService,
    private readonly router: Router,
    private readonly sameTabScrollService: SameTabScrollService,
    private readonly selectedBusStopService: SelectedBusStopService,
    private readonly widgetBridgeService: WidgetBridgeService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {
    this.favouriteBusStops = this.loadFavouriteBusStops();
  }

  ngOnInit(): void {
    this.loadNearbyStops();
  }

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = false;
    }

    this.favouriteBusStops = this.loadFavouriteBusStops();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initializeMap();
      if (this.nearbyStops.length) {
        this.updateMap(this.mapCenter.latitude, this.mapCenter.longitude);
      }
      this.map?.invalidateSize();
    }, 120);
  }

  ngOnDestroy(): void {
    this.nearbyLoadRequestId++;
    this.map?.remove();
    this.stopMarkers.clear();
    if (this.favouritePopTimer) {
      clearTimeout(this.favouritePopTimer);
    }
  }

  async loadNearbyStops(options: NearbyLoadOptions = {}): Promise<void> {
    const requestId = ++this.nearbyLoadRequestId;
    const startedAt = performance.now();
    const forceFreshLocation = options.forceFreshLocation === true;
    const preserveVisibleStopsOnFreshLocationError = options.preserveVisibleStopsOnFreshLocationError === true;
    console.info(`[Nearby] load start request=${requestId} forceFresh=${forceFreshLocation}`);
    this.isLoadingLocation = true;
    this.nearbyError = '';
    const visibleStopsBeforeLoad = [...this.nearbyStops];
    const selectedStopBeforeLoad = this.selectedNearbyStop;
    const mapCenterBeforeLoad = this.mapCenter;
    let didResolveFreshLocation = false;
    if (forceFreshLocation) {
      this.locationAccessDeferred = false;
      this.hasUserLocation = false;
      this.isUsingFallbackLocation = false;
    }
    const shouldPreserveCurrentStops = this.nearbyStops.length > 0;

    if (!shouldPreserveCurrentStops || forceFreshLocation) {
      this.nearbyStops = [];
    }

    this.selectedNearbyStop = undefined;

    try {
      const location = await this.locationOrFallback({ forceFreshLocation });
      if (!this.isActiveNearbyRequest(requestId)) {
        console.info(`[Nearby] stale location result ignored request=${requestId}`);
        return;
      }

      this.mapCenter = location;
      didResolveFreshLocation = true;
      console.info(`[Nearby] bus stops API start request=${requestId}`);
      const stops = await this.withTimeout(
        this.ltaBusStopsService.getBusStops().toPromise(),
        10000,
        'nearby-bus-stops-timeout'
      ) || [];
      if (!this.isActiveNearbyRequest(requestId)) {
        console.info(`[Nearby] stale bus stops result ignored request=${requestId}`);
        return;
      }

      console.info(`[Nearby] bus stops API success request=${requestId} count=${stops.length}`);

      this.renderNearbyStops(stops, location);
      this.refreshLocationInBackground(stops, location);
      console.info(`[Nearby] load success request=${requestId} ms=${Math.round(performance.now() - startedAt)}`);
    } catch (error) {
      if (!this.isActiveNearbyRequest(requestId)) {
        console.info(`[Nearby] stale error ignored request=${requestId}`, error);
        return;
      }

      console.warn(`[Nearby] load failed request=${requestId}`, error);
      if (
        forceFreshLocation
        && preserveVisibleStopsOnFreshLocationError
        && !didResolveFreshLocation
        && visibleStopsBeforeLoad.length > 0
      ) {
        this.nearbyStops = visibleStopsBeforeLoad;
        this.selectedNearbyStop = selectedStopBeforeLoad;
        this.mapCenter = mapCenterBeforeLoad;
        this.hasUserLocation = true;
        this.isUsingFallbackLocation = true;
        this.nearbyError = '';
        this.didUseVisibleStopsRefreshFallback = true;
        await this.refreshFeedbackService.info('Couldn’t refresh location, showing last known nearby stops.');
        return;
      }

      if (!this.hasUserLocation || forceFreshLocation) {
        this.nearbyStops = [];
        this.selectedNearbyStop = undefined;
      }
      this.nearbyError = this.nearbyErrorMessage(error);
    } finally {
      if (this.isActiveNearbyRequest(requestId)) {
        this.isLoadingLocation = false;
        setTimeout(() => this.map?.invalidateSize(), 80);
        console.info(`[Nearby] load settled request=${requestId} loading=${this.isLoadingLocation}`);
      }
    }
  }

  async refreshNearbyStops(event: Event): Promise<void> {
    const refresher = event.target as HTMLIonRefresherElement;
    let shouldShowFeedback = false;
    this.didUseVisibleStopsRefreshFallback = false;
    console.info('[Nearby] pull-to-refresh start');

    try {
      await this.loadNearbyStops({
        forceFreshLocation: true,
        preserveVisibleStopsOnFreshLocationError: true
      });
      shouldShowFeedback = this.nearbyStops.length > 0 && !this.didUseVisibleStopsRefreshFallback;
    } catch (error) {
      console.warn('[Nearby] pull-to-refresh failed', error);
    } finally {
      try {
        await refresher.complete();
      } finally {
        console.info('[Nearby] pull-to-refresh complete');
      }
    }

    if (shouldShowFeedback) {
      await this.refreshFeedbackService.success('Nearby stops refreshed');
    }
  }

  retryNearbyStops(): Promise<void> {
    return this.loadNearbyStops({ forceFreshLocation: true });
  }

  async enableLocation(): Promise<void> {
    if (this.isLoadingLocation) {
      console.info('[Nearby] enableLocation ignored while loading');
      return;
    }

    this.isLoadingLocation = true;
    console.info('[Nearby] enableLocation permission request start');

    try {
      const locationChoice = await this.onboardingService.requestLocation();
      console.info(`[Nearby] enableLocation permission result=${locationChoice}`);
      this.locationAccessDeferred = locationChoice !== 'granted';

      if (locationChoice === 'granted') {
        this.isLoadingLocation = false;
        await this.loadNearbyStops();
        return;
      }

      this.nearbyStops = [];
      this.nearbyError = locationChoice === 'denied'
        ? 'Location is off. Search and favourites still work, and you can enable location in Settings later.'
        : 'We could not get your location just yet. You can try again anytime.';
    } catch (error) {
      console.warn('[Nearby] enableLocation failed', error);
      this.nearbyError = this.nearbyErrorMessage(error);
    } finally {
      this.isLoadingLocation = false;
    }
  }

  openLocationSettings(): void {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
      window.location.href = 'app-settings:';
      return;
    }

    this.enableLocation();
  }

  viewBuses(stop: NearbyBusStop): void {
    const selectedStop = {
      BusStopCode: stop.BusStopCode,
      Description: stop.Description,
      RoadName: stop.RoadName,
      Latitude: stop.Latitude,
      Longitude: stop.Longitude
    };

    this.widgetBridgeService.syncSelectedBusStop(selectedStop);
    this.selectedBusStopService.selectStop(selectedStop);
    this.router.navigate(['/tabs/tab1']);
  }

  isNavRouteActive(route: string): boolean {
    return this.router.url === route || this.router.url.startsWith(`${route}/`);
  }

  async navigateFromBottomNav(route: string, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    const now = Date.now();
    if (this.lastNavRoute === route && now - this.lastNavTapAt < 450) {
      return;
    }

    this.lastNavRoute = route;
    this.lastNavTapAt = now;

    if (this.isNavRouteActive(route)) {
      await this.scrollActiveTabToTop();
      return;
    }

    if (route === '/tabs/settings') {
      await this.refreshFeedbackService.lightImpact();
    } else {
      void this.refreshFeedbackService.lightImpact();
    }

    this.router.navigateByUrl(route);
  }

  isFavouriteStop(stop: NearbyBusStop): boolean {
    return this.favouriteBusStops.some((favouriteStop) => favouriteStop.BusStopCode === stop.BusStopCode);
  }

  toggleFavouriteStop(stop: NearbyBusStop): void {
    const wasFavourite = this.isFavouriteStop(stop);
    let becameFavourite = false;

    if (wasFavourite) {
      this.favouriteBusStops = this.favouriteBusStops.filter((favouriteStop) => favouriteStop.BusStopCode !== stop.BusStopCode);
    } else {
      const favouriteStop: FavouriteBusStop = {
        BusStopCode: stop.BusStopCode,
        Description: stop.Description,
        RoadName: stop.RoadName,
        Latitude: stop.Latitude,
        Longitude: stop.Longitude
      };

      this.favouriteBusStops = [
        favouriteStop,
        ...this.favouriteBusStops.filter((existingStop) => existingStop.BusStopCode !== stop.BusStopCode)
      ];
      becameFavourite = true;
    }

    this.saveFavouriteBusStops();

    if (becameFavourite) {
      void this.refreshFeedbackService.favouriteSaved();
      void this.reviewService.requestAutomaticReviewIfEligible();
    } else {
      void this.refreshFeedbackService.lightImpact();
    }

    this.recentlyToggledFavouriteCode = stop.BusStopCode;
    this.recentFavouriteAction = wasFavourite ? 'removed' : 'saved';

    if (this.favouritePopTimer) {
      clearTimeout(this.favouritePopTimer);
    }

    this.favouritePopTimer = setTimeout(() => {
      if (this.recentlyToggledFavouriteCode === stop.BusStopCode) {
        this.recentlyToggledFavouriteCode = '';
        this.recentFavouriteAction = '';
      }
    }, 460);
  }

  selectNearbyStop(stop: NearbyBusStop): void {
    this.selectedNearbyStop = stop;
    this.updateStopMarkerStyles();
    this.openSelectedStopCallout(stop);
    this.map?.setView([Number(stop.Latitude), Number(stop.Longitude)], Math.max(this.map.getZoom(), 16), {
      animate: true
    });
    this.scrollToPageTop();
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

  formatBusStopName(stop: { Description?: string; RoadName?: string } | null | undefined, displayName?: string): string {
    return formatBusStopDisplayName(stop, displayName);
  }

  nearbyDistanceTone(distanceMeters: number): string {
    if (distanceMeters <= 120) {
      return 'near';
    }

    if (distanceMeters <= 300) {
      return 'medium';
    }

    return 'far';
  }

  recenterOnUserLocation(): void {
    if (!this.hasUserLocation || !this.map) {
      return;
    }

    this.clearSelectedStop();
    this.map.setView([this.mapCenter.latitude, this.mapCenter.longitude], Math.max(this.map.getZoom(), 16), {
      animate: true
    });
  }

  private async locationOrFallback(options: NearbyLoadOptions = {}): Promise<NearbyLocation> {
    const locationChoice = this.onboardingService.locationChoice();
    const forceFreshLocation = options.forceFreshLocation === true;
    console.info(`[Nearby] location permission choice=${locationChoice || 'unknown'}`);

    if (!this.onboardingService.shouldRequestLocationAutomatically() && !forceFreshLocation) {
      console.info('[Nearby] location deferred by onboarding choice');
      this.locationAccessDeferred = true;
      this.hasUserLocation = false;
      this.isUsingFallbackLocation = false;
      this.nearbyStops = [];
      throw this.permissionDeferredError();
    }

    this.locationAccessDeferred = false;

    try {
      console.info('[Nearby] foreground geolocation start');
      const locationOptions = {
        enableHighAccuracy: false,
        maximumAge: forceFreshLocation ? 0 : 1000 * 60 * 15,
        timeout: forceFreshLocation ? 12000 : 6500
      };
      const location = forceFreshLocation
        ? await this.locationService.requestPermissionAndLocation(locationOptions)
        : await this.locationService.currentLocation(locationOptions);
      console.info('[Nearby] foreground geolocation success');

      this.hasUserLocation = true;
      this.isUsingFallbackLocation = false;
      if (forceFreshLocation && locationChoice !== 'granted') {
        this.onboardingService.complete('granted');
      }
      const currentLocation = { latitude: location.latitude, longitude: location.longitude };
      this.saveLastLocation(currentLocation);
      return currentLocation;
    } catch (error) {
      console.warn('[Nearby] foreground geolocation failed', error);
      if (this.isPermissionDenied(error)) {
        this.hasUserLocation = false;
        this.isUsingFallbackLocation = false;
        this.locationAccessDeferred = true;
        this.nearbyStops = [];
        throw error;
      }

      if (forceFreshLocation) {
        this.hasUserLocation = false;
        this.isUsingFallbackLocation = false;
        throw error;
      }

      const lastLocation = this.loadLastLocation();

      if (lastLocation) {
        this.hasUserLocation = true;
        this.isUsingFallbackLocation = true;
        this.nearbyError = 'Using your last known location while your phone refreshes nearby stops.';
        return lastLocation;
      }

      this.hasUserLocation = false;
      this.isUsingFallbackLocation = false;
      throw error;
    }
  }

  private refreshLocationInBackground(stops: BusStop[], currentLocation: NearbyLocation): void {
    if (!this.onboardingService.shouldRequestLocationAutomatically()) {
      return;
    }

    console.info('[Nearby] background geolocation start');
    this.locationService.currentLocation({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 7000
    })
      .then((location) => {
        console.info('[Nearby] background geolocation success');
        const freshLocation = { latitude: location.latitude, longitude: location.longitude };

        if (this.distanceMeters(
          currentLocation.latitude,
          currentLocation.longitude,
          freshLocation.latitude,
          freshLocation.longitude
        ) < 40) {
          return;
        }

        this.ngZone.run(() => {
          this.hasUserLocation = true;
          this.isUsingFallbackLocation = false;
          this.nearbyError = '';
          this.saveLastLocation(freshLocation);
          this.mapCenter = freshLocation;
          this.renderNearbyStops(stops, freshLocation);
        });
      })
      .catch((error) => {
        console.warn('[Nearby] background geolocation failed', error);
        // Keep the fast cached/fallback result visible if precise location wakes slowly.
      });
  }

  private renderNearbyStops(stops: BusStop[], location: NearbyLocation): void {
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
      .slice(0, 12);
    this.updateMap(location.latitude, location.longitude);
  }

  private scrollToPageTop(): void {
    setTimeout(() => {
      this.content?.scrollToTop(520);
    }, 40);
  }

  private async scrollActiveTabToTop(): Promise<void> {
    this.isProgrammaticScroll = true;

    try {
      await this.sameTabScrollService.toTop(this.content);
    } finally {
      this.isProgrammaticScroll = false;
    }
  }

  private saveLastLocation(location: NearbyLocation): void {
    localStorage.setItem(this.lastLocationStorageKey, JSON.stringify({
      ...location,
      savedAt: Date.now()
    }));
    this.widgetBridgeService.syncWidgetData();
  }

  private loadLastLocation(): NearbyLocation | undefined {
    const storedLocation = localStorage.getItem(this.lastLocationStorageKey);

    if (!storedLocation) {
      return undefined;
    }

    try {
      const parsedLocation = JSON.parse(storedLocation) as StoredNearbyLocation;
      const isUsableLocation = Number.isFinite(parsedLocation.latitude)
        && Number.isFinite(parsedLocation.longitude)
        && Number.isFinite(parsedLocation.savedAt)
        && Date.now() - parsedLocation.savedAt <= this.lastLocationMaxAgeMs;

      if (!isUsableLocation) {
        return undefined;
      }

      return {
        latitude: parsedLocation.latitude,
        longitude: parsedLocation.longitude
      };
    } catch {
      return undefined;
    }
  }

  private loadFavouriteBusStops(): FavouriteBusStop[] {
    const storedStops = localStorage.getItem(this.favouritesStorageKey);

    if (!storedStops) {
      return [];
    }

    try {
      const parsedStops = JSON.parse(storedStops) as FavouriteBusStop[];
      return Array.isArray(parsedStops) ? parsedStops : [];
    } catch {
      return [];
    }
  }

  private saveFavouriteBusStops(): void {
    localStorage.setItem(this.favouritesStorageKey, JSON.stringify(this.favouriteBusStops));
    this.widgetBridgeService.syncWidgetData();
  }

  private initializeMap(): void {
    if (this.map || !this.nearbyMapElement) {
      return;
    }

    this.map = L.map(this.nearbyMapElement.nativeElement, {
      attributionControl: false,
      zoomControl: false
    }).setView([this.singaporeCenter.latitude, this.singaporeCenter.longitude], 13);

    this.map.on('click', () => this.ngZone.run(() => this.clearSelectedStop()));

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  private updateMap(latitude: number, longitude: number): void {
    this.initializeMap();

    if (!this.map) {
      return;
    }

    this.map.setView([latitude, longitude], 15);

    if (this.userMarker) {
      this.userMarker.setLatLng([latitude, longitude]);
    } else {
      this.userMarker = L.marker([latitude, longitude], {
        icon: this.userLocationIcon()
      }).addTo(this.map);
    }

    this.stopMarkers.forEach((marker) => marker.remove());
    this.stopMarkers.clear();

    this.nearbyStops.forEach((stop) => {
      const marker = L.marker([Number(stop.Latitude), Number(stop.Longitude)], {
        icon: this.stopIcon(false)
      }).addTo(this.map as L.Map);

      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        this.ngZone.run(() => this.selectNearbyStop(stop));
      });
      this.stopMarkers.set(stop.BusStopCode, marker);
    });

    const bounds = L.latLngBounds([[latitude, longitude] as [number, number]]);
    this.nearbyStops.forEach((stop) => bounds.extend([Number(stop.Latitude), Number(stop.Longitude)]));

    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    }
  }

  private updateStopMarkerStyles(): void {
    this.stopMarkers.forEach((marker, busStopCode) => {
      marker.setIcon(this.stopIcon(this.selectedNearbyStop?.BusStopCode === busStopCode));
    });
  }

  private clearSelectedStop(): void {
    this.selectedNearbyStop = undefined;
    this.updateStopMarkerStyles();
    this.map?.closePopup(this.selectedStopPopup);
  }

  private openSelectedStopCallout(stop: NearbyBusStop): void {
    if (!this.map) {
      return;
    }

    const content = L.DomUtil.create('div', 'nearby-map-callout');
    const copy = L.DomUtil.create('div', 'nearby-map-callout__copy', content);
    const title = L.DomUtil.create('h2', '', copy);
    title.textContent = this.formatBusStopName(stop, stop.Description || `Bus Stop ${stop.BusStopCode}`);
    const subtitle = L.DomUtil.create('p', '', copy);
    subtitle.textContent = `${stop.RoadName || 'Nearby stop'} · ${stop.BusStopCode}`;
    const distance = L.DomUtil.create('span', '', copy);
    distance.textContent = this.distanceLabel(stop.distanceMeters);
    const action = L.DomUtil.create('button', 'nearby-map-callout__action', content) as HTMLButtonElement;
    action.type = 'button';
    action.textContent = 'View buses';
    L.DomEvent.disableClickPropagation(content);
    L.DomEvent.on(action, 'click', () => this.ngZone.run(() => this.viewBuses(stop)));

    this.selectedStopPopup = L.popup({
      autoPan: true,
      autoPanPadding: [18, 18],
      className: 'nearby-map-popup',
      closeButton: false,
      closeOnClick: true,
      maxWidth: 280,
      minWidth: 246,
      offset: [0, -16]
    })
      .setLatLng([Number(stop.Latitude), Number(stop.Longitude)])
      .setContent(content)
      .openOn(this.map);
  }

  private userLocationIcon(): L.DivIcon {
    return L.divIcon({
      className: 'nearby-user-marker',
      html: '<span class="nearby-user-marker__pulse"></span><span class="nearby-user-marker__dot"></span>',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  private stopIcon(selected: boolean): L.DivIcon {
    const busStopIcon = `
      <span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M7 3.5C7 2.67 7.67 2 8.5 2h7C16.33 2 17 2.67 17 3.5V5h1.25C19.77 5 21 6.23 21 7.75v8.5A2.75 2.75 0 0 1 18.25 19H17v2h-2v-2H9v2H7v-2H5.75A2.75 2.75 0 0 1 3 16.25v-8.5C3 6.23 4.23 5 5.75 5H7V3.5Zm2 .5v1h6V4H9Zm-3.25 3A.75.75 0 0 0 5 7.75V12h14V7.75a.75.75 0 0 0-.75-.75H5.75ZM5 16.25c0 .41.34.75.75.75h12.5c.41 0 .75-.34.75-.75V14H5v2.25ZM7 15h2v1H7v-1Zm8 0h2v1h-2v-1Z"/>
        </svg>
      </span>
    `;

    return L.divIcon({
      className: selected ? 'nearby-stop-marker selected' : 'nearby-stop-marker',
      html: busStopIcon,
      iconSize: selected ? [40, 40] : [34, 34],
      iconAnchor: selected ? [20, 20] : [17, 17]
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
      return 'Location is off. Search and favourites still work, and you can enable location in Settings later.';
    }

    if (this.isPermissionDeferred(error)) {
      return 'Nearby stops need location to work. Search and favourites still work, and you can enable location in Settings later.';
    }

    if (this.isTimeoutError(error)) {
      return 'Finding your location is taking longer than expected. Pull down to try again.';
    }

    return 'Nearby stops are taking a quiet pause. Try again in a moment.';
  }

  private isActiveNearbyRequest(requestId: number): boolean {
    return requestId === this.nearbyLoadRequestId;
  }

  private isPermissionDenied(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && Number((error as GeolocationPositionError).code) === 1;
  }

  private isPermissionDeferred(error: unknown): boolean {
    return error instanceof Error && error.message === 'location-permission-deferred';
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof Error && (
      error.message.includes('timeout')
      || ('code' in error && Number((error as GeolocationPositionError).code) === 3)
    );
  }

  private permissionDeferredError(): Error & { code: number } {
    return Object.assign(new Error('location-permission-deferred'), { code: 0 });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        console.warn(`[Nearby] timeout ${message} after ${timeoutMs}ms`);
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
