import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { BusServiceArrival, LtaBusService } from '../services/lta-bus.service';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';

interface NearbyBus {
  service: string;
  destination: string;
  stop: string;
  arrival: string;
  nextArrival: string;
  occupancy: string;
  deck: string;
  load: 'light' | 'steady' | 'cozy';
  arriving?: boolean;
}

interface SavedRoute {
  label: string;
  route: string;
  note: string;
  icon: string;
  tone: 'sage' | 'sun' | 'clay';
}

interface NavItem {
  label: string;
  icon: string;
  active?: boolean;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page implements OnInit {
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild('arrivalsSection') private readonly arrivalsSection?: ElementRef<HTMLElement>;

  readonly greeting = 'good morning';
  searchTerm = '';
  searchedBusStopCode = '';
  liveBusServices: BusServiceArrival[] = [];
  busStopResults: BusStop[] = [];
  recentBusStops: BusStop[] = [];
  selectedBusStop?: BusStop;
  isLoadingArrivals = false;
  isLoadingBusStops = false;
  hasSearchedArrivals = false;
  arrivalError = '';
  stopSearchError = '';
  private busStops: BusStop[] = [];
  private busStopsLoadPromise?: Promise<BusStop[]>;
  private searchTimer?: ReturnType<typeof setTimeout>;

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

  readonly nearbyBuses: NearbyBus[] = [
    {
      service: '156',
      destination: 'Clementi Interchange',
      stop: 'Opp NEX',
      arrival: '4 min',
      nextArrival: 'next in 11 min',
      occupancy: 'Seats likely',
      deck: 'single deck',
      load: 'light'
    },
    {
      service: '53',
      destination: 'Changi Airport Terminal 2',
      stop: 'Serangoon Stn Exit C',
      arrival: 'Now',
      nextArrival: 'next in 9 min',
      occupancy: 'Standing room',
      deck: 'double deck',
      load: 'steady',
      arriving: true
    },
    {
      service: '147',
      destination: 'Hougang Central',
      stop: 'S\'goon Ctrl',
      arrival: '7 min',
      nextArrival: 'next in 14 min',
      occupancy: 'Quite full',
      deck: 'single deck',
      load: 'cozy'
    }
  ];

  readonly savedRoutes: SavedRoute[] = [
    {
      label: 'Home',
      route: 'Serangoon to Toa Payoh',
      note: 'Bus 73 · mellow morning',
      icon: 'home-outline',
      tone: 'sage'
    },
    {
      label: 'School',
      route: 'NEX to Bukit Timah',
      note: 'Bus 156 · 31 min',
      icon: 'school-outline',
      tone: 'sun'
    },
    {
      label: 'Work',
      route: 'Dhoby Ghaut to One-North',
      note: 'Bus 95 · easy transfer',
      icon: 'briefcase-outline',
      tone: 'clay'
    }
  ];

  readonly recentPlaces = [
    'Botanic Gardens',
    'Joo Chiat',
    'Marina South'
  ];

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home-outline', active: true },
    { label: 'Explore', icon: 'map-outline' },
    { label: 'Saved', icon: 'bookmark-outline' },
    { label: 'Nearby', icon: 'navigate-outline' },
    { label: 'Profile', icon: 'person-circle-outline' }
  ];

  constructor(
    private readonly ltaBusService: LtaBusService,
    private readonly ltaBusStopsService: LtaBusStopsService
  ) {
    this.recentBusStops = this.loadRecentBusStops();
  }

  async ngOnInit(): Promise<void> {
    console.log('IOS DEBUG 1 - home page initialized');

    try {
      await this.loadBusStops();
    } catch {
      this.logMatchesFound(0);
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

    this.ltaBusService.getBusArrivals(busStopCode).subscribe({
      next: (arrivalLookup) => {
        this.searchedBusStopCode = arrivalLookup.busStopCode;
        this.liveBusServices = arrivalLookup.services;
        this.isLoadingArrivals = false;
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

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.startsWith('Please enter')) {
      return error.message;
    }

    return 'The live bus feed is taking a quiet pause. Try this bus stop code again in a moment.';
  }
}
