import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { App } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { IonRouterOutlet } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { AppUpdateService } from './services/app-update.service';
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
  updateModalVisible = false;
  updateIsForced = false;
  updateUrl = '';
  updateLatestVersion = '';

  private splashExitTimer?: ReturnType<typeof setTimeout>;
  private splashRemoveTimer?: ReturnType<typeof setTimeout>;
  private backendKeepAliveTimer?: ReturnType<typeof setInterval>;
  private coldStartSplashSubscription?: Subscription;
  private routerSubscription?: Subscription;
  private appStateListener?: PluginListenerHandle;
  private optionalUpdateDismissedForVersion = '';
  private updateCheckInFlight = false;
  private readonly visibilityChangeHandler = () => {
    if (!document.hidden) {
      this.warmBackend();
      this.widgetBridgeService.syncStoredFavouriteStop();
      this.checkForAppUpdate();
    }
  };

  constructor(
    private readonly router: Router,
    private readonly appUpdateService: AppUpdateService,
    private readonly splashOverlayService: SplashOverlayService,
    private readonly widgetBridgeService: WidgetBridgeService
  ) {}

  ngOnInit(): void {
    this.splashTagline = this.randomTagline();
    this.warmBackend();
    this.checkForAppUpdate();
    this.widgetBridgeService.syncStoredFavouriteStop();
    this.backendKeepAliveTimer = setInterval(() => this.warmBackend(), 240000);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        return;
      }

      this.warmBackend();
      this.widgetBridgeService.syncStoredFavouriteStop();
      this.checkForAppUpdate();
    }).then((listener) => {
      this.appStateListener = listener;
    }).catch(() => undefined);
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
    this.appStateListener?.remove();
    document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
  }

  dismissUpdateModal(): void {
    if (this.updateIsForced) {
      return;
    }

    this.updateModalVisible = false;
    this.optionalUpdateDismissedForVersion = this.updateLatestVersion;
  }

  openUpdateUrl(): void {
    if (!this.updateUrl) {
      return;
    }

    window.open(this.updateUrl, '_system');
  }

  private async checkForAppUpdate(): Promise<void> {
    if (this.updateCheckInFlight || this.updateIsForced) {
      return;
    }

    this.updateCheckInFlight = true;

    try {
      const updateStatus = await this.appUpdateService.checkForUpdate();

      if (!updateStatus) {
        this.updateModalVisible = false;
        this.updateIsForced = false;
        this.updateUrl = '';
        this.updateLatestVersion = '';
        return;
      }

      if (!updateStatus.forced && this.optionalUpdateDismissedForVersion === updateStatus.latestVersion) {
        return;
      }

      this.updateIsForced = updateStatus.forced;
      this.updateUrl = updateStatus.updateUrl;
      this.updateLatestVersion = updateStatus.latestVersion;
      this.updateModalVisible = true;
    } finally {
      this.updateCheckInFlight = false;
    }
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
