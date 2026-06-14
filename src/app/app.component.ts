import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonRouterOutlet } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { OnboardingService } from './services/onboarding.service';
import { SplashOverlayService } from './services/splash-overlay.service';
import { WidgetBridgeService } from './services/widget-bridge.service';

export const SPLASH_TAGLINES = [
  'hope your bus timing is accurate today 🚌',
  'hope you get a seat before the next stop 🪑',
  'hope your morning starts gently ☀️',
  'hope your lecture starts late today 🎓',
  'hope your meeting could have been an email 📧',
  'hope your coffee works overtime today ☕',
  'hope your bus driver catches every green light 🚦',
  'hope your journey feels shorter today 🌤️',
  'hope your transfer is somehow perfect ✨',
  'hope your battery percentage stops dropping 🔋',
  'hope your aircon bus actually has aircon ❄️',
  'hope your train and bus timings cooperate today 🤝',
  'hope your next ride is a quiet one 🤫',
  'hope you never miss a bus by 2 seconds today ⏱️',
  'hope your lunch is worth looking forward to 🍜',
  'hope today has fewer surprises 📅',
  'hope your journey home feels quick 🌆',
  'hope someone moves their bag off the seat 🪑',
  'hope your queue moves fast today 🚶',
  'hope your group project replies instantly 💬',
  'hope your attendance gets taken early 📝',
  'hope your tutorial ends on time 🎓',
  'hope your presentation goes smoothly 🎤',
  'hope your prof is in a good mood today 😌',
  'hope your deadline feels manageable today 📚',
  'hope your assignment somehow writes itself ✍️',
  'hope your exam venue is easy to find 🧭',
  'hope your GPA likes you back 📈',
  'hope your project group is responsive today 📱',
  'hope your work inbox behaves today 📧',
  'hope your boss says good job today 👍',
  'hope your lunch break feels long enough 🍱',
  'hope your calendar stays merciful today 📅',
  'hope your meetings stay short 💻',
  'hope nobody schedules a 5pm meeting 🕔',
  'hope your work ends on time today 🏠',
  'hope your commute home feels lighter 🌇',
  'hope your shift goes by quickly ⏳',
  'hope your grab prices stay reasonable 🚕',
  'hope your umbrella remains unused today ☂️',
  'hope the weather picks a side 🌦️',
  'hope the rain waits until you get home 🌧️',
  'hope today comes with a nice breeze 🍃',
  'hope your shoes avoid every puddle 💧',
  'hope the sun is feeling generous today ☀️',
  'hope your hair survives the humidity 🌴',
  'hope your outfit matches the weather today 👕',
  'hope your bus stop has shade today 🌳',
  'hope your playlist picks all the right songs 🎵',
  'hope your snack hits the spot today 🍪',
  'hope your favourite seat is available 🪑',
  'hope you remember why you walked into the room 🚪',
  'hope your phone survives until bedtime 📱',
  'hope your charger is where you left it 🔌',
  'hope your wallet is exactly where you expect it 👛',
  'hope your keys don\'t play hide and seek 🔑',
  'hope your alarm was accurate today ⏰',
  'hope your water bottle stays cold 💧',
  'hope your to-do list gets shorter today ✅',
  'hope your bus arrives before you start checking again 👀',
  'hope your next connection is waiting for you ✨',
  'hope your ride is smoother than the roads 🚍',
  'hope your stop comes at exactly the right time 🛑',
  'hope today\'s detours are only the fun kind 🗺️',
  'hope your destination is worth the trip 📍',
  'hope the person beside you isn\'t watching videos loudly 🎧',
  'hope nobody blocks the bus door today 🚪',
  'hope the bus isn\'t already packed when it pulls up 🚌',
  'hope your transfer doesn\'t become an adventure 🧭',
  'hope the next bus isn\'t 18 minutes away ⏱️',
  'hope your waiting time feels shorter today 🌿',
  'hope your ride comes with good vibes ✨',
  'hope your commute is mostly uneventful 😌',
  'hope your bus card has enough value 💳',
  'hope your phone signal behaves underground 📶',
  'hope your day starts on the right foot 👟',
  'hope your evening feels earned 🌇',
  'hope you get where you\'re going comfortably 🚌',
  'hope your timing is lucky today 🍀',
  'hope your commute is calm and air-conditioned ❄️',
  'hope something makes you smile today 🌤️',
  'hope your next stop brings something good 🌤️',
  'hope your route doesn\'t have any funny business today 🗺️',
  'hope your bus is actually on time and not just "on time" ⏱️',
  'hope you get a corner seat today 🪑',
  'hope your EZ-Link doesn\'t beep twice at the gantry 💳',
  'hope your morning kopi hits different today ☕',
  'hope the lift at your MRT station is actually working 🛗',
  'safe travels and good vibes 🚌✨',
];

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rootRouterOutlet') private readonly rootRouterOutlet?: IonRouterOutlet;

  splashVisible = false;
  splashLeaving = false;
  splashTagline = '';
  onboardingPending = false;

  private splashRemoveTimer?: ReturnType<typeof setTimeout>;
  private backendKeepAliveTimer?: ReturnType<typeof setInterval>;
  private backgroundWorkStarted = false;
  private nativeSplashHidden = false;
  private coldStartSplashSubscription?: Subscription;
  private routerSubscription?: Subscription;
  private readonly visibilityChangeHandler = () => {
    if (!document.hidden) {
      this.warmBackend();
      this.widgetBridgeService.syncStoredFavouriteStop();
    }
  };

  constructor(
    private readonly router: Router,
    private readonly onboardingService: OnboardingService,
    private readonly splashOverlayService: SplashOverlayService,
    private readonly widgetBridgeService: WidgetBridgeService
  ) {}

  ngOnInit(): void {
    console.info(`[Startup] onboarding check start ${Date.now()}`);
    this.onboardingPending = !this.onboardingService.isComplete();
    console.info(`[Startup] onboarding check end ${Date.now()} pending=${this.onboardingPending}`);

    if (!this.onboardingPending) {
      this.startBackgroundWork();
    }

    this.coldStartSplashSubscription = this.splashOverlayService.coldStartLoading$.subscribe((isLoading) => {
      if (isLoading && !this.onboardingPending) {
        this.showColdStartSplash();
      } else {
        this.hideColdStartSplash();
      }
    });
    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        console.info(`[Startup] first route ready ${Date.now()} url=${event.urlAfterRedirects}`);
        this.updateRootSwipeGesture(event.urlAfterRedirects);

        if (this.isOnboardingUrl(event.urlAfterRedirects)) {
          this.hideSplashImmediately();
        } else if (this.onboardingService.isComplete()) {
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
    if (this.splashRemoveTimer) {
      clearTimeout(this.splashRemoveTimer);
    }

    if (this.backendKeepAliveTimer) {
      clearInterval(this.backendKeepAliveTimer);
    }

    this.coldStartSplashSubscription?.unsubscribe();
    this.routerSubscription?.unsubscribe();
    document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
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

  private hideSplashImmediately(): void {
    if (this.splashRemoveTimer) {
      clearTimeout(this.splashRemoveTimer);
      this.splashRemoveTimer = undefined;
    }

    this.splashLeaving = false;
    this.splashVisible = false;
  }

  private showColdStartSplash(): void {
    if (this.splashRemoveTimer) {
      clearTimeout(this.splashRemoveTimer);
    }

    this.splashTagline = this.randomTagline();
    this.splashLeaving = false;
    this.splashVisible = true;
  }

  private hideColdStartSplash(): void {
    if (!this.splashVisible) {
      return;
    }

    if (this.splashRemoveTimer) {
      clearTimeout(this.splashRemoveTimer);
    }

    this.splashLeaving = true;
    this.splashRemoveTimer = setTimeout(() => {
      this.splashVisible = false;
    }, 620);
  }

  private randomTagline(): string {
    return SPLASH_TAGLINES[Math.floor(Math.random() * SPLASH_TAGLINES.length)];
  }

  private warmBackend(): void {
    fetch(`${environment.apiBaseUrl}/health`, { cache: 'no-store' }).catch(() => {
      // Best-effort keep-alive only; arrival searches still handle errors normally.
    });
  }
}
