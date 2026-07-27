import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, Optional, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { IonContent, IonRouterOutlet } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BusRoute, LtaBusRoutesService } from '../services/lta-bus-routes.service';
import { BusArrivalLookup, BusServiceArrival, LtaBusService } from '../services/lta-bus.service';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { SelectedBusStopService } from '../services/selected-bus-stop.service';
import { BusLiveActivityPayload, WidgetBridgeService } from '../services/widget-bridge.service';
import { LiveActivityTrackingService, LiveActivityTrackingState, LiveTrackDebugState } from '../services/live-activity-tracking.service';
import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { ReviewService } from '../services/review.service';
import { SameTabScrollService } from '../services/same-tab-scroll.service';
import { LocationService } from '../services/location.service';
import { SPLASH_TAGLINES } from '../app.component';
import { formatBusStopName as formatBusStopDisplayName } from '../utils/bus-stop-display';
import { rankBusStopSearchResults } from '../utils/bus-stop-search';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

interface FavouriteBusStop {
  BusStopCode: string;
  Description: string;
  RoadName: string;
  nickname?: string;
  Latitude?: number;
  Longitude?: number;
  dateAdded?: number;
}

type FavouriteSortMode = 'dateAdded' | 'name' | 'distance';

interface RouteProgressStop {
  code: string;
  name: string;
  roadName: string;
  status: 'previous' | 'current' | 'next' | 'terminal';
}

interface RouteProgression {
  stops: RouteProgressStop[];
  currentStopIndex: number;
  stopsRemaining: number;
  terminalName: string;
}

interface ArrivalSearchOptions {
  forceRefresh?: boolean;
  preserveRouteState?: boolean;
  preserveScrollPosition?: boolean;
  scrollToArrivals?: boolean;
  confirmLoadedHaptic?: boolean;
  silentLiveActivityRefresh?: boolean;
}

interface HeroTimeOfDay {
  icon: string;
  label: string;
}

type PinnedBusServicesByStop = Record<string, string[]>;

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild('arrivalsSection') private readonly arrivalsSection?: ElementRef<HTMLElement>;
  @ViewChild('recentStopsScroller') private readonly recentStopsScroller?: ElementRef<HTMLElement>;
  @ViewChild('favouriteStopsScroller') private readonly favouriteStopsScroller?: ElementRef<HTMLElement>;
  @ViewChildren('routeStopRow') private readonly routeStopRows?: QueryList<ElementRef<HTMLElement>>;

  readonly heroTimeOfDay = this.currentHeroTimeOfDay();
  currentLocalTimeLabel = this.formatCurrentLocalTime();
  heroTagline = this.randomHeroTagline();
  displayedHeroTagline = '';
  searchTerm = '';
  searchedBusStopCode = '';
  liveBusServices: BusServiceArrival[] = [];
  busStopResults: BusStop[] = [];
  recentBusStops: BusStop[] = [];
  favouriteBusStops: FavouriteBusStop[] = [];
  selectedBusStop?: BusStop;
  isLoadingArrivals = false;
  isLoadingBusStops = false;
  isProgrammaticScroll = false;
  isSettlingArrivals = false;
  hasSearchedArrivals = false;
  showStickyArrivalHeader = false;
  favouriteSortMode: FavouriteSortMode = 'dateAdded';
  isFavouriteSortPopoverOpen = false;
  favouriteSortMessage = '';
  recentlyAnimatedFavouriteCode = '';
  recentFavouriteAction: 'saved' | 'removed' | '' = '';
  arrivalError = '';
  stopSearchError = '';
  expandedLiveServiceNo = '';
  routeProgressions: Record<string, RouteProgression> = {};
  routeProgressLoading: Record<string, boolean> = {};
  routeProgressErrors: Record<string, string> = {};
  isRouteModalOpen = false;
  selectedRouteServiceNo = '';
  selectedRouteService?: BusServiceArrival;
  lastArrivalsRefreshedLabel = '';
  isPinInfoPopupOpen = false;
  isPinOnboardingPopupOpen = false;
  isLiveActivityInfoPopupOpen = false;
  private busStops: BusStop[] = [];
  private busStopLookup = new Map<string, BusStop>();
  private busStopsLoadPromise?: Promise<BusStop[]>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private heroTaglineTimer?: ReturnType<typeof setInterval>;
  private heroTaglineTypingTimer?: ReturnType<typeof setTimeout>;
  private heroClockTimer?: ReturnType<typeof setTimeout>;
  private routePrefetchTimer?: ReturnType<typeof setTimeout>;
  private routePrefetchServiceNos: string[] = [];
  private routePrefetchRunId = 0;
  private routeModalScrollTimer?: ReturnType<typeof setTimeout>;
  private readonly routeReadyHapticKeys = new Set<string>();
  private favouriteAnimationTimer?: ReturnType<typeof setTimeout>;
  private lastArrivalsRefreshedAt = 0;
  private lastArrivalsRefreshedTimer?: ReturnType<typeof setInterval>;
  private selectedStopSubscription?: Subscription;
  private routeQuerySubscription?: Subscription;
  private liveActivityTrackingSubscription?: Subscription;
  private liveActivityDebugSubscription?: Subscription;
  private arrivalRequestId = 0;
  private normalArrivalSubscription?: Subscription;
  private normalArrivalInFlightStopCode = '';
  private normalArrivalOnComplete?: () => void;
  private normalArrivalStartedAt = 0;
  private normalArrivalCorrelationId = '';
  private refreshInProgress = false;
  private arrivalStickyThreshold = 0;
  private homeScrollElement?: HTMLElement;
  private readonly homeScrollListener = () => this.onHomeScroll();
  private lastNavTapAt = 0;
  private lastNavRoute = '';
  private pinnedBusServices: PinnedBusServicesByStop = {};
  private pendingPinnedService?: BusServiceArrival;
  private pendingLiveActivityService?: BusServiceArrival;
  liveTrackingState: LiveActivityTrackingState = {
    active: false,
    serviceNo: '',
    busStopCode: '',
    busStopName: '',
    arrivalStatus: '',
    nextArrivalTiming: '',
    thirdArrivalTiming: '',
    arrivalVisitNumber: null,
    nextArrivalVisitNumber: null,
    thirdArrivalVisitNumber: null,
    busType: '',
    wheelchairAccessible: false,
    seatAvailability: '',
    arrivalAt: 0,
    lastUpdatedAt: 0,
    startedAt: 0,
    expiresAt: 0
  };
  liveTrackDebugRows: Array<LiveTrackDebugState[keyof LiveTrackDebugState]> = [];
  private readonly liveActivityTimeoutMs = 30 * 60 * 1000;
  private readonly favouritesStorageKey = 'favouriteBusStops';
  private readonly favouriteSortStorageKey = 'favouriteStopsSortMode';
  private readonly pinnedBusServicesStorageKey = 'pinnedBusServicesByStop';
  private readonly pinnedBusServicesUpdatedAtStorageKey = 'pinnedBusServicesUpdatedAtByStop';
  private readonly pinInfoSeenStorageKey = 'pinBusServicesTipSeen';
  private readonly liveActivityInfoSeenStorageKey = 'liveActivityTrackingTipSeen';

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home-outline', route: '/tabs/tab1' },
    { label: 'Nearby', icon: 'navigate-outline', route: '/tabs/tab2' },
    { label: 'Settings', icon: 'settings-outline', route: '/tabs/settings' }
  ];

  constructor(
    private readonly ltaBusService: LtaBusService,
    private readonly ltaBusRoutesService: LtaBusRoutesService,
    private readonly ltaBusStopsService: LtaBusStopsService,
    private readonly activatedRoute: ActivatedRoute,
    private readonly router: Router,
    private readonly selectedBusStopService: SelectedBusStopService,
    private readonly refreshFeedbackService: RefreshFeedbackService,
    private readonly reviewService: ReviewService,
    private readonly sameTabScrollService: SameTabScrollService,
    private readonly locationService: LocationService,
    private readonly widgetBridgeService: WidgetBridgeService,
    private readonly liveActivityTrackingService: LiveActivityTrackingService,
    private readonly ngZone: NgZone,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {
    this.recentBusStops = this.loadRecentBusStops();
    this.favouriteSortMode = this.loadFavouriteSortMode();
    this.favouriteBusStops = this.loadFavouriteBusStops();
    this.pinnedBusServices = this.loadPinnedBusServices();
    this.applyFavouriteSort({ persist: false, silentDistanceFailure: true });
    this.syncWidgetFavouriteStop();
  }

  async ngOnInit(): Promise<void> {
    console.log('IOS DEBUG 1 - home page initialized');
    this.startHeroClock();
    this.revealHeroTagline(this.heroTagline);
    this.heroTaglineTimer = setInterval(() => this.rotateHeroTagline(), 5200);
    this.selectedStopSubscription = this.selectedBusStopService.selectedStop$.subscribe((stop) => {
      if (!stop) {
        return;
      }

      this.selectedBusStopService.clearSelection();
      this.selectBusStop(stop);
    });
    this.routeQuerySubscription = this.activatedRoute.queryParamMap.subscribe((params) => {
      const busStopCode = params.get('busStopCode')?.trim();
      const busStopName = params.get('busStopName')?.trim() || '';
      const source = params.get('source')?.trim() || '';

      if (!busStopCode) {
        return;
      }

      this.openBusStopFromDeepLink(busStopCode, busStopName, source);
    });
    this.liveActivityTrackingSubscription = this.liveActivityTrackingService.trackingState$.subscribe((state) => {
      this.liveTrackingState = state;
    });
    this.liveActivityDebugSubscription = this.liveActivityTrackingService.debugState$.subscribe((state) => {
      this.liveTrackDebugRows = [
        state.timer,
        state.httpRequest,
        state.httpResponse,
        state.trackedService,
        state.bridgeUpdate,
        state.nativeUpdate
      ];
    });

    try {
      await this.loadBusStops();
    } catch {
      this.logMatchesFound(0);
    }
  }

  ngAfterViewInit(): void {
    void this.attachHomeScrollListener();
  }

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = false;
    }

    this.favouriteBusStops = this.loadFavouriteBusStops();
    this.pinnedBusServices = this.loadPinnedBusServices();
    this.liveBusServices = this.sortLiveServices(this.liveBusServices);
    this.syncWidgetFavouriteStop();
  }

  ngOnDestroy(): void {
    this.cancelNormalArrivalRequest('page destroyed');
    this.selectedStopSubscription?.unsubscribe();
    this.routeQuerySubscription?.unsubscribe();
    this.liveActivityTrackingSubscription?.unsubscribe();
    this.liveActivityDebugSubscription?.unsubscribe();
    this.detachHomeScrollListener();

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.clearFavouriteAnimationTimer();

    if (this.heroTaglineTimer) {
      clearInterval(this.heroTaglineTimer);
    }

    if (this.heroClockTimer) {
      clearTimeout(this.heroClockTimer);
    }

    this.clearHeroTaglineTypingTimer();

    if (this.routePrefetchTimer) {
      clearTimeout(this.routePrefetchTimer);
    }

    if (this.routeModalScrollTimer) {
      clearTimeout(this.routeModalScrollTimer);
    }

    this.clearLastArrivalsRefreshedTimer();
  }

  private rotateHeroTagline(): void {
    this.heroTagline = this.randomHeroTagline(this.heroTagline);
    this.revealHeroTagline(this.heroTagline);
  }

  private revealHeroTagline(tagline: string): void {
    this.clearHeroTaglineTypingTimer();

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.displayedHeroTagline = tagline;
      return;
    }

    const characters = Array.from(tagline);
    const characterDelay = Math.min(40, Math.max(28, 1350 / characters.length));
    let characterIndex = 0;
    this.displayedHeroTagline = '';

    const revealNextCharacter = () => {
      this.displayedHeroTagline += characters[characterIndex];
      characterIndex++;

      if (characterIndex >= characters.length) {
        this.heroTaglineTypingTimer = undefined;
        return;
      }

      const previousCharacter = characters[characterIndex - 1];
      const punctuationPause = /[,.!?]/.test(previousCharacter) ? 70 : 0;
      this.heroTaglineTypingTimer = setTimeout(revealNextCharacter, characterDelay + punctuationPause);
    };

    this.heroTaglineTypingTimer = setTimeout(revealNextCharacter, 120);
  }

  private clearHeroTaglineTypingTimer(): void {
    if (this.heroTaglineTypingTimer) {
      clearTimeout(this.heroTaglineTypingTimer);
      this.heroTaglineTypingTimer = undefined;
    }
  }

  private randomHeroTagline(currentTagline = ''): string {
    const availableTaglines = SPLASH_TAGLINES.filter((tagline) => tagline !== currentTagline);
    const taglines = availableTaglines.length ? availableTaglines : SPLASH_TAGLINES;
    return taglines[Math.floor(Math.random() * taglines.length)];
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

  clearSearch(): void {
    void this.refreshFeedbackService.lightImpact();

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }

    this.cancelNormalArrivalRequest('search cleared');

    this.arrivalRequestId++;
    this.searchTerm = '';
    this.busStopResults = [];
    this.stopSearchError = '';
    this.selectedBusStop = undefined;
    this.searchedBusStopCode = '';
    this.hasSearchedArrivals = false;
    this.arrivalStickyThreshold = 0;
    this.showStickyArrivalHeader = false;
    this.isLoadingArrivals = false;
    this.arrivalError = '';
    this.liveBusServices = [];
    this.resetLastArrivalsRefreshed();
    this.resetRouteState();
    this.logMatchesFound(0);
  }

  searchArrivals(
    busStopCode = this.searchedBusStopCode,
    onComplete?: () => void,
    options: ArrivalSearchOptions = {}
  ): void {
    const normalizedBusStopCode = busStopCode.trim();
    if (!normalizedBusStopCode) {
      onComplete?.();
      return;
    }

    const isNormalArrivalRequest = options.silentLiveActivityRefresh !== true;
    if (isNormalArrivalRequest && this.normalArrivalSubscription && !this.normalArrivalSubscription.closed) {
      if (this.normalArrivalInFlightStopCode === normalizedBusStopCode) {
        console.info('[Arrivals] duplicate request suppressed', {
          stopCode: normalizedBusStopCode,
          activeRequestId: this.arrivalRequestId,
          correlationId: this.normalArrivalCorrelationId
        });
        onComplete?.();
        return;
      }

      this.cancelNormalArrivalRequest('replaced by different stop', normalizedBusStopCode);
    }

    const requestId = ++this.arrivalRequestId;
    const startedAt = performance.now();
    const correlationId = isNormalArrivalRequest
      ? `arrival-${Date.now()}-${requestId}`
      : '';
    if (isNormalArrivalRequest) {
      this.normalArrivalInFlightStopCode = normalizedBusStopCode;
      this.normalArrivalOnComplete = onComplete;
      this.normalArrivalStartedAt = startedAt;
      this.normalArrivalCorrelationId = correlationId;
      console.info('[Arrivals] request start', {
        stopCode: normalizedBusStopCode,
        requestId,
        correlationId,
        startedAt: new Date().toISOString()
      });
    }
    this.hasSearchedArrivals = true;
    this.isLoadingArrivals = !options.silentLiveActivityRefresh;
    this.arrivalError = '';
    if (!options.preserveScrollPosition) {
      this.liveBusServices = [];
      this.arrivalStickyThreshold = 0;
      this.showStickyArrivalHeader = false;
    }
    if (!options.preserveRouteState) {
      this.resetRouteState();
    }
    this.searchedBusStopCode = normalizedBusStopCode;
    this.resolveSelectedBusStopForCode(normalizedBusStopCode, requestId);

    if (options.silentLiveActivityRefresh) {
      this.liveActivityTrackingService.markDebug('httpRequest', true, `searchArrivals stop ${normalizedBusStopCode}`);
    }

    const arrivalSubscription = this.ltaBusService.getBusArrivals(normalizedBusStopCode, options.silentLiveActivityRefresh
      ? { forceRefresh: true, reason: 'manual', retry: true }
      : {
        forceRefresh: options.forceRefresh,
        reason: options.forceRefresh ? 'deep-link' : undefined,
        retry: options.forceRefresh === true,
        timeoutMs: 35000,
        correlationId
      }
    ).subscribe({
      next: (arrivalLookup) => {
        if (requestId !== this.arrivalRequestId) {
          onComplete?.();
          return;
        }

        if (options.silentLiveActivityRefresh) {
          this.liveActivityTrackingService.markDebug('httpResponse', true, `${arrivalLookup.services.length} services for stop ${arrivalLookup.busStopCode}`);
        }
        this.searchedBusStopCode = arrivalLookup.busStopCode;
        this.resolveSelectedBusStopForCode(arrivalLookup.busStopCode, requestId);
        this.liveBusServices = this.sortLiveServices(arrivalLookup.services);
        if (isNormalArrivalRequest) {
          console.info('[Arrivals] request success', {
            stopCode: normalizedBusStopCode,
            requestId,
            correlationId,
            receivedAt: new Date().toISOString(),
            durationMs: Math.round(performance.now() - startedAt),
            serviceCount: arrivalLookup.services.length
          });
          this.clearNormalArrivalRequest(requestId);
        }
        if (options.confirmLoadedHaptic === true) {
          void this.refreshFeedbackService.lightImpact();
        }
        this.isLoadingArrivals = false;
        this.markArrivalsRefreshed();
        this.syncExpandedServiceAfterRefresh();
        void this.updateLiveActivityTrackingFromArrivals(arrivalLookup);
        this.settleArrivalResults(requestId, options.scrollToArrivals !== false);
        if (!options.silentLiveActivityRefresh) {
          void this.reviewService.requestAutomaticReviewIfEligible();
        }
        onComplete?.();
      },
      error: (error) => {
        if (requestId !== this.arrivalRequestId) {
          onComplete?.();
          return;
        }

        if (options.silentLiveActivityRefresh) {
          this.liveActivityTrackingService.markDebug('httpResponse', false, error instanceof Error ? error.message : String(error));
        }
        this.searchedBusStopCode = normalizedBusStopCode;
        if (isNormalArrivalRequest) {
          console.warn('[Arrivals] request failed', {
            stopCode: normalizedBusStopCode,
            requestId,
            correlationId,
            receivedAt: new Date().toISOString(),
            durationMs: Math.round(performance.now() - startedAt),
            timeout: error?.name === 'TimeoutError',
            error
          });
          this.clearNormalArrivalRequest(requestId);
        }
        this.resolveSelectedBusStopForCode(normalizedBusStopCode, requestId);
        this.arrivalError = this.errorMessage(error);
        this.isLoadingArrivals = false;
        void this.liveActivityTrackingService.clearIfTracking(normalizedBusStopCode);
        this.settleArrivalResults(requestId, options.scrollToArrivals !== false);
        onComplete?.();
      }
    });

    if (isNormalArrivalRequest) {
      this.normalArrivalSubscription = arrivalSubscription;
    }
  }

  async refreshLiveArrivals(event?: CustomEvent<{ complete: () => Promise<void> | void }>): Promise<void> {
    const completeRefresh = () => {
      const completion = event?.detail?.complete?.();

      if (completion && typeof completion.catch === 'function') {
        completion.catch(() => undefined);
      }
    };

    if (this.refreshInProgress || this.isLoadingArrivals || !this.searchedBusStopCode.trim()) {
      completeRefresh();
      return;
    }

    this.refreshInProgress = true;
    const isButtonRefresh = !event;
    const shouldPreserveScroll = isButtonRefresh;
    const savedScrollTop = shouldPreserveScroll ? await this.currentScrollTop() : null;

    this.searchArrivals(
      this.searchedBusStopCode,
      () => {
        if (savedScrollTop !== null) {
          this.restoreScrollPosition(savedScrollTop);
        }

        this.refreshInProgress = false;
        completeRefresh();

        if (!this.arrivalError) {
          this.confirmArrivalsRefreshed();
        }
      },
      {
        preserveRouteState: true,
        preserveScrollPosition: shouldPreserveScroll,
        scrollToArrivals: !shouldPreserveScroll
      }
    );
  }

  private onHomeScroll(): void {
    if (this.isProgrammaticScroll) {
      return;
    }

    if (!this.hasSearchedArrivals || !this.searchedBusStopCode) {
      this.updateStickyArrivalHeader(false);
      return;
    }

    if (!this.arrivalStickyThreshold) {
      return;
    }

    this.updateStickyArrivalHeader((this.homeScrollElement?.scrollTop || 0) > this.arrivalStickyThreshold);
  }

  retryArrivals(): void {
    if (!this.searchedBusStopCode) {
      return;
    }

    this.searchArrivals(this.searchedBusStopCode);
  }

  selectBusStop(stop: BusStop, arrivalOptions: ArrivalSearchOptions = {}): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    this.selectedBusStop = stop;
    this.widgetBridgeService.syncSelectedBusStop({
      BusStopCode: stop.BusStopCode,
      Description: stop.Description,
      RoadName: stop.RoadName,
      Latitude: stop.Latitude,
      Longitude: stop.Longitude
    });
    this.searchTerm = `${stop.Description} (${stop.BusStopCode})`;
    this.busStopResults = [];
    this.rememberBusStop(stop);
    this.searchArrivals(stop.BusStopCode, undefined, {
      confirmLoadedHaptic: true,
      ...arrivalOptions
    });
  }

  private cancelNormalArrivalRequest(reason: string, replacementStopCode?: string): void {
    if (!this.normalArrivalSubscription || this.normalArrivalSubscription.closed) {
      return;
    }

    const requestId = this.arrivalRequestId;
    const stopCode = this.normalArrivalInFlightStopCode;
    const durationMs = this.normalArrivalStartedAt
      ? Math.round(performance.now() - this.normalArrivalStartedAt)
      : 0;
    const completion = this.normalArrivalOnComplete;

    console.info('[Arrivals] request cancelled', {
      stopCode,
      requestId,
      correlationId: this.normalArrivalCorrelationId,
      reason,
      replacementStopCode,
      durationMs
    });
    this.normalArrivalSubscription.unsubscribe();
    this.normalArrivalSubscription = undefined;
    this.normalArrivalInFlightStopCode = '';
    this.normalArrivalOnComplete = undefined;
    this.normalArrivalStartedAt = 0;
    this.normalArrivalCorrelationId = '';
    this.isLoadingArrivals = false;
    completion?.();
  }

  private clearNormalArrivalRequest(requestId: number): void {
    if (requestId !== this.arrivalRequestId) {
      return;
    }

    this.normalArrivalSubscription = undefined;
    this.normalArrivalInFlightStopCode = '';
    this.normalArrivalOnComplete = undefined;
    this.normalArrivalStartedAt = 0;
    this.normalArrivalCorrelationId = '';
  }

  private openBusStopFromDeepLink(busStopCode: string, busStopName: string, source: string): void {
    const knownStop = this.busStopLookup.get(busStopCode)
      || this.recentBusStops.find((stop) => stop.BusStopCode === busStopCode);
    const favouriteStop = this.favouriteBusStops.find((stop) => stop.BusStopCode === busStopCode);
    const resolvedStop: BusStop = knownStop || (favouriteStop ? {
      BusStopCode: favouriteStop.BusStopCode,
      Description: favouriteStop.Description,
      RoadName: favouriteStop.RoadName,
      Latitude: favouriteStop.Latitude || 0,
      Longitude: favouriteStop.Longitude || 0
    } : {
      BusStopCode: busStopCode,
      Description: busStopName || `Bus stop ${busStopCode}`,
      RoadName: '',
      Latitude: 0,
      Longitude: 0
    });
    const stop: BusStop = busStopName
      ? { ...resolvedStop, Description: busStopName }
      : resolvedStop;

    if (source === 'live-activity') {
      this.liveBusServices = [];
      this.resetRouteState();
    }

    if (this.searchedBusStopCode.trim() === busStopCode) {
      this.selectedBusStop = stop;
      this.searchTerm = `${stop.Description} (${busStopCode})`;
      this.busStopResults = [];
      this.searchArrivals(busStopCode, () => {
        if (!this.arrivalError) {
          this.confirmArrivalsRefreshed();
        }
      }, {
        forceRefresh: true,
        preserveRouteState: true,
        preserveScrollPosition: true,
        scrollToArrivals: false
      });
      return;
    }

    this.selectBusStop(stop, {
      forceRefresh: true
    });
  }

  private confirmArrivalsRefreshed(): void {
    void this.refreshFeedbackService.success('Bus arrivals refreshed');
  }

  trackBusStop(index: number, stop: BusStop): string {
    return stop.BusStopCode;
  }

  trackLiveService(index: number, service: BusServiceArrival): string {
    return service.serviceNo;
  }

  isBusServicePinned(serviceNo: string): boolean {
    return this.pinnedServicesForCurrentStop().includes(serviceNo);
  }

  async togglePinnedBusService(service: BusServiceArrival, event?: Event): Promise<void> {
    event?.stopPropagation();
    const busStopCode = this.searchedBusStopCode.trim();

    if (!busStopCode) {
      return;
    }

    if (!this.hasSeenTip(this.pinInfoSeenStorageKey)) {
      this.pendingPinnedService = service;
      this.isPinOnboardingPopupOpen = true;
      void this.refreshFeedbackService.lightImpact();
      return;
    }

    const serviceNo = service.serviceNo;
    const currentPins = this.pinnedBusServices[busStopCode] || [];
    const isPinned = currentPins.includes(serviceNo);

    this.pinnedBusServices = {
      ...this.pinnedBusServices,
      [busStopCode]: isPinned
        ? currentPins.filter((pinnedServiceNo) => pinnedServiceNo !== serviceNo)
        : [serviceNo, ...currentPins]
    };

    if (!this.pinnedBusServices[busStopCode].length) {
      delete this.pinnedBusServices[busStopCode];
    }

    this.savePinnedBusServices();
    this.markPinnedBusStopUpdated(busStopCode);
    this.liveBusServices = this.sortLiveServices(this.liveBusServices);
    await this.refreshFeedbackService.info(isPinned ? `Bus ${serviceNo} unpinned` : `Bus ${serviceNo} pinned`);
    this.widgetBridgeService.syncWidgetData();
  }

  isTrackingLiveActivity(service: BusServiceArrival): boolean {
    return this.liveActivityTrackingService.isTracking(this.searchedBusStopCode.trim(), service.serviceNo);
  }

  async toggleBusLiveActivityTracking(service: BusServiceArrival, event?: Event): Promise<void> {
    event?.stopPropagation();

    if (this.isTrackingLiveActivity(service)) {
      await this.liveActivityTrackingService.endTracking(this.searchedBusStopCode.trim(), service.serviceNo);
      await this.refreshFeedbackService.info('Stopped tracking');
      return;
    }

    if (!this.hasSeenTip(this.liveActivityInfoSeenStorageKey)) {
      this.pendingLiveActivityService = service;
      this.isLiveActivityInfoPopupOpen = true;
      void this.refreshFeedbackService.lightImpact();
      return;
    }

    await this.startLiveActivityTracking(service);
  }

  async stopLiveActivityTracking(showToast = true, event?: Event): Promise<void> {
    event?.stopPropagation();
    await this.liveActivityTrackingService.end(true);

    if (showToast) {
      await this.refreshFeedbackService.info('Stopped tracking');
    }
  }

  openPinInfoPopup(event?: Event): void {
    event?.stopPropagation();
    this.isPinInfoPopupOpen = true;
    void this.refreshFeedbackService.lightImpact();
  }

  handlePinInfoPopupTap(event: Event): void {
    event.stopPropagation();
    void this.refreshFeedbackService.lightImpact();
  }

  closePinInfoPopup(): void {
    this.isPinInfoPopupOpen = false;
  }

  acknowledgePinOnboarding(): void {
    this.isPinOnboardingPopupOpen = false;
    localStorage.setItem(this.pinInfoSeenStorageKey, 'true');

    const pendingService = this.pendingPinnedService;
    this.pendingPinnedService = undefined;

    if (pendingService) {
      void this.togglePinnedBusService(pendingService);
    }
  }

  handleLiveActivityInfoPopupTap(event: Event): void {
    event.stopPropagation();
    void this.refreshFeedbackService.lightImpact();
  }

  acknowledgeLiveActivityOnboarding(): void {
    this.isLiveActivityInfoPopupOpen = false;
    localStorage.setItem(this.liveActivityInfoSeenStorageKey, 'true');

    const pendingService = this.pendingLiveActivityService;
    this.pendingLiveActivityService = undefined;

    if (pendingService) {
      void this.startLiveActivityTracking(pendingService);
    }
  }

  private hasSeenTip(storageKey: string): boolean {
    return localStorage.getItem(storageKey) === 'true';
  }

  trackFavouriteBusStop(index: number, stop: FavouriteBusStop): string {
    return stop.BusStopCode;
  }

  trackRouteStop(index: number, stop: RouteProgressStop): string {
    return `${stop.code}-${index}`;
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

    const favouriteStop = {
      ...currentStop,
      dateAdded: Date.now()
    };

    this.favouriteBusStops = [
      favouriteStop,
      ...this.favouriteBusStops.filter((stop) => stop.BusStopCode !== currentStop.BusStopCode)
    ];

    if (this.favouriteSortMode === 'name') {
      this.favouriteBusStops = [...this.favouriteBusStops].sort((a, b) =>
        this.favouriteDisplayName(a).localeCompare(this.favouriteDisplayName(b), undefined, { sensitivity: 'base' })
      );
    } else if (this.favouriteSortMode === 'dateAdded') {
      this.favouriteBusStops = [...this.favouriteBusStops].sort((a, b) =>
        this.favouriteDateAddedValue(b) - this.favouriteDateAddedValue(a)
      );
    }

    this.saveFavouriteBusStops();
    this.markFavouriteAnimation(currentStop.BusStopCode, 'saved');
    void this.refreshFeedbackService.favouriteSaved();
    void this.reviewService.requestAutomaticReviewIfEligible();
  }

  viewFavouriteStop(stop: FavouriteBusStop): void {
    this.selectBusStop({
      BusStopCode: stop.BusStopCode,
      Description: stop.Description,
      RoadName: stop.RoadName,
      Latitude: 0,
      Longitude: 0
    });
  }

  removeFavouriteStop(busStopCode: string): void {
    if (this.recentlyAnimatedFavouriteCode === busStopCode && this.recentFavouriteAction === 'removed') {
      return;
    }

    if (!this.favouriteBusStops.some((stop) => stop.BusStopCode === busStopCode)) {
      return;
    }

    this.markFavouriteAnimation(busStopCode, 'removed');
    void this.refreshFeedbackService.lightImpact();

    setTimeout(() => {
      this.favouriteBusStops = this.favouriteBusStops.filter((stop) => stop.BusStopCode !== busStopCode);
      this.saveFavouriteBusStops();

      if (this.recentlyAnimatedFavouriteCode === busStopCode) {
        this.clearFavouriteAnimationTimer();
      }
    }, 260);
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

  @HostListener('document:click')
  closeFavouriteSortPopoverFromOutside(): void {
    this.closeFavouriteSortPopover();
  }

  openFavouriteSortPopover(event: Event): void {
    event.stopPropagation();
    this.favouriteSortMessage = '';
    this.isFavouriteSortPopoverOpen = !this.isFavouriteSortPopoverOpen;
    void this.refreshFeedbackService.lightImpact();
  }

  closeFavouriteSortPopover(): void {
    this.isFavouriteSortPopoverOpen = false;
  }

  async selectFavouriteSort(mode: FavouriteSortMode, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.favouriteSortMode = mode;
    this.favouriteSortMessage = '';

    const sorted = await this.applyFavouriteSort({ persist: true });

    if (sorted) {
      void this.refreshFeedbackService.lightImpact();
      this.closeFavouriteSortPopover();
    }
  }

  private async applyFavouriteSort(options: { persist: boolean; silentDistanceFailure?: boolean }): Promise<boolean> {
    if (!this.favouriteBusStops.length) {
      return true;
    }

    if (this.favouriteSortMode === 'distance') {
      return this.sortFavouriteStopsByDistance(options);
    }

    if (this.favouriteSortMode === 'name') {
      this.favouriteBusStops = [...this.favouriteBusStops].sort((a, b) =>
        this.favouriteDisplayName(a).localeCompare(this.favouriteDisplayName(b), undefined, { sensitivity: 'base' })
      );
    } else {
      this.favouriteBusStops = [...this.favouriteBusStops].sort((a, b) =>
        this.favouriteDateAddedValue(b) - this.favouriteDateAddedValue(a)
      );
    }

    if (options.persist) {
      this.saveFavouriteSortMode();
      this.saveFavouriteBusStops();
    }

    return true;
  }

  private async sortFavouriteStopsByDistance(options: { persist: boolean; silentDistanceFailure?: boolean }): Promise<boolean> {
    try {
      const location = await this.locationService.currentLocation({
        enableHighAccuracy: false,
        timeout: 8000
      });
      const { latitude, longitude } = location;

      this.favouriteBusStops = [...this.favouriteBusStops].sort((a, b) =>
        this.distanceToFavouriteStop(a, latitude, longitude) - this.distanceToFavouriteStop(b, latitude, longitude)
      );

      if (options.persist) {
        this.saveFavouriteSortMode();
        this.saveFavouriteBusStops();
      }

      return true;
    } catch {
      if (!options.silentDistanceFailure) {
        this.favouriteSortMessage = 'Distance sorting needs location access. Your current order was kept.';
      }

      return false;
    }
  }

  private favouriteDisplayName(stop: FavouriteBusStop): string {
    return (stop.nickname || stop.Description || '').trim();
  }

  formatBusStopName(stop: { Description?: string; RoadName?: string } | null | undefined, displayName?: string): string {
    return formatBusStopDisplayName(stop, displayName);
  }

  private favouriteDateAddedValue(stop: FavouriteBusStop): number {
    return typeof stop.dateAdded === 'number' ? stop.dateAdded : 0;
  }

  private distanceToFavouriteStop(stop: FavouriteBusStop, latitude: number, longitude: number): number {
    if (typeof stop.Latitude !== 'number' || typeof stop.Longitude !== 'number' || (!stop.Latitude && !stop.Longitude)) {
      return Number.POSITIVE_INFINITY;
    }

    return this.distanceInMeters(latitude, longitude, stop.Latitude, stop.Longitude);
  }

  private distanceInMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number): number {
    const earthRadius = 6371000;
    const latitudeDelta = this.degreesToRadians(toLatitude - fromLatitude);
    const longitudeDelta = this.degreesToRadians(toLongitude - fromLongitude);
    const fromRadians = this.degreesToRadians(fromLatitude);
    const toRadians = this.degreesToRadians(toLatitude);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(fromRadians) * Math.cos(toRadians) * Math.sin(longitudeDelta / 2) ** 2;

    return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private degreesToRadians(value: number): number {
    return value * Math.PI / 180;
  }

  toggleLiveService(service: BusServiceArrival): void {
    void this.refreshFeedbackService.lightImpact();
    this.expandedLiveServiceNo = this.expandedLiveServiceNo === service.serviceNo ? '' : service.serviceNo;
    this.deferRoutePrefetchAfterCardAnimation();
  }

  openRouteModal(service: BusServiceArrival): void {
    this.selectedRouteService = service;
    this.selectedRouteServiceNo = service.serviceNo;
    this.isRouteModalOpen = true;
    this.loadRouteProgression(service.serviceNo);
    this.scheduleRouteModalScroll();
    this.scheduleRouteReadyHaptic(service.serviceNo);
  }

  closeRouteModal(): void {
    this.isRouteModalOpen = false;
    this.clearRouteModalScrollTimer();
  }

  routeModalDismissed(): void {
    this.isRouteModalOpen = false;
    this.clearRouteModalScrollTimer();
  }

  selectRouteStop(stop: RouteProgressStop): void {
    const busStop = this.busStopLookup.get(stop.code) || {
      BusStopCode: stop.code,
      Description: stop.name || `Bus Stop ${stop.code}`,
      RoadName: stop.roadName || 'Road unavailable',
      Latitude: 0,
      Longitude: 0
    };

    this.closeRouteModal();
    this.selectBusStop(busStop);
  }

  destinationLabel(service: BusServiceArrival): string {
    const code = this.destinationCode(service);

    return code
      ? `${this.destinationName(service)} · ${code}`
      : 'Destination unavailable';
  }

  destinationName(service: BusServiceArrival): string {
    const code = this.destinationCode(service);

    if (!code) {
      return 'Destination unavailable';
    }

    const stop = this.busStopLookup.get(code);

    return stop ? this.formatBusStopName(stop) : this.formatBusStopName({ Description: `Stop ${code}`, RoadName: '' });
  }

  destinationCode(service: BusServiceArrival): string {
    return service.nextBus.destinationCode || '';
  }

  serviceOriginName(service: BusServiceArrival): string {
    const code = this.serviceOriginCode(service);

    if (!code) {
      return 'Origin unavailable';
    }

    const stop = this.busStopLookup.get(code);

    return stop ? this.formatBusStopName(stop) : this.formatBusStopName({ Description: `Bus stop ${code}`, RoadName: '' });
  }

  serviceOriginCode(service: BusServiceArrival): string {
    return service.nextBus.originCode || '';
  }

  stopName(code: string | null): string {
    if (!code) {
      return 'Bus stop unavailable';
    }

    const stop = this.busStopLookup.get(code);

    return stop ? this.formatBusStopName(stop) : this.formatBusStopName({ Description: `Bus Stop ${code}`, RoadName: '' });
  }

  arrivalStopTitle(): string {
    if (!this.hasSearchedArrivals) {
      return 'Ready when you are';
    }

    const busStopCode = this.searchedBusStopCode.trim();
    const stop = this.arrivalDisplayStop();

    return stop?.Description || (busStopCode ? `Bus stop ${busStopCode}` : 'Bus stop');
  }

  arrivalStopSubtitle(): string {
    if (!this.hasSearchedArrivals) {
      return '';
    }

    const busStopCode = this.arrivalDisplayStop()?.BusStopCode || this.searchedBusStopCode.trim();

    return busStopCode ? `Bus stop ${busStopCode}` : '';
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

  loadTone(load: string): string {
    switch (load) {
      case 'Seats available':
        return 'seats';
      case 'Few seats left':
        return 'standing';
      case 'No chance of a seat':
        return 'crowded';
      default:
        return 'unknown';
    }
  }

  loadCompactLabel(load: string): string {
    switch (load) {
      case 'No chance of a seat':
        return 'No Seats';
      default:
        return load;
    }
  }

  busTypeTone(type: string): string {
    switch (type) {
      case 'Double deck':
        return 'double-deck';
      case 'Bendy bus':
        return 'bendy-bus';
      case 'Single deck':
        return 'single-deck';
      default:
        return 'bus-type-unknown';
    }
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

      if (this.isRouteModalOpen && this.selectedRouteServiceNo === serviceNo) {
        this.scheduleRouteModalScroll();
        this.scheduleRouteReadyHaptic(serviceNo);
      }
    }
  }

  private scheduleRouteReadyHaptic(serviceNo: string): void {
    const progression = this.routeProgressions[serviceNo];
    const hapticKey = this.routeReadyHapticKey(serviceNo);

    if (
      !hapticKey
      || !progression?.stops.length
      || this.routeProgressLoading[serviceNo]
      || this.routeProgressErrors[serviceNo]
      || this.routeReadyHapticKeys.has(hapticKey)
    ) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const readyProgression = this.routeProgressions[serviceNo];
        const isReadyToDisplay =
          this.isRouteModalOpen
          && this.selectedRouteServiceNo === serviceNo
          && !this.routeProgressLoading[serviceNo]
          && !this.routeProgressErrors[serviceNo]
          && !!readyProgression?.stops.length;

        if (!isReadyToDisplay || this.routeReadyHapticKeys.has(hapticKey)) {
          return;
        }

        this.routeReadyHapticKeys.add(hapticKey);
        void this.routeReadyLightHaptic();
      });
    });
  }

  private routeReadyHapticKey(serviceNo: string): string {
    const busStopCode = this.searchedBusStopCode.trim();

    return busStopCode && serviceNo ? `${busStopCode}:${serviceNo}` : '';
  }

  private async routeReadyLightHaptic(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Route haptics are a nice-to-have; route display should never depend on them.
    }
  }

  private scheduleRouteModalScroll(): void {
    if (!this.isRouteModalOpen) {
      return;
    }

    this.clearRouteModalScrollTimer();
    this.routeModalScrollTimer = setTimeout(() => this.scrollRouteModalToCurrentStop(), 160);
  }

  private scrollRouteModalToCurrentStop(): void {
    const rows = this.routeStopRows?.toArray() || [];
    const targetRow = rows.find((row) => row.nativeElement.dataset['routeStatus'] === 'current')
      || rows.find((row) => row.nativeElement.dataset['routeStatus'] === 'next')
      || rows.find((row) => row.nativeElement.dataset['routeStatus'] === 'terminal');

    if (!targetRow) {
      return;
    }

    const rowElement = targetRow.nativeElement;
    const scrollContainer = rowElement.closest('.route-sheet__body') as HTMLElement | null;

    if (!scrollContainer) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const rowRect = rowElement.getBoundingClientRect();
    const targetTop = scrollContainer.scrollTop + rowRect.top - containerRect.top - (scrollContainer.clientHeight * 0.28);

    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });
  }

  private clearRouteModalScrollTimer(): void {
    if (this.routeModalScrollTimer) {
      clearTimeout(this.routeModalScrollTimer);
      this.routeModalScrollTimer = undefined;
    }
  }

  private prefetchRouteProgressions(services: BusServiceArrival[]): void {
    this.routePrefetchServiceNos = services.slice(0, 3).map((service) => service.serviceNo);
    this.scheduleRoutePrefetch(1600);
  }

  private deferRoutePrefetchAfterCardAnimation(): void {
    if (!this.routePrefetchTimer || !this.routePrefetchServiceNos.length) {
      return;
    }

    this.scheduleRoutePrefetch(420);
  }

  private scheduleRoutePrefetch(delay: number): void {
    if (this.routePrefetchTimer) {
      clearTimeout(this.routePrefetchTimer);
    }

    const runId = ++this.routePrefetchRunId;
    this.routePrefetchTimer = setTimeout(() => {
      const visibleServiceNos = this.routePrefetchServiceNos;
      const serviceNos = this.expandedLiveServiceNo
        ? [this.expandedLiveServiceNo, ...visibleServiceNos.filter((serviceNo) => serviceNo !== this.expandedLiveServiceNo)]
        : visibleServiceNos;

      this.prefetchRouteProgressionQueue(serviceNos, 0, runId);
    }, delay);
  }

  private prefetchRouteProgressionQueue(serviceNos: string[], index: number, runId: number): void {
    if (runId !== this.routePrefetchRunId) {
      return;
    }

    const serviceNo = serviceNos[index];

    if (!serviceNo) {
      this.routePrefetchTimer = undefined;
      return;
    }

    this.loadRouteProgression(serviceNo).finally(() => {
      if (runId !== this.routePrefetchRunId) {
        return;
      }

      this.routePrefetchTimer = setTimeout(() => {
        this.prefetchRouteProgressionQueue(serviceNos, index + 1, runId);
      }, 180);
    });
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
      currentStopIndex,
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

  private arrivalDisplayStop(): BusStop | undefined {
    const busStopCode = this.searchedBusStopCode.trim();

    if (this.selectedBusStop?.BusStopCode === busStopCode) {
      return this.selectedBusStop;
    }

    return this.busStopLookup.get(busStopCode)
      || this.recentBusStops.find((stop) => stop.BusStopCode === busStopCode);
  }

  private resolveSelectedBusStopForCode(busStopCode: string, requestId = this.arrivalRequestId): void {
    if (!busStopCode) {
      return;
    }

    const knownStop = this.busStopLookup.get(busStopCode)
      || this.recentBusStops.find((stop) => stop.BusStopCode === busStopCode);

    if (knownStop) {
      this.selectedBusStop = knownStop;
      return;
    }

    this.ensureBusStopsLoaded()
      .then(() => {
        if (requestId !== this.arrivalRequestId || this.searchedBusStopCode.trim() !== busStopCode) {
          return;
        }

        const loadedStop = this.busStopLookup.get(busStopCode);

        if (loadedStop) {
          this.selectedBusStop = loadedStop;
        }
      })
      .catch(() => undefined);
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
      RoadName: knownStop?.RoadName || 'Road unavailable',
      Latitude: knownStop?.Latitude,
      Longitude: knownStop?.Longitude
    };
  }

  private resetRouteState(): void {
    if (this.routePrefetchTimer) {
      clearTimeout(this.routePrefetchTimer);
      this.routePrefetchTimer = undefined;
    }
    this.routePrefetchRunId++;

    this.clearRouteModalScrollTimer();

    this.expandedLiveServiceNo = '';
    this.routeProgressions = {};
    this.routeProgressLoading = {};
    this.routeProgressErrors = {};
    this.routeReadyHapticKeys.clear();
    this.routePrefetchServiceNos = [];
    this.isRouteModalOpen = false;
    this.selectedRouteServiceNo = '';
    this.selectedRouteService = undefined;
  }

  private rankBusStops(query: string, stops = this.busStops): BusStop[] {
    return rankBusStopSearchResults(stops, query);
  }

  private sortLiveServices(services: BusServiceArrival[]): BusServiceArrival[] {
    const pinnedServices = this.pinnedServicesForCurrentStop();

    return [...services].sort((a, b) => {
      const pinnedA = pinnedServices.indexOf(a.serviceNo);
      const pinnedB = pinnedServices.indexOf(b.serviceNo);

      if (pinnedA !== -1 || pinnedB !== -1) {
        if (pinnedA === -1) {
          return 1;
        }

        if (pinnedB === -1) {
          return -1;
        }

        return pinnedA - pinnedB;
      }

      return this.arrivalSortValue(a) - this.arrivalSortValue(b);
    });
  }

  private arrivalSortValue(service: BusServiceArrival): number {
    return service.nextBus.minutesAway === null ? Number.MAX_SAFE_INTEGER : service.nextBus.minutesAway;
  }

  private pinnedServicesForCurrentStop(): string[] {
    const busStopCode = this.searchedBusStopCode.trim();

    if (!busStopCode) {
      return [];
    }

    return this.pinnedBusServices[busStopCode] || [];
  }

  private isBusStopCode(value: string): boolean {
    return /^\d{5}$/.test(value);
  }

  private currentHeroTimeOfDay(): HeroTimeOfDay {
    const hour = new Date().getHours();

    if (hour < 5) {
      return {
        icon: 'sparkles-outline',
        label: 'late night ride'
      };
    }

    if (hour < 12) {
      return {
        icon: 'partly-sunny-outline',
        label: 'morning commute'
      };
    }

    if (hour < 17) {
      return {
        icon: 'sunny-outline',
        label: 'afternoon travels'
      };
    }

    if (hour < 22) {
      return {
        icon: 'moon-outline',
        label: 'evening ride'
      };
    }

    return {
      icon: 'sparkles-outline',
      label: 'late night ride'
    };
  }

  private startHeroClock(): void {
    this.updateHeroClock();
  }

  private updateHeroClock(): void {
    if (this.heroClockTimer) {
      clearTimeout(this.heroClockTimer);
    }

    this.currentLocalTimeLabel = this.formatCurrentLocalTime();

    const now = new Date();
    const msUntilNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    this.heroClockTimer = setTimeout(() => this.updateHeroClock(), msUntilNextMinute);
  }

  private formatCurrentLocalTime(): string {
    return new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  private logSearchQuery(query: string): void {
    console.log(`Current search query: ${query}`);
  }

  private logMatchesFound(count: number): void {
    console.log(`Matches found: ${count}`);
  }

  private async attachHomeScrollListener(): Promise<void> {
    try {
      const scrollElement = await this.content?.getScrollElement();

      if (!scrollElement) {
        return;
      }

      this.homeScrollElement = scrollElement;
      this.ngZone.runOutsideAngular(() => {
        scrollElement.addEventListener('scroll', this.homeScrollListener, { passive: true });
      });
    } catch {
      // Ionic will still handle scrolling normally if the optional sticky listener cannot attach.
    }
  }

  private detachHomeScrollListener(): void {
    this.homeScrollElement?.removeEventListener('scroll', this.homeScrollListener);
    this.homeScrollElement = undefined;
  }

  private updateStickyArrivalHeader(visible: boolean): void {
    if (this.showStickyArrivalHeader === visible) {
      return;
    }

    this.ngZone.run(() => {
      this.showStickyArrivalHeader = visible;
    });
  }

  private settleArrivalResults(requestId: number, shouldScroll: boolean): void {
    this.isSettlingArrivals = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (requestId !== this.arrivalRequestId) {
          this.isSettlingArrivals = false;
          return;
        }

        const sectionTop = this.arrivalsSection?.nativeElement.offsetTop || 0;
        this.arrivalStickyThreshold = sectionTop + 70;

        if (shouldScroll) {
          this.isProgrammaticScroll = true;
          this.showStickyArrivalHeader = false;
          try {
            await this.ngZone.runOutsideAngular(() =>
              this.content?.scrollToPoint(
                0,
                Math.max(sectionTop - 18, 0),
                Capacitor.isNativePlatform() ? 320 : 460
              )
            );
          } finally {
            this.isProgrammaticScroll = false;
          }
        }

        if (requestId !== this.arrivalRequestId) {
          this.isSettlingArrivals = false;
          return;
        }

        this.isSettlingArrivals = false;
        this.prefetchRouteProgressions(this.liveBusServices);
      });
    });
  }

  private async currentScrollTop(): Promise<number> {
    try {
      const scrollElement = await this.content?.getScrollElement();
      return scrollElement?.scrollTop || 0;
    } catch {
      return 0;
    }
  }

  private async scrollActiveTabToTop(): Promise<void> {
    this.isProgrammaticScroll = true;
    this.showStickyArrivalHeader = false;
    this.deferRoutePrefetchAfterCardAnimation();

    try {
      await this.sameTabScrollService.toTop(this.content);
      this.resetHomeHorizontalScrollSections();
    } finally {
      this.isProgrammaticScroll = false;
    }
  }

  private resetHomeHorizontalScrollSections(): void {
    window.requestAnimationFrame(() => {
      this.resetHorizontalScroller('recent', this.recentStopsScroller?.nativeElement);
      this.resetHorizontalScroller('favourite', this.favouriteStopsScroller?.nativeElement);
    });
  }

  private resetHorizontalScroller(name: 'recent' | 'favourite', scroller?: HTMLElement): void {
    console.log(`Home carousel reset: found ${name} scroller?`, !!scroller);

    if (!scroller) {
      return;
    }

    console.log(`Home carousel reset: ${name} scrollLeft before`, scroller.scrollLeft);

    if (scroller.scrollLeft > 1) {
      scroller.scrollTo({
        left: 0,
        behavior: 'smooth'
      });
    }

    window.setTimeout(() => {
      console.log(`Home carousel reset: ${name} scrollLeft after`, scroller.scrollLeft);
    }, 280);
  }

  private restoreScrollPosition(scrollTop: number): void {
    setTimeout(() => {
      this.content?.scrollToPoint(0, scrollTop, 0);
    }, 90);
  }

  private markArrivalsRefreshed(refreshedAt = Date.now()): void {
    this.lastArrivalsRefreshedAt = refreshedAt;
    this.updateLastArrivalsRefreshedLabel();

    if (!this.lastArrivalsRefreshedTimer) {
      this.lastArrivalsRefreshedTimer = setInterval(() => this.updateLastArrivalsRefreshedLabel(), 5000);
    }
  }

  private updateLastArrivalsRefreshedLabel(): void {
    if (!this.lastArrivalsRefreshedAt) {
      this.lastArrivalsRefreshedLabel = '';
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.lastArrivalsRefreshedAt) / 1000));

    if (elapsedSeconds < 10) {
      this.lastArrivalsRefreshedLabel = 'Updated just now';
      return;
    }

    if (elapsedSeconds < 60) {
      this.lastArrivalsRefreshedLabel = `Updated ${elapsedSeconds}s ago`;
      return;
    }

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    this.lastArrivalsRefreshedLabel = elapsedMinutes === 1
      ? 'Updated 1 min ago'
      : `Updated ${elapsedMinutes} min ago`;
  }

  private resetLastArrivalsRefreshed(): void {
    this.lastArrivalsRefreshedAt = 0;
    this.lastArrivalsRefreshedLabel = '';
    this.clearLastArrivalsRefreshedTimer();
  }

  private clearLastArrivalsRefreshedTimer(): void {
    if (this.lastArrivalsRefreshedTimer) {
      clearInterval(this.lastArrivalsRefreshedTimer);
      this.lastArrivalsRefreshedTimer = undefined;
    }
  }

  private markFavouriteAnimation(busStopCode: string, action: 'saved' | 'removed'): void {
    this.clearFavouriteAnimationTimer();
    this.recentlyAnimatedFavouriteCode = busStopCode;
    this.recentFavouriteAction = action;

    this.favouriteAnimationTimer = setTimeout(() => {
      this.clearFavouriteAnimationTimer();
    }, action === 'saved' ? 460 : 260);
  }

  private clearFavouriteAnimationTimer(): void {
    if (this.favouriteAnimationTimer) {
      clearTimeout(this.favouriteAnimationTimer);
      this.favouriteAnimationTimer = undefined;
    }

    this.recentlyAnimatedFavouriteCode = '';
    this.recentFavouriteAction = '';
  }

  private syncExpandedServiceAfterRefresh(): void {
    if (!this.expandedLiveServiceNo) {
      return;
    }

    const expandedServiceStillExists = this.liveBusServices.some((service) => service.serviceNo === this.expandedLiveServiceNo);

    if (!expandedServiceStillExists) {
      this.expandedLiveServiceNo = '';
    }
  }

  private async startLiveActivityTracking(service: BusServiceArrival): Promise<void> {
    const payload = this.buildLiveActivityPayload(service);

    if (!payload) {
      await this.refreshFeedbackService.info('Live Activities are unavailable here');
      return;
    }

    try {
      const started = await this.liveActivityTrackingService.start(payload);

      if (!started) {
        await this.refreshFeedbackService.info('Live Activities are unavailable here');
        return;
      }

      await this.refreshFeedbackService.info(`Tracking bus ${payload.serviceNo}`);
    } catch (error) {
      console.warn('[LiveTrack] Live Activity start failed', error);
      const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
      await this.refreshFeedbackService.info(
        message.includes('disabled')
          ? 'Enable Live Activities in Settings'
          : message.includes('push-enabled')
            ? 'Live Activity push setup is unavailable on this device'
            : 'Live Activity is unavailable'
      );
    }
  }

  private async updateLiveActivityTrackingFromArrivals(arrivalLookup: BusArrivalLookup): Promise<void> {
    const tracked = this.liveActivityTrackingService.currentState;

    if (!tracked.active) {
      return;
    }

    if (Date.now() >= tracked.expiresAt) {
      await this.liveActivityTrackingService.end(true);
      return;
    }

    if (tracked.busStopCode !== this.searchedBusStopCode.trim()) {
      return;
    }

    await this.liveActivityTrackingService.refreshTrackedBusAndUpdateLiveActivity('manual', arrivalLookup);
  }

  liveTrackDebugTime(timestamp: number): string {
    if (!timestamp) {
      return '--';
    }

    return new Date(timestamp).toLocaleTimeString('en-SG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  private buildLiveActivityPayload(
    service: BusServiceArrival,
    tracked = this.liveActivityTrackingService.currentState,
    options: {
      busStopCode?: string;
      busStopName?: string;
      lastUpdatedAt?: number;
    } = {}
  ): BusLiveActivityPayload | null {
    const busStopCode = (options.busStopCode || this.searchedBusStopCode).trim();

    if (!busStopCode || !this.hasValidLiveActivityArrival(service)) {
      return null;
    }

    const now = Date.now();
    const startedAt = tracked.active ? tracked.startedAt : now;
    const expiresAt = Math.min(startedAt + this.liveActivityTimeoutMs, now + this.liveActivityTimeoutMs);
    const arrivalAt = new Date(service.nextBus.estimatedArrival || '').getTime();

    return {
      serviceNo: service.serviceNo,
      busStopName: options.busStopName || this.arrivalStopTitle(),
      busStopCode,
      arrivalStatus: service.nextBus.timing,
      nextArrivalTiming: service.subsequentBus.timing,
      thirdArrivalTiming: service.thirdBus.timing,
      arrivalVisitNumber: service.nextBus.visitNumber,
      nextArrivalVisitNumber: service.subsequentBus.visitNumber,
      thirdArrivalVisitNumber: service.thirdBus.visitNumber,
      busType: service.nextBus.type,
      wheelchairAccessible: service.nextBus.wheelchairAccessible,
      seatAvailability: service.nextBus.load,
      arrivalAt,
      lastUpdatedAt: options.lastUpdatedAt || now,
      startedAt,
      expiresAt
    };
  }

  private hasValidLiveActivityArrival(service: BusServiceArrival): boolean {
    return service.nextBus.minutesAway !== null
      && !!service.nextBus.estimatedArrival
      && Number.isFinite(new Date(service.nextBus.estimatedArrival).getTime())
      && service.nextBus.timing !== 'No Bus';
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

  private loadPinnedBusServices(): PinnedBusServicesByStop {
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

  private savePinnedBusServices(): void {
    localStorage.setItem(this.pinnedBusServicesStorageKey, JSON.stringify(this.pinnedBusServices));
  }

  private markPinnedBusStopUpdated(busStopCode: string): void {
    const storedUpdatedAt = localStorage.getItem(this.pinnedBusServicesUpdatedAtStorageKey);
    let updatedAtByStop: Record<string, number> = {};

    if (storedUpdatedAt) {
      try {
        const parsedUpdatedAt = JSON.parse(storedUpdatedAt) as Record<string, number>;

        if (parsedUpdatedAt && typeof parsedUpdatedAt === 'object' && !Array.isArray(parsedUpdatedAt)) {
          updatedAtByStop = parsedUpdatedAt;
        }
      } catch {
        updatedAtByStop = {};
      }
    }

    if (this.pinnedBusServices[busStopCode]?.length) {
      updatedAtByStop[busStopCode] = Date.now();
    } else {
      delete updatedAtByStop[busStopCode];
    }

    localStorage.setItem(this.pinnedBusServicesUpdatedAtStorageKey, JSON.stringify(updatedAtByStop));
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

      const fallbackTime = Date.now();
      const validStops = parsedStops.filter((stop) => stop?.BusStopCode && stop.Description && stop.RoadName);

      return validStops.map((stop, index) => ({
        ...stop,
        dateAdded: typeof stop.dateAdded === 'number'
          ? stop.dateAdded
          : fallbackTime - index
      }));
    } catch {
      return [];
    }
  }

  private saveFavouriteBusStops(): void {
    localStorage.setItem(this.favouritesStorageKey, JSON.stringify(this.favouriteBusStops));
    this.syncWidgetFavouriteStop();
  }

  private loadFavouriteSortMode(): FavouriteSortMode {
    const storedMode = localStorage.getItem(this.favouriteSortStorageKey);

    return storedMode === 'name' || storedMode === 'distance' || storedMode === 'dateAdded'
      ? storedMode
      : 'dateAdded';
  }

  private saveFavouriteSortMode(): void {
    localStorage.setItem(this.favouriteSortStorageKey, this.favouriteSortMode);
  }

  private syncWidgetFavouriteStop(): void {
    this.widgetBridgeService.syncWidgetData();
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.startsWith('Please enter')) {
      return error.message;
    }

    return 'The live bus feed is taking a quiet pause. Try this bus stop code again in a moment.';
  }
}
