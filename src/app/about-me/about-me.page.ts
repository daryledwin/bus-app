import { Component, Optional } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { IonRouterOutlet, NavController } from '@ionic/angular';
import { ReviewService } from '../services/review.service';

@Component({
  selector: 'app-about-me',
  templateUrl: './about-me.page.html',
  styleUrls: ['./about-me.page.scss']
})
export class AboutMePage {
  private readonly linkedInUrl = 'https://www.linkedin.com/in/daryl-edwin-23375623a';
  private readonly instagramUrl = 'https://www.instagram.com/daryl.com.sg/';

  constructor(
    private readonly navController: NavController,
    private readonly reviewService: ReviewService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = true;
    }
  }

  goBack(): void {
    if (this.routerOutlet?.canGoBack()) {
      this.navController.back();
      return;
    }

    this.navController.navigateBack('/tabs/tab1');
  }

  openReviewPage(): void {
    this.reviewService.openAppStoreReviewPage();
  }

  openLinkedIn(): void {
    void this.openConnectLink(this.linkedInUrl);
  }

  openInstagram(): void {
    void this.openConnectLink(this.instagramUrl);
  }

  private async openConnectLink(url: string): Promise<void> {
    try {
      await Browser.open({ url });
    } catch {
      const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');

      if (!openedWindow) {
        window.location.href = url;
      }
    }
  }
}
