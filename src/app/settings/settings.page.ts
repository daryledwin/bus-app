import { Component, Optional, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Browser } from '@capacitor/browser';
import { IonContent, IonRouterOutlet, NavController } from '@ionic/angular';
import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { ReviewService } from '../services/review.service';
import { SameTabScrollService } from '../services/same-tab-scroll.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss']
})
export class SettingsPage {
  private readonly dataSourceUrl = 'https://datamall.lta.gov.sg/';
  private readonly feedbackEmailUrl = 'mailto:daryledwin03@gmail.com?subject=MyBus%20SG%20Feedback';
  @ViewChild(IonContent) content?: IonContent;

  private lastNavTapAt = 0;
  private lastNavRoute = '';

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home-outline', route: '/tabs/tab1' },
    { label: 'Nearby', icon: 'navigate-outline', route: '/tabs/tab2' },
    { label: 'Settings', icon: 'settings-outline', route: '/tabs/settings' }
  ];

  constructor(
    private readonly refreshFeedbackService: RefreshFeedbackService,
    private readonly navController: NavController,
    private readonly reviewService: ReviewService,
    private readonly router: Router,
    private readonly sameTabScrollService: SameTabScrollService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = false;
    }
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
      await this.sameTabScrollService.toTop(this.content);
      return;
    }

    void this.refreshFeedbackService.lightImpact();
    this.router.navigateByUrl(route);
  }

  openReviewPage(): void {
    this.reviewService.openAppStoreReviewPage();
  }

  openMrtMap(): void {
    void this.refreshFeedbackService.lightImpact();
    this.navController.navigateForward('/mrt-map', { animated: true });
  }

  openBusRoutes(): void {
    void this.refreshFeedbackService.lightImpact();
    this.navController.navigateForward('/bus-routes', { animated: true });
  }

  openPinnedBuses(): void {
    void this.refreshFeedbackService.lightImpact();
    this.navController.navigateForward('/pinned-buses', { animated: true });
  }

  async openDataSourcePage(): Promise<void> {
    try {
      await Browser.open({ url: this.dataSourceUrl });
    } catch {
      window.location.href = this.dataSourceUrl;
    }
  }

  async openFeedbackEmail(): Promise<void> {
    try {
      await Browser.open({ url: this.feedbackEmailUrl });
    } catch {
      window.location.href = this.feedbackEmailUrl;
    }
  }
}
