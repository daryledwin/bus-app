import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonRouterOutlet } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { AppUpdateService } from './services/app-update.service';
import { OnboardingService } from './services/onboarding.service';
import { ReviewService } from './services/review.service';
import { WidgetBridgeService } from './services/widget-bridge.service';

export const SPLASH_TAGLINES = [
  'Hope your favourite bus driver is on shift today!',
'May your transfer be quicker than expected.',
'Wishing you a peaceful commute home.',
'Hope your next notification is good news!',
'May your coffee stay warm until the last sip.',
'Here’s hoping the queue moves surprisingly fast!',
'May your afternoon be kinder than your morning.',
'Hope today has one pleasant surprise waiting.',
'Wishing you a productive study session!',
'Hope your laptop behaves itself today.',
'May your charger be exactly where you left it!',
'Here’s to finding a good seat in the library.',
'Hope your food arrives while it’s still hot!',
'May your bubble tea order be worth the wait.',
'Wishing you clear skies on the way home.',
'Hope your shoes stay dry today!',
'May your afternoon nap be uninterrupted.',
'Hope your playlist finds the perfect song.',
'Wishing you an unexpectedly smooth day!',
'Hope your next email is an easy one.',
'May your lecture finish a little early!',
'Hope your bus stop isn’t crowded today.',
'May your grocery queue be the shortest one.',
'Wishing you a peaceful evening ahead.',
'Hope your screen time feels worthwhile today.',
'May your code compile on the first try!',
'Hope your Wi-Fi stays strong all day.',
'May your reusable bottle stay full.',
'Hope your day gets better with every stop.',
'Wishing you a relaxing ride home!',
'Hope someone holds the lift for you.',
'May the weather app actually be right today!',
'Hope your favourite snack is still in stock.',
'Wishing you a little extra luck today!',
'Hope the crossing light changes quickly.',
'May your plans go exactly as expected.',
'Hope your weekend arrives sooner than expected!',
'May your laundry dry before it rains.',
'Hope your headphones never run out of battery!',
'Here’s to a satisfying dinner tonight.',
'Hope your delivery arrives on time!',
'May your coffee queue move quickly.',
'Hope your timetable is kind today.',
'May your next bus arrive just as you reach the stop!',
'Hope your day has more wins than worries.',
'Wishing you a refreshing break today.',
'Hope your calendar stays pleasantly empty.',
'May your errands finish faster than expected!',
'Hope your notes make sense when you revisit them.',
'May your focus last a little longer today.',
'Hope your favourite hawker stall has a short queue today.',
'May your kopi be made exactly the way you like it!',
'Hope someone smiles at you today.',
'May your reusable bag come in handy.',
'Wishing you a calm journey through the city.',
'Hope your charging cable isn’t tangled today.',
'May your bus stop be pleasantly quiet.',
'Hope your AirPods are fully charged!',
'Wishing you a productive morning and a relaxing evening.',
'May your lunch exceed expectations.',
'Hope your errands only take one trip.',
'May the lift arrive just as you reach it!',
'Hope your next scroll ends on something wholesome.',
'Wishing you a little extra motivation today.',
'Hope your favourite café has an empty table.',
'May your keyboard never miss a keystroke.',
'Hope your search results appear instantly!',
'Wishing you fewer notifications and more peace.',
'May your phone stay cool in this weather.',
'Hope your shopping queue moves quickly.',
'May your reusable cup earn you a discount!',
'Hope your socks stay dry all day.',
'Wishing you a peaceful ride with no sudden brakes.',
'Hope your bus captain has a smooth route today.',
'May your day be as reliable as the MRT on a good day.',
'Hope your favourite song comes on naturally.',
'May your screen brightness be just right.',
'Hope your bag feels lighter than usual.',
'Wishing you one less thing to worry about today.',
'Hope your food court has plenty of seats.',
'May your ice cream survive the weather!',
'Hope your phone storage is not full today.',
'Wishing you the perfect afternoon pick-me-up.',
'Hope you find exactly what you are looking for.',
'May your coffee order be made perfectly.',
'Hope your timetable gives you breathing room today.',
'Wishing you a calm start and an even better finish.',
'Hope every green man appears right on time!',
'May your route home be the fastest one.',
'Wishing you a surprisingly peaceful inbox.',
'Hope your favourite podcast uploads today!',
'May your plans work out without any last-minute changes.',
'Hope your day has more laughter than stress.',
'Wishing you a lovely sunset on the way home.',
'Hope your favourite seat is still available.',
'May your next break feel well deserved.',
'Wishing you safe travels, wherever today takes you!',
'Hope the hawker queue moves faster than expected.',
'May your kopi auntie remember your usual order!',
'Wishing you a peaceful evening walk.',
'Hope your bus stop has plenty of shade today.',
'May your phone survive without Low Power Mode!',
'Hope your reusable umbrella stays folded today.',
'Wishing you a lovely ride through the city.',
'Hope your next meal is exactly what you are craving.',
'May your favourite hawker stall still have your dish!',
'Hope todays weather is kinder than yesterday.',
'Wishing you a surprisingly smooth Monday.',
'Hope Friday arrives before you know it!',
'May your afternoon coffee work its magic.',
'Hope your morning starts without rushing.',
'Wishing you one less red traffic light today.',
'Hope your transfer is just across the platform.',
'May your favourite study spot be available!',
'Hope your phone never slips out of your pocket.',
'Wishing you a calm ride with no sudden crowds.',
'Hope your favourite café is not full today.',
'May your errands all be in the same direction!',
'Hope someone lets you board first today.',
'Wishing you the perfect balance of productivity and rest.',
'Hope your package arrives earlier than expected!',
'May your reusable bag fit everything you bought.',
'Hope your commute gives you time to unwind.',
'Wishing you an unexpectedly good conversation today.',
'Hope your library is nice and quiet.',
'May your charging port work on the first try!',
'Hope you hit every green light on your walk.',
'Wishing you a calm mind and a lighter day.',
'Hope your favourite playlist never gets interrupted.',
'May todays little wins add up to something big.',
'Hope your evening breeze feels extra refreshing.',
'Wishing you a bus that is right on time!',
'Hope your shopping list is shorter than you remembered.',
'May your dinner be worth looking forward to.',
'Hope your next cup of kopi tastes even better.',
'Wishing you a peaceful ride past the city lights.',
'Hope your MRT arrives just as you reach the platform.',
'May your lunch break feel a little longer today.',
'Hope tomorrow is even smoother than today.',
'Wishing you fewer delays and more good moments.',
'Hope your battery still says 20% when you need it most!',
'May your next destination be worth the journey.',
'Hope your day ends on a happy note.',
'Wishing you safe travels and clear skies.',
'Hope something small makes you smile today.',
'May today treat you kindly.',
'See you at the next stop!'
];

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rootRouterOutlet') private readonly rootRouterOutlet?: IonRouterOutlet;

  onboardingPending = false;

  private backendKeepAliveTimer?: ReturnType<typeof setInterval>;
  private backgroundWorkStarted = false;
  private nativeSplashHidden = false;
  private routerSubscription?: Subscription;
  private appUrlOpenListener?: PluginListenerHandle;
  private lastDeepLinkKey = '';
  private lastDeepLinkHandledAt = 0;
  private deepLinkSequence = 0;
  private statusTapListener?: PluginListenerHandle;
  private readonly statusTapWindowHandler = () => this.scrollActiveIonContentToTop();
  private readonly visibilityChangeHandler = () => {
    if (!document.hidden) {
      this.warmBackend();
      this.widgetBridgeService.syncStoredFavouriteStop();
    }
  };

  constructor(
    private readonly appUpdateService: AppUpdateService,
    private readonly router: Router,
    private readonly onboardingService: OnboardingService,
    private readonly reviewService: ReviewService,
    private readonly widgetBridgeService: WidgetBridgeService
  ) {}

  ngOnInit(): void {
    void this.registerDeepLinkHandler();
    void this.registerStatusTapHandler();
    this.reviewService.recordLaunch();
    console.info(`[Startup] onboarding check start ${Date.now()}`);
    this.onboardingPending = !this.onboardingService.isComplete();
    console.info(`[Startup] onboarding check end ${Date.now()} pending=${this.onboardingPending}`);

    if (!this.onboardingPending) {
      this.startBackgroundWork();
    }

    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        console.info(`[Startup] first route ready ${Date.now()} url=${event.urlAfterRedirects}`);
        this.updateRootSwipeGesture(event.urlAfterRedirects);

        if (!this.isOnboardingUrl(event.urlAfterRedirects) && this.onboardingService.isComplete()) {
          this.onboardingPending = false;
          this.startBackgroundWork();
        }

        this.hideNativeSplashAfterPaint();
      });
    this.updateRootSwipeGesture(this.router.url);
  }

  ngAfterViewInit(): void {
    this.updateRootSwipeGesture(this.router.url);
  }

  ngOnDestroy(): void {
    if (this.backendKeepAliveTimer) {
      clearInterval(this.backendKeepAliveTimer);
    }

    this.routerSubscription?.unsubscribe();
    this.appUrlOpenListener?.remove();
    this.statusTapListener?.remove();
    window.removeEventListener('statusTap', this.statusTapWindowHandler);
    document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
  }

  private async registerDeepLinkHandler(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    this.appUrlOpenListener = await App.addListener('appUrlOpen', (event) => {
      this.handleAppUrlOpen(event);
    });

    const launchUrl = await App.getLaunchUrl();

    if (launchUrl?.url) {
      this.handleAppUrlOpen({ url: launchUrl.url });
    }
  }

  private handleAppUrlOpen(event: URLOpenListenerEvent): void {
    const deepLink = this.parseDeepLink(event.url);

    if (!deepLink) {
      return;
    }

    const now = Date.now();
    if (deepLink.key === this.lastDeepLinkKey && now - this.lastDeepLinkHandledAt < 2000) {
      return;
    }

    this.lastDeepLinkKey = deepLink.key;
    this.lastDeepLinkHandledAt = now;
    this.deepLinkSequence++;

    const params = new URLSearchParams({
      busStopCode: deepLink.busStopCode,
      busStopName: deepLink.busStopName,
      source: deepLink.source,
      event: `${now}-${this.deepLinkSequence}`
    });

    void this.router.navigateByUrl(`/tabs/tab1?${params.toString()}`);
  }

  private parseDeepLink(url: string): {
    key: string;
    busStopCode: string;
    busStopName: string;
    source: string;
  } | undefined {
    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol === 'mybussg:' && parsedUrl.hostname === 'bus-stop') {
        const busStopCode = parsedUrl.searchParams.get('code')?.trim() || '';
        const busStopName = parsedUrl.searchParams.get('name')?.trim() || '';

        if (!/^\d{5}$/.test(busStopCode)) {
          return undefined;
        }

        return {
          key: `bus-stop:${busStopCode}:${busStopName}`,
          busStopCode,
          busStopName,
          source: 'live-activity'
        };
      }

      if (parsedUrl.protocol === 'skibidi:' && parsedUrl.hostname === 'stop') {
        const busStopCode = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '')).trim();

        if (!/^\d{5}$/.test(busStopCode)) {
          return undefined;
        }

        return {
          key: `bus-stop:${busStopCode}:`,
          busStopCode,
          busStopName: '',
          source: 'widget'
        };
      }

      if (parsedUrl.protocol === 'skibidi:' && parsedUrl.hostname === 'home') {
        void this.router.navigateByUrl('/tabs/tab1');
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private async registerStatusTapHandler(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    window.addEventListener('statusTap', this.statusTapWindowHandler);

    try {
      const addStatusTapListener = App.addListener as unknown as (
        eventName: 'statusTap',
        listenerFunc: () => void
      ) => Promise<PluginListenerHandle>;

      this.statusTapListener = await addStatusTapListener('statusTap', () => {
        this.scrollActiveIonContentToTop();
      });
    } catch {
      // Some native shells dispatch statusTap on window instead of the App plugin.
    }
  }

  private scrollActiveIonContentToTop(): void {
    const activeContent = this.activeIonContent();

    if (!activeContent) {
      return;
    }

    activeContent.scrollToTop(320).catch(() => undefined);
  }

  private activeIonContent(): HTMLIonContentElement | undefined {
    const contents = Array.from(document.querySelectorAll<HTMLIonContentElement>('ion-router-outlet ion-content'));
    const visibleContents = contents.filter((content) => this.isVisibleIonContent(content));

    return visibleContents[visibleContents.length - 1] || contents[contents.length - 1];
  }

  private isVisibleIonContent(content: HTMLIonContentElement): boolean {
    const hiddenPage = content.closest('.ion-page-hidden');

    if (hiddenPage) {
      return false;
    }

    const page = content.closest('.ion-page') as HTMLElement | null;

    if (page) {
      const styles = getComputedStyle(page);

      if (styles.display === 'none' || styles.visibility === 'hidden' || page.getAttribute('aria-hidden') === 'true') {
        return false;
      }
    }

    const rect = content.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private updateRootSwipeGesture(url: string): void {
    if (!this.rootRouterOutlet) {
      return;
    }

    this.rootRouterOutlet.swipeGesture = !this.isRootTabUrl(url);
  }

  private isRootTabUrl(url: string): boolean {
    const route = url.split('?')[0].split('#')[0];
    return route === '/tabs/tab1' || route === '/tabs/tab2' || route === '/tabs/settings';
  }

  private isOnboardingUrl(url: string): boolean {
    return url.split('?')[0].split('#')[0] === '/onboarding';
  }

  private startBackgroundWork(): void {
    if (this.backgroundWorkStarted) {
      return;
    }

    this.backgroundWorkStarted = true;
    this.warmBackend();
    this.widgetBridgeService.syncStoredFavouriteStop();
    this.backendKeepAliveTimer = setInterval(() => this.warmBackend(), 240000);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    void this.appUpdateService.checkForAppStoreUpdate();
  }

  private hideNativeSplashAfterPaint(): void {
    if (this.nativeSplashHidden) {
      return;
    }

    this.nativeSplashHidden = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        console.info(`[Startup] SplashScreen.hide ${Date.now()}`);
        void SplashScreen.hide({ fadeOutDuration: 180 });
      });
    });
  }

  private warmBackend(): void {
    fetch(`${environment.apiBaseUrl}/health`, { cache: 'no-store' }).catch(() => {
      // Best-effort keep-alive only; arrival searches still handle errors normally.
    });
  }
}
