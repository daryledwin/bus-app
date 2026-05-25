import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { BusRoute, LtaBusRoutesService } from '../services/lta-bus-routes.service';
import { BusServiceArrival, LtaBusService } from '../services/lta-bus.service';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { SelectedBusStopService } from '../services/selected-bus-stop.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  active?: boolean;
}

interface FavouriteBusStop {
  BusStopCode: string;
  Description: string;
  RoadName: string;
  nickname?: string;
}

interface RouteProgressStop {
  code: string;
  name: string;
  roadName: string;
  status: 'previous' | 'current' | 'next' | 'terminal';
}

interface RouteProgression {
  stops: RouteProgressStop[];
  stopsRemaining: number;
  terminalName: string;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page implements OnInit, OnDestroy {
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild('arrivalsSection') private readonly arrivalsSection?: ElementRef<HTMLElement>;

  readonly greeting = this.currentGreeting();
  searchTerm = '';
  searchedBusStopCode = '';
  liveBusServices: BusServiceArrival[] = [];
  busStopResults: BusStop[] = [];
  recentBusStops: BusStop[] = [];
  favouriteBusStops: FavouriteBusStop[] = [];
  selectedBusStop?: BusStop;
  isLoadingArrivals = false;
  isLoadingBusStops = false;
  hasSearchedArrivals = false;
  arrivalError = '';
  stopSearchError = '';
  expandedLiveServiceNo = '';
  routeProgressions: Record<string, RouteProgression> = {};
  routeProgressLoading: Record<string, boolean> = {};
  routeProgressErrors: Record<string, string> = {};
  isRouteModalOpen = false;
  selectedRouteServiceNo = '';
  selectedRouteService?: BusServiceArrival;
  private busStops: BusStop[] = [];
  private busStopLookup = new Map<string, BusStop>();
  private busStopsLoadPromise?: Promise<BusStop[]>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private routePrefetchTimer?: ReturnType<typeof setTimeout>;
  private selectedStopSubscription?: Subscription;
  private readonly favouritesStorageKey = 'favouriteBusStops';

  readonly popularStops: BusStop[] = [
    {
      BusStopCode: '01012',
      Description: 'Hotel Grand Pacific',
      RoadName: 'Victoria St',
      Latitude: 1.29685,
      Longitude: 103.853
    },
    {
      BusStopCode: '08057',
      Description: 'Dhoby Ghaut Stn',
      RoadName: 'Orchard Rd',
      Latitude: 1.29947,
      Longitude: 103.84594
    },
    {
      BusStopCode: '01112',
      Description: 'Opp Bugis Stn Exit C',
      RoadName: 'Victoria St',
      Latitude: 1.30009,
      Longitude: 103.8552
    }
  ];

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home-outline', route: '/tabs/tab1', active: true },
    { label: 'Nearby', icon: 'navigate-outline', route: '/tabs/tab2' }
  ];

  constructor(
    private readonly ltaBusService: LtaBusService,
    private readonly ltaBusRoutesService: LtaBusRoutesService,
    private readonly ltaBusStopsService: LtaBusStopsService,
    private readonly selectedBusStopService: SelectedBusStopService
  ) {
    this.recentBusStops = this.loadRecentBusStops();
    this.favouriteBusStops = this.loadFavouriteBusStops();
  }

  async ngOnInit(): Promise<void> {
    console.log('IOS DEBUG 1 - home page initialized');
    this.selectedStopSubscription = this.selectedBusStopService.selectedStop$.subscribe((stop) => {
      if (!stop) {
        return;
      }

      this.selectedBusStopService.clearSelection();
      this.selectBusStop(stop);
    });

    try {
      await this.loadBusStops();
    } catch {
      this.logMatchesFound(0);
    }
  }

  ngOnDestroy(): void {
    this.selectedStopSubscription?.unsubscribe();

    if (this.routePrefetchTimer) {
      clearTimeout(this.routePrefetchTimer);
    }
  }

  get isTextSearchActive(): boolean {
    const query = this.searchTerm.trim();
    return !!query && !this.selectedBusStop && !this.isBusStopCode(query);
  }

  submitSearch(): void {
    const query = this.searchTerm.trim();
    this.logSearchQuery(query);

    if (this.isBusStopCode(query)) {
      this.searchArrivals(query);
      return;
    }

    this.searchBusStops(query);
  }

  onSearchTermChange(value: string): void {
    this.stopSearchError = '';
    this.selectedBusStop = undefined;

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      const query = value.trim();
      this.logSearchQuery(query);

      if (!query) {
        this.busStopResults = [];
        this.logMatchesFound(0);
        return;
      }

      if (this.isBusStopCode(query)) {
        this.busStopResults = [];
        this.logMatchesFound(0);
        this.searchArrivals(query);
        return;
      }

      this.searchBusStops(query);
    }, 220);
  }

  searchArrivals(busStopCode = this.searchedBusStopCode): void {
    this.hasSearchedArrivals = true;
    this.isLoadingArrivals = true;
    this.arrivalError = '';
    this.liveBusServices = [];
    this.resetRouteState();

    this.ltaBusService.getBusArrivals(busStopCode).subscribe({
      next: (arrivalLookup) => {
        this.searchedBusStopCode = arrivalLookup.busStopCode;
        this.liveBusServices = this.sortLiveServices(arrivalLookup.services);
        this.isLoadingArrivals = false;
        this.prefetchRouteProgressions(this.liveBusServices);
        this.scrollToArrivals();
      },
      error: (error) => {
        this.searchedBusStopCode = busStopCode.trim();
        this.arrivalError = this.errorMessage(error);
        this.isLoadingArrivals = false;
        this.scrollToArrivals();
      }
    });
  }

  selectBusStop(stop: BusStop): void {
    this.selectedBusStop = stop;
    this.searchTerm = `${stop.Description} (${stop.BusStopCode})`;
    this.busStopResults = [];
    this.rememberBusStop(stop);
    this.searchArrivals(stop.BusStopCode);
  }

  trackBusStop(index: number, stop: BusStop): string {
    return stop.BusStopCode;
  }

  trackLiveService(index: number, service: BusServiceArrival): string {
    return service.serviceNo;
  }

  trackFavouriteBusStop(index: number, stop: FavouriteBusStop): string {
    return stop.BusStopCode;
  }

  isCurrentBusStopFavourite(): boolean {
    const currentStop = this.currentBusStopForFavourite();
    return !!currentStop && this.favouriteBusStops.some((stop) => stop.BusStopCode === currentStop.BusStopCode);
  }

  toggleCurrentFavourite(): void {
    const currentStop = this.currentBusStopForFavourite();

    if (!currentStop) {
      return;
    }

    if (this.favouriteBusStops.some((stop) => stop.BusStopCode === currentStop.BusStopCode)) {
      this.removeFavouriteStop(currentStop.BusStopCode);
      return;
    }

    this.favouriteBusStops = [
      currentStop,
      ...this.favouriteBusStops.filter((stop) => stop.BusStopCode !== currentStop.BusStopCode)
    ];
    this.saveFavouriteBusStops();
  }

  viewFavouriteStop(stop: FavouriteBusStop): void {
    this.selectedBusStop = {
      BusStopCode: stop.BusStopCode,
      Description: stop.Description,
      RoadName: stop.RoadName,
      Latitude: 0,
      Longitude: 0
    };
    this.searchTerm = `${stop.Description} (${stop.BusStopCode})`;
    this.busStopResults = [];
    this.rememberBusStop(this.selectedBusStop);
    this.searchArrivals(stop.BusStopCode);
  }

  removeFavouriteStop(busStopCode: string): void {
    this.favouriteBusStops = this.favouriteBusStops.filter((stop) => stop.BusStopCode !== busStopCode);
    this.saveFavouriteBusStops();
  }

  renameFavouriteStop(stop: FavouriteBusStop): void {
    const nickname = window.prompt('Name this stop', stop.nickname || '');

    if (nickname === null) {
      return;
    }

    const trimmedNickname = nickname.trim();
    this.favouriteBusStops = this.favouriteBusStops.map((favouriteStop) => {
      if (favouriteStop.BusStopCode !== stop.BusStopCode) {
        return favouriteStop;
      }

      const updatedStop = { ...favouriteStop };

      if (trimmedNickname) {
        updatedStop.nickname = trimmedNickname;
      } else {
        delete updatedStop.nickname;
      }

      return updatedStop;
    });
    this.saveFavouriteBusStops();
  }

  toggleLiveService(serviceNo: string): void {
    this.expandedLiveServiceNo = this.expandedLiveServiceNo === serviceNo ? '' : serviceNo;
  }

  openRouteModal(service: BusServiceArrival): void {
    this.selectedRouteService = service;
    this.selectedRouteServiceNo = service.serviceNo;
    this.isRouteModalOpen = true;
    this.loadRouteProgression(service.serviceNo);
  }

  closeRouteModal(): void {
    this.isRouteModalOpen = false;
  }

  routeModalDismissed(): void {
    this.isRouteModalOpen = false;
  }

  destinationLabel(service: BusServiceArrival): string {
    return service.nextBus.destinationCode
      ? `Destination ${service.nextBus.destinationCode}`
      : 'Destination unavailable';
  }

  timingTone(service: BusServiceArrival): string {
    const minutesAway = service.nextBus.minutesAway;

    if (minutesAway !== null && minutesAway <= 1) {
      return 'arriving';
    }

    if (minutesAway !== null && minutesAway <= 5) {
      return 'soon';
    }

    return 'later';
  }

  private async searchBusStops(query: string): Promise<void> {
    const trimmedQuery = query.trim();
    this.logSearchQuery(trimmedQuery);

    if (!trimmedQuery) {
      this.busStopResults = [];
      this.logMatchesFound(0);
      return;
    }

    this.isLoadingBusStops = true;
    this.busStopResults = [];

    try {
      await this.ensureBusStopsLoaded();
    } catch {
      this.logMatchesFound(0);
      this.isLoadingBusStops = false;
      return;
    }

    console.log('Searching inside busStops count:', this.busStops.length);
    console.log('IOS DEBUG 3 - searching inside busStops count:', this.busStops.length);

    const latestQuery = this.searchTerm.trim();

    if (!latestQuery || this.isBusStopCode(latestQuery)) {
      this.busStopResults = [];
      this.logMatchesFound(0);
      this.isLoadingBusStops = false;
      return;
    }

    this.busStopResults = this.rankBusStops(latestQuery);

    if (!this.busStopResults.length) {
      this.busStopResults = await this.searchBackendBusStops(latestQuery);
    }

    this.logMatchesFound(this.busStopResults.length);
    this.isLoadingBusStops = false;
  }

  private async ensureBusStopsLoaded(): Promise<BusStop[]> {
    if (this.busStops.length) {
      return this.busStops;
    }

    return this.loadBusStops(true);
  }

  private async loadBusStops(forceRefresh = false): Promise<BusStop[]> {
    if (this.busStops.length && !forceRefresh) {
      return this.busStops;
    }

    if (this.busStopsLoadPromise) {
      return this.busStopsLoadPromise;
    }

    this.isLoadingBusStops = true;
    console.log('Starting bus stops fetch...');

    this.busStopsLoadPromise = this.ltaBusStopsService.getBusStops(forceRefresh).toPromise()
      .then((stops = []) => {
        this.busStops = Array.isArray(stops) ? stops : [];
        this.busStopLookup = new Map(this.busStops.map((stop) => [stop.BusStopCode, stop]));
        console.log('Bus stops loaded count:', this.busStops.length);
        console.log('IOS DEBUG 2 - bus stops loaded count:', this.busStops.length);
        console.log('First bus stop sample:', this.busStops[0]);
        return this.busStops;
      })
      .catch((error) => {
        console.error('Bus stops fetch failed:', error);
        this.stopSearchError = 'Bus stop names are resting for a moment. A 5-digit stop code still works.';
        this.busStopResults = [];
        throw error;
      })
      .finally(() => {
        this.isLoadingBusStops = false;
        this.busStopsLoadPromise = undefined;
      });

    return this.busStopsLoadPromise;
  }

  private async searchBackendBusStops(query: string): Promise<BusStop[]> {
    try {
      console.log('Starting bus stops fetch...');
      const stops = await this.ltaBusStopsService.searchBusStops(query).toPromise();
      const fallbackStops = Array.isArray(stops) ? stops : [];

      if (!fallbackStops.length) {
        return [];
      }

      return this.rankBusStops(query, fallbackStops);
    } catch (error) {
      console.error('Bus stops fetch failed:', error);
      return [];
    }
  }

  private async loadRouteProgression(serviceNo: string): Promise<void> {
    if (this.routeProgressions[serviceNo] || this.routeProgressLoading[serviceNo]) {
      return;
    }

    const currentBusStopCode = this.searchedBusStopCode.trim();

    if (!currentBusStopCode) {
      this.routeProgressErrors[serviceNo] = 'Route progression is unavailable for this stop.';
      return;
    }

    this.routeProgressLoading[serviceNo] = true;
    this.routeProgressErrors[serviceNo] = '';

    try {
      const [routes] = await Promise.all([
        this.ltaBusRoutesService.getBusRoutes(serviceNo).toPromise(),
        this.ensureBusStopsLoaded().catch(() => [])
      ]);
      const progression = this.buildRouteProgression(Array.isArray(routes) ? routes : [], currentBusStopCode);

      if (progression) {
        this.routeProgressions[serviceNo] = progression;
      } else {
        this.routeProgressErrors[serviceNo] = 'Route progression is unavailable for this stop.';
      }
    } catch {
      this.routeProgressErrors[serviceNo] = 'Route progression is taking a pause.';
    } finally {
      this.routeProgressLoading[serviceNo] = false;
    }
  }

  private prefetchRouteProgressions(services: BusServiceArrival[]): void {
    if (this.routePrefetchTimer) {
      clearTimeout(this.routePrefetchTimer);
    }

    this.routePrefetchTimer = setTimeout(() => {
      services.slice(0, 4).forEach((service) => {
        this.loadRouteProgression(service.serviceNo);
      });
    }, 450);
  }

  private buildRouteProgression(routes: BusRoute[], currentBusStopCode: string): RouteProgression | null {
    const matchingRoute = routes.find((route) => route.BusStopCode === currentBusStopCode);

    if (!matchingRoute) {
      return null;
    }

    const orderedRoute = routes
      .filter((route) => route.Direction === matchingRoute.Direction)
      .sort((a, b) => Number(a.StopSequence) - Number(b.StopSequence));
    const currentStopIndex = orderedRoute.findIndex((route) => route.BusStopCode === currentBusStopCode);

    if (currentStopIndex < 0) {
      return null;
    }

    const terminalRoute = orderedRoute[orderedRoute.length - 1];
    const progressionStops = orderedRoute.map((route, routeIndex) => {
      return this.routeProgressStop(route, routeIndex < currentStopIndex
        ? 'previous'
        : routeIndex === currentStopIndex
          ? 'current'
          : route.BusStopCode === terminalRoute.BusStopCode
            ? 'terminal'
          : 'next');
    });
    const terminalStop = this.routeProgressStop(terminalRoute, 'terminal');

    return {
      stops: progressionStops,
      stopsRemaining: Math.max(0, orderedRoute.length - currentStopIndex - 1),
      terminalName: terminalStop.name
    };
  }

  private routeProgressStop(route: BusRoute, status: RouteProgressStop['status']): RouteProgressStop {
    const busStop = this.busStopLookup.get(route.BusStopCode);

    return {
      code: route.BusStopCode,
      name: busStop?.Description || route.BusStopCode,
      roadName: busStop?.RoadName || route.BusStopCode,
      status
    };
  }

  private currentBusStopForFavourite(): FavouriteBusStop | null {
    const busStopCode = this.searchedBusStopCode.trim();

    if (!busStopCode) {
      return null;
    }

    const knownStop = this.selectedBusStop
      || this.busStopLookup.get(busStopCode)
      || this.recentBusStops.find((stop) => stop.BusStopCode === busStopCode);

    return {
      BusStopCode: busStopCode,
      Description: knownStop?.Description || `Stop ${busStopCode}`,
      RoadName: knownStop?.RoadName || 'Road unavailable'
    };
  }

  private resetRouteState(): void {
    if (this.routePrefetchTimer) {
      clearTimeout(this.routePrefetchTimer);
      this.routePrefetchTimer = undefined;
    }

    this.expandedLiveServiceNo = '';
    this.routeProgressions = {};
    this.routeProgressLoading = {};
    this.routeProgressErrors = {};
    this.isRouteModalOpen = false;
    this.selectedRouteServiceNo = '';
    this.selectedRouteService = undefined;
  }

  private rankBusStops(query: string, stops = this.busStops): BusStop[] {
    const normalizedQuery = this.normalize(query);
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    return stops
      .map((stop) => ({
        stop,
        score: this.matchScore(stop, normalizedQuery, queryTokens)
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || String(a.stop.Description || '').localeCompare(String(b.stop.Description || '')))
      .slice(0, 8)
      .map((result) => result.stop);
  }

  private sortLiveServices(services: BusServiceArrival[]): BusServiceArrival[] {
    return [...services].sort((a, b) => this.arrivalSortValue(a) - this.arrivalSortValue(b));
  }

  private arrivalSortValue(service: BusServiceArrival): number {
    return service.nextBus.minutesAway === null ? Number.MAX_SAFE_INTEGER : service.nextBus.minutesAway;
  }

  private matchScore(stop: BusStop, query: string, tokens: string[]): number {
    const description = this.normalize(stop.Description);
    const road = this.normalize(stop.RoadName);
    const code = this.normalize(stop.BusStopCode);
    const searchableText = `${description} ${road} ${code}`;
    let score = 0;

    if (code === query) {
      score += 120;
    }

    if (description.startsWith(query)) {
      score += 70;
    } else if (description.includes(query)) {
      score += 48;
    }

    if (road.startsWith(query)) {
      score += 42;
    } else if (road.includes(query)) {
      score += 30;
    }

    if (code.startsWith(query)) {
      score += 36;
    }

    const matchingTokens = tokens.filter((token) => searchableText.includes(token)).length;

    if (matchingTokens === tokens.length) {
      score += matchingTokens * 16;
    }

    return score;
  }

  private normalize(value: string | undefined): string {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private isBusStopCode(value: string): boolean {
    return /^\d{5}$/.test(value);
  }

  private currentGreeting(): string {
    const hour = new Date().getHours();

    if (hour < 12) {
      return 'good morning';
    }

    if (hour < 18) {
      return 'good afternoon';
    }

    return 'good evening';
  }

  private logSearchQuery(query: string): void {
    console.log(`Current search query: ${query}`);
  }

  private logMatchesFound(count: number): void {
    console.log(`Matches found: ${count}`);
  }

  private scrollToArrivals(): void {
    setTimeout(() => {
      const sectionTop = this.arrivalsSection?.nativeElement.offsetTop || 0;
      this.content?.scrollToPoint(0, Math.max(sectionTop - 18, 0), 520);
    }, 80);
  }

  private rememberBusStop(stop: BusStop): void {
    this.recentBusStops = [
      stop,
      ...this.recentBusStops.filter((recentStop) => recentStop.BusStopCode !== stop.BusStopCode)
    ].slice(0, 3);

    localStorage.setItem('recentBusStops', JSON.stringify(this.recentBusStops));
  }

  private loadRecentBusStops(): BusStop[] {
    const storedStops = localStorage.getItem('recentBusStops');

    if (!storedStops) {
      return [];
    }

    try {
      return JSON.parse(storedStops) as BusStop[];
    } catch {
      return [];
    }
  }

  private loadFavouriteBusStops(): FavouriteBusStop[] {
    const storedStops = localStorage.getItem(this.favouritesStorageKey);

    if (!storedStops) {
      return [];
    }

    try {
      const parsedStops = JSON.parse(storedStops) as FavouriteBusStop[];

      if (!Array.isArray(parsedStops)) {
        return [];
      }

      return parsedStops.filter((stop) => stop?.BusStopCode && stop.Description && stop.RoadName);
    } catch {
      return [];
    }
  }

  private saveFavouriteBusStops(): void {
    localStorage.setItem(this.favouritesStorageKey, JSON.stringify(this.favouriteBusStops));
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.startsWith('Please enter')) {
      return error.message;
    }

    return 'The live bus feed is taking a quiet pause. Try this bus stop code again in a moment.';
  }
}
