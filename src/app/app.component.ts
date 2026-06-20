import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonRouterOutlet } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { OnboardingService } from './services/onboarding.service';
import { ReviewService } from './services/review.service';
import { WidgetBridgeService } from './services/widget-bridge.service';

export const SPLASH_TAGLINES = [
  'hope your bus timing is accurate today 🚌',
  'may you get a seat before the next stop 🪑',
  'wishing you a gentle start to the day ☀️',
  'manifesting a slightly later lecture 🎓',
  'may your meeting have been an email 📧',
  'let the coffee do the heavy lifting today ☕',
  'may every traffic light be green 🚦',
  'wishing you a shorter-feeling journey 🌤️',
  'manifesting the perfect transfer ✨',
  'may your battery percentage hold steady 🔋',
  'here’s to an air-conditioned bus ❄️',
  'may your train and bus timings cooperate 🤝',
  'wishing you a peaceful ride today 🤫',
  'may no bus leave 2 seconds before you arrive ⏱️',
  'today’s tiny win: a good lunch 🍜',
  'manifesting fewer surprises today 📅',
  'wishing you a smooth trip home 🌆',
  'may someone free up that seat 🪑',
  'here’s to a fast-moving queue 🚶',
  'manifesting instant group project replies 💬',
  'may attendance be taken early today 📝',
  'wishing you an on-time tutorial ending 🎓',
  'good luck with your presentation today 🎤',
  'may your prof be in a good mood 😌',
  'one deadline at a time 📚',
  'manifesting self-writing assignments ✍️',
  'may your exam venue be easy to find 🧭',
  'wishing you and your GPA a healthy relationship 📈',
  'manifesting responsive project mates 📱',
  'may your inbox behave today 📧',
  'here’s hoping for a well-deserved compliment 👍',
  'enjoy that lunch break 🍱',
  'may your calendar stay merciful 📅',
  'wishing you short meetings and long breaks 💻',
  'manifesting a meeting-free 5pm 🕔',
  'may work end on time today 🏠',
  'wishing you a lighter commute home 🌇',
  'may your shift fly by ⏳',
  'manifesting reasonable Grab prices 🚕',
  'may your umbrella stay unused ☂️',
  'wishing the weather would make up its mind 🌦️',
  'may the rain wait until you get home 🌧️',
  'enjoy the breeze today 🍃',
  'may every puddle miss your shoes 💧',
  'wishing you kind weather ☀️',
  'may your hair survive the humidity 🌴',
  'hope your outfit matches the weather 👕',
  'may there be shade at your bus stop 🌳',
  'wishing you the perfect playlist 🎵',
  'today’s tiny win: a good snack 🍪',
  'manifesting your favourite seat 🪑',
  'may you remember why you entered the room 🚪',
  'wishing your phone enough battery until bedtime 📱',
  'may your charger be exactly where you left it 🔌',
  'hope your wallet is where you expect it 👛',
  'may your keys cooperate today 🔑',
  'looks like your alarm did its job ⏰',
  'wishing your water stays cold 💧',
  'may your to-do list shrink today ✅',
  'manifesting a bus before the next refresh 👀',
  'may your connection be waiting for you ✨',
  'wishing you a smoother ride than the roads 🚍',
  'may your stop arrive at the perfect moment 🛑',
  'today’s detour should be the fun kind 🗺️',
  'hope the destination is worth the journey 📍',
  'may nobody blast videos beside you 🎧',
  'manifesting clear bus doors 🚪',
  'may the arriving bus have space inside 🚌',
  'wishing you an uneventful transfer 🧭',
  'may the next bus not be 18 minutes away ⏱️',
  'wishing your waiting time feels shorter 🌿',
  'good vibes are on the next ride ✨',
  'may your commute be pleasantly uneventful 😌',
  'hope your bus card has enough value 💳',
  'may your signal survive underground 📶',
  'wishing you a strong start to the day 👟',
  'hope your evening feels earned 🌇',
  'safe travels to wherever you’re headed 🚌',
  'today feels lucky 🍀',
  'wishing you a calm, air-conditioned commute ❄️',
  'may something make you smile today 🌤️',
  'good things await at the next stop 🌤️',
  'may your route stay drama-free 🗺️',
  'manifesting genuinely on-time buses ⏱️',
  'today feels like a corner-seat day 🪑',
  'may your EZ-Link behave at the gantry 💳',
  'wishing your morning kopi hits different ☕',
  'may the MRT lift actually be working 🛗',
  'safe travels and good vibes']

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
  private readonly visibilityChangeHandler = () => {
    if (!document.hidden) {
      this.warmBackend();
      this.widgetBridgeService.syncStoredFavouriteStop();
    }
  };

  constructor(
    private readonly router: Router,
    private readonly onboardingService: OnboardingService,
    private readonly reviewService: ReviewService,
    private readonly widgetBridgeService: WidgetBridgeService
  ) {}

  ngOnInit(): void {
    void this.registerDeepLinkHandler();
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
    const targetUrl = this.routeFromDeepLink(event.url);

    if (!targetUrl) {
      return;
    }

    void this.router.navigateByUrl(targetUrl);
  }

  private routeFromDeepLink(url: string): string | undefined {
    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol !== 'skibidi:') {
        return undefined;
      }

      if (parsedUrl.hostname === 'stop') {
        const busStopCode = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '')).trim();

        if (!busStopCode) {
          return '/tabs/tab1';
        }

        const params = new URLSearchParams({
          busStopCode,
          source: 'widget',
          t: String(Date.now())
        });

        return `/tabs/tab1?${params.toString()}`;
      }

      if (parsedUrl.hostname === 'home') {
        return '/tabs/tab1';
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private updateRootSwipeGesture(url: string): void {
    if (!this.rootRouterOutlet) {
      return;
    }

    this.rootRouterOutlet.swipeGesture = !this.isRootTabUrl(url);
  }

  private isRootTabUrl(url: string): boolean {
    const route = url.split('?')[0].split('#')[0];
    return route === '/tabs/tab1' || route === '/tabs/tab2';
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
