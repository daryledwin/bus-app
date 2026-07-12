import { Component, ElementRef, OnInit, Optional, ViewChild } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { IonContent, IonRouterOutlet, NavController } from '@ionic/angular';

import { BusRoute, LtaBusRoutesService } from '../services/lta-bus-routes.service';
import { BusStop, LtaBusStopsService } from '../services/lta-bus-stops.service';
import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { SelectedBusStopService } from '../services/selected-bus-stop.service';
import { formatBusStopName as formatBusStopDisplayName } from '../utils/bus-stop-display';

interface RouteStopView {
  code: string;
  name: string;
  roadName: string;
  sequence: number;
  status: 'current' | 'next' | 'terminal';
}

interface DirectionView {
  direction: number;
  terminalName: string;
  terminalCode: string;
  stops: RouteStopView[];
}

@Component({
  selector: 'app-bus-routes',
  templateUrl: 'bus-routes.page.html',
  styleUrls: ['bus-routes.page.scss']
})
export class BusRoutesPage implements OnInit {
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild('routeResultCard') private readonly routeResultCard?: ElementRef<HTMLElement>;

  busServiceQuery = '';
  isLoadingRoutes = false;
  routeError = '';
  searchedServiceNo = '';
  directions: DirectionView[] = [];
  selectedDirection = 0;
  showSuggestions = false;
  isInputAnimating = false;
  recentBusServices: string[] = [];

  private busStops: BusStop[] = [];
  private busStopLookup = new Map<string, BusStop>();
  private busStopsLoadPromise?: Promise<BusStop[]>;
  private inputAnimationTimer?: ReturnType<typeof setTimeout>;
  private lastHapticInputValue = '';
  private readonly recentBusServicesStorageKey = 'recentBusRouteServices';
  private readonly serviceNumberIndex = [
    '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35',
    '36', '37', '38', '39', '40', '41', '42', '43', '43M', '45', '46', '47', '48', '49', '50', '51',
    '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '63M', '64', '65', '66',
    '67', '68', '69', '70', '70M', '71', '72', '72A', '73', '74', '74E', '75', '76', '77', '78', '79',
    '80', '81', '82', '83', '84', '85', '86', '87', '88', '89', '89A', '89E', '90', '91', '92', '92M',
    '93', '94', '95', '96', '97', '97E', '98', '98M', '99', '100', '101', '102', '103', '105', '106',
    '107', '107M', '109', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119', '120',
    '121', '122', '123', '124', '125', '127', '129', '130', '131', '132', '133', '134', '135', '136',
    '137', '138', '139', '140', '141', '142', '143', '145', '147', '150', '151', '153', '154', '155',
    '156', '157', '158', '159', '160', '161', '162', '162M', '163', '163M', '165', '166', '167', '168',
    '169', '170', '170X', '171', '172', '173', '174', '174E', '175', '176', '177', '178', '179', '179A',
    '180', '181', '181M', '182', '182M', '183', '184', '185', '186', '187', '188', '188E', '189', '190',
    '191', '192', '193', '194', '195', '196', '196E', '197', '198', '199', '200', '201', '222', '225',
    '225G', '225W', '228', '229', '231', '232', '235', '238', '240', '241', '242', '243', '243G', '243W',
    '246', '247', '248', '249', '251', '252', '253', '254', '255', '257', '258', '261', '262', '265',
    '268', '269', '272', '273', '291', '292', '293', '298', '300', '301', '302', '307', '307A', '315',
    '317', '324', '325', '329', '333', '334', '335', '354', '358', '359', '368', '371', '372', '374',
    '381', '382', '382G', '382W', '386', '400', '401', '403', '405', '410', '410G', '410W', '506', '518',
    '700', '700A', '800', '801', '803', '804', '805', '806', '807', '811', '811A', '812', '812A', '825',
    '850E', '851', '851E', '852', '853', '853M', '854', '854E', '855', '856', '857', '858', '859', '859A',
    '859B', '860', '860A', '861', '868', '882', '883', '883M', '901', '901M', '902', '903', '903M', '904',
    '911', '912', '912A', '912B', '913', '913M', '920', '922', '925', '925M', '927', '941', '944', '945',
    '947', '950', '951E', '960', '960E', '961', '961M', '963', '963E', '963R', '965', '966', '969', '972',
    '972M', '973', '974', '975', '976', '979', '981', '982E', '983', '983A', '991', '992'
  ];

  constructor(
    private readonly busRoutesService: LtaBusRoutesService,
    private readonly busStopsService: LtaBusStopsService,
    private readonly navController: NavController,
    private readonly refreshFeedbackService: RefreshFeedbackService,
    private readonly selectedBusStopService: SelectedBusStopService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  ngOnInit(): void {
    console.log('BusRoutesPage loaded');
    this.recentBusServices = this.loadRecentBusServices();
    void this.ensureBusStopsLoaded();
  }

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = true;
    }
  }

  get selectedRouteDirection(): DirectionView | undefined {
    return this.directions.find((direction) => direction.direction === this.selectedDirection)
      || this.directions[0];
  }

  get serviceSuggestions(): string[] {
    const query = this.normalizedServiceQuery();

    if (!this.showSuggestions || !query) {
      return [];
    }

    return this.serviceNumberIndex
      .filter((serviceNo) => serviceNo.startsWith(query))
      .slice(0, 8);
  }

  goBack(): void {
    if (this.routerOutlet?.canGoBack()) {
      this.navController.back();
      return;
    }

    this.navController.navigateBack('/tabs/settings');
  }

  async searchBusRoute(): Promise<void> {
    const serviceNo = this.normalizedServiceQuery();

    if (!serviceNo) {
      this.routeError = 'Enter a bus service number first.';
      return;
    }

    this.hideSuggestions();
    this.isLoadingRoutes = true;
    this.routeError = '';
    this.searchedServiceNo = serviceNo;
    this.directions = [];
    this.selectedDirection = 0;
    let routeLoaded = false;

    try {
      const [routes] = await Promise.all([
        this.busRoutesService.getBusRoutes(serviceNo).toPromise(),
        this.ensureBusStopsLoaded().catch(() => [])
      ]);

      const routeList = Array.isArray(routes) ? routes : [];
      const directions = this.buildDirections(routeList);

      if (!directions.length) {
        this.routeError = `No route found for bus ${serviceNo}.`;
        return;
      }

      this.directions = directions;
      this.selectedDirection = directions[0].direction;
      this.rememberBusService(serviceNo);
      routeLoaded = true;
      void this.refreshFeedbackService.lightImpact();
    } catch {
      this.routeError = 'Bus routes are taking a pause. Try again in a moment.';
    } finally {
      this.isLoadingRoutes = false;
      if (routeLoaded) {
        this.scrollToRouteResultWhenReady();
      }
    }
  }

  busServiceInputChanged(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const sanitizedValue = this.digitsOnly(input?.value || '');

    if (input && input.value !== sanitizedValue) {
      input.value = sanitizedValue;
    }

    this.busServiceQuery = sanitizedValue;
    this.showSuggestions = true;
    this.animateInputValue();
    this.triggerInputValueHaptic(sanitizedValue);
  }

  preventNonNumericInput(event: KeyboardEvent): void {
    if (
      event.metaKey
      || event.ctrlKey
      || event.altKey
      || ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End'].includes(event.key)
    ) {
      return;
    }

    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  }

  selectServiceSuggestion(serviceNo: string): void {
    this.busServiceQuery = serviceNo;
    this.hideSuggestions();
    void this.searchBusRoute();
  }

  searchRecentBusService(serviceNo: string): void {
    this.busServiceQuery = serviceNo;
    this.hideSuggestions();
    void this.searchBusRoute();
  }

  clearBusServiceSearch(): void {
    this.busServiceQuery = '';
    this.lastHapticInputValue = '';
    this.showSuggestions = false;
    this.isInputAnimating = false;
    this.isLoadingRoutes = false;
    this.routeError = '';
    this.searchedServiceNo = '';
    this.directions = [];
    this.selectedDirection = 0;
  }

  selectDirection(direction: number): void {
    void this.refreshFeedbackService.lightImpact();
    this.selectedDirection = direction;
  }

  selectRouteStop(stop: RouteStopView): void {
    const busStop = this.busStopLookup.get(stop.code) || {
      BusStopCode: stop.code,
      Description: stop.name || `Bus Stop ${stop.code}`,
      RoadName: stop.roadName || 'Road unavailable',
      Latitude: 0,
      Longitude: 0
    };

    this.selectedBusStopService.selectStop(busStop);
    this.navController.navigateRoot('/tabs/tab1');
  }

  trackDirection(index: number, direction: DirectionView): number {
    return direction.direction;
  }

  trackRouteStop(index: number, stop: RouteStopView): string {
    return `${stop.code}-${stop.sequence}`;
  }

  formatBusStopName(stop: { Description?: string; RoadName?: string } | null | undefined): string {
    return formatBusStopDisplayName(stop);
  }

  private normalizedServiceQuery(): string {
    return this.busServiceQuery.trim().toUpperCase().replace(/[^0-9A-Z]+/g, '');
  }

  private digitsOnly(value: string): string {
    return value.replace(/\D+/g, '');
  }

  private animateInputValue(): void {
    this.isInputAnimating = false;
    window.requestAnimationFrame(() => {
      this.isInputAnimating = true;
      clearTimeout(this.inputAnimationTimer);
      this.inputAnimationTimer = setTimeout(() => {
        this.isInputAnimating = false;
      }, 220);
    });
  }

  private async inputImpactHaptic(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics are a nice-to-have and are unavailable in some browsers.
    }
  }

  private triggerInputValueHaptic(value: string): void {
    if (value === this.lastHapticInputValue) {
      return;
    }

    this.lastHapticInputValue = value;
    void this.inputImpactHaptic();
  }

  private hideSuggestions(): void {
    this.showSuggestions = false;

    const activeElement = document.activeElement as HTMLElement | null;
    activeElement?.blur();
  }

  private rememberBusService(serviceNo: string): void {
    this.recentBusServices = [
      serviceNo,
      ...this.recentBusServices.filter((recentServiceNo) => recentServiceNo !== serviceNo)
    ].slice(0, 3);

    localStorage.setItem(this.recentBusServicesStorageKey, JSON.stringify(this.recentBusServices));
  }

  private loadRecentBusServices(): string[] {
    const storedServices = localStorage.getItem(this.recentBusServicesStorageKey);

    if (!storedServices) {
      return [];
    }

    try {
      const parsedServices = JSON.parse(storedServices);

      if (!Array.isArray(parsedServices)) {
        return [];
      }

      return parsedServices
        .filter((serviceNo): serviceNo is string => typeof serviceNo === 'string' && !!serviceNo.trim())
        .map((serviceNo) => serviceNo.trim().toUpperCase().replace(/[^0-9A-Z]+/g, ''))
        .filter(Boolean)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  private scrollToRouteResultWhenReady(): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void this.scrollToRouteResult();
      });
    });
  }

  private async scrollToRouteResult(): Promise<void> {
    const content = this.content;
    const routeCard = this.routeResultCard?.nativeElement;

    if (!content || !routeCard) {
      return;
    }

    try {
      const scrollElement = await content.getScrollElement();
      const cardTop = routeCard.offsetTop;
      const targetTop = Math.max(0, cardTop - 14);
      const currentTop = scrollElement.scrollTop;

      if (Math.abs(currentTop - targetTop) < 8) {
        return;
      }

      await content.scrollToPoint(0, targetTop, 360);
    } catch {
      routeCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private async ensureBusStopsLoaded(): Promise<BusStop[]> {
    if (this.busStops.length) {
      return this.busStops;
    }

    if (!this.busStopsLoadPromise) {
      this.busStopsLoadPromise = this.busStopsService.getBusStops().toPromise()
        .then((stops) => {
          this.busStops = Array.isArray(stops) ? stops : [];
          this.busStopLookup = new Map(this.busStops.map((stop) => [stop.BusStopCode, stop]));
          return this.busStops;
        })
        .finally(() => {
          this.busStopsLoadPromise = undefined;
        });
    }

    return this.busStopsLoadPromise;
  }

  private buildDirections(routes: BusRoute[]): DirectionView[] {
    const groupedRoutes = new Map<number, BusRoute[]>();

    routes.forEach((route) => {
      const direction = Number(route.Direction) || 1;
      const currentRoutes = groupedRoutes.get(direction) || [];
      currentRoutes.push(route);
      groupedRoutes.set(direction, currentRoutes);
    });

    return [...groupedRoutes.entries()]
      .sort(([directionA], [directionB]) => directionA - directionB)
      .map(([direction, directionRoutes]) => this.buildDirection(direction, directionRoutes))
      .filter((direction): direction is DirectionView => !!direction);
  }

  private buildDirection(direction: number, routes: BusRoute[]): DirectionView | null {
    const orderedRoutes = [...routes].sort((a, b) => Number(a.StopSequence) - Number(b.StopSequence));

    if (!orderedRoutes.length) {
      return null;
    }

    const terminalRoute = orderedRoutes[orderedRoutes.length - 1];
    const terminalStop = this.routeStopView(terminalRoute, 'terminal');

    return {
      direction,
      terminalName: terminalStop.name,
      terminalCode: terminalStop.code,
      stops: orderedRoutes.map((route, routeIndex) => this.routeStopView(
        route,
        route.BusStopCode === terminalRoute.BusStopCode
          ? 'terminal'
          : routeIndex === 0
            ? 'current'
            : 'next'
      ))
    };
  }

  private routeStopView(route: BusRoute, status: RouteStopView['status']): RouteStopView {
    const busStop = this.busStopLookup.get(route.BusStopCode);

    return {
      code: route.BusStopCode,
      name: busStop?.Description || `Bus Stop ${route.BusStopCode}`,
      roadName: busStop?.RoadName || route.BusStopCode,
      sequence: Number(route.StopSequence) || 0,
      status
    };
  }
}
