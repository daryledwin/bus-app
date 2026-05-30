import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { IonRouterOutlet } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { SplashOverlayService } from './services/splash-overlay.service';
import { WidgetBridgeService } from './services/widget-bridge.service';

export const SPLASH_TAGLINES = [
  'hope your bus comes early today 🚌',
  'hope both sides of your pillow were cold ❄️',
  'hope today feels a little lighter ☁️',
  'manifesting empty buses for you ✨🪑',
  'hope you catch every green light today 🚦',
  'wishing you a seated ride 🪑😌',
  'hope your transfer timing is perfect today ⏱️',
  'may your bus be not crowded 🚌',
  'hope your journey home feels peaceful 🌆',
  'hope your bus arrives the moment you reach 🏃‍♂️🚌',
  'may today be low stress and air-conditioned ❄️',
  'wishing you smooth rides today 🌤️',
  'hope your phone battery survives the commute 🔋',
  'hope the bus doors don’t close on you today 🚪',
  'may your next ride be comfy 🪑',
  'hope today treats you gently 🌤️',
  'hope your commute is unusually smooth today ✨',
  'one stop at a time 🚌',
  'making commutes less sian 🌿',
  'good rides ahead 🌤️🚌'
];

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rootRouterOutlet') private readonly rootRouterOutlet?: IonRouterOutlet;

  splashVisible = true;
  splashLeaving = false;
  splashTagline = '';

  private splashExitTimer?: ReturnType<typeof setTimeout>;
  private splashRemoveTimer?: ReturnType<typeof setTimeout>;
  private backendKeepAliveTimer?: ReturnType<typeof setInterval>;
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
    private readonly splashOverlayService: SplashOverlayService,
    private readonly widgetBridgeService: WidgetBridgeService
  ) {}

  ngOnInit(): void {
    this.splashTagline = this.randomTagline();
    this.warmBackend();
    this.widgetBridgeService.syncStoredFavouriteStop();
    this.backendKeepAliveTimer = setInterval(() => this.warmBackend(), 240000);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    this.coldStartSplashSubscription = this.splashOverlayService.coldStartLoading$.subscribe((isLoading) => {
      if (isLoading) {
        this.showColdStartSplash();
      } else {
        this.hideColdStartSplash();
      }
    });
    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.updateRootSwipeGesture(event.urlAfterRedirects));
    this.updateRootSwipeGesture(this.router.url);

    this.splashExitTimer = setTimeout(() => {
      this.splashLeaving = true;
    }, 2450);
    this.splashRemoveTimer = setTimeout(() => {
      this.splashVisible = false;
    }, 3050);
  }

  ngAfterViewInit(): void {
    this.updateRootSwipeGesture(this.router.url);
  }

  ngOnDestroy(): void {
    if (this.splashExitTimer) {
      clearTimeout(this.splashExitTimer);
    }

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

  private showColdStartSplash(): void {
    if (this.splashExitTimer) {
      clearTimeout(this.splashExitTimer);
    }

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
