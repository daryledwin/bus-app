import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface AppReviewPlugin {
  requestReview(): Promise<void>;
  openReviewPage(options: { url: string }): Promise<void>;
}

const AppReview = registerPlugin<AppReviewPlugin>('AppReview');

@Injectable({
  providedIn: 'root'
})
export class ReviewService {
  private readonly appStoreReviewUrl = 'https://apps.apple.com/sg/app/my-bus-sg/id6773271830?action=write-review';
  private readonly appLaunchCountKey = 'appLaunchCount';
  private readonly firstLaunchDateKey = 'firstLaunchDate';
  private readonly reviewPromptShownKey = 'reviewPromptShown';
  private readonly favouritesStorageKey = 'favouriteBusStops';
  private readonly minimumLaunches = 10;
  private readonly minimumAgeMs = 7 * 24 * 60 * 60 * 1000;

  recordLaunch(): void {
    const now = new Date();

    if (!localStorage.getItem(this.firstLaunchDateKey)) {
      localStorage.setItem(this.firstLaunchDateKey, now.toISOString());
    }

    const currentCount = Number.parseInt(localStorage.getItem(this.appLaunchCountKey) || '0', 10);
    const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
    localStorage.setItem(this.appLaunchCountKey, String(nextCount));
  }

  openAppStoreReviewPage(): void {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
      void AppReview.openReviewPage({ url: this.appStoreReviewUrl }).catch(() => this.openReviewPageInBrowser());
      return;
    }

    this.openReviewPageInBrowser();
  }

  private openReviewPageInBrowser(): void {
    const openedWindow = window.open(this.appStoreReviewUrl, '_blank', 'noopener,noreferrer');

    if (!openedWindow) {
      window.location.href = this.appStoreReviewUrl;
    }
  }

  async requestAutomaticReviewIfEligible(): Promise<void> {
    if (!this.isEligibleForAutomaticPrompt()) {
      return;
    }

    try {
      await AppReview.requestReview();
    } catch {
      // Native review prompts are best-effort. Never block arrivals or favourites.
    } finally {
      localStorage.setItem(this.reviewPromptShownKey, 'true');
    }
  }

  private isEligibleForAutomaticPrompt(): boolean {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return false;
    }

    if (localStorage.getItem(this.reviewPromptShownKey) === 'true') {
      return false;
    }

    if (this.launchCount() < this.minimumLaunches) {
      return false;
    }

    if (Date.now() - this.firstLaunchTime() < this.minimumAgeMs) {
      return false;
    }

    return this.hasFavouriteStop();
  }

  private launchCount(): number {
    const count = Number.parseInt(localStorage.getItem(this.appLaunchCountKey) || '0', 10);
    return Number.isFinite(count) ? count : 0;
  }

  private firstLaunchTime(): number {
    const storedDate = localStorage.getItem(this.firstLaunchDateKey);
    const launchTime = storedDate ? Date.parse(storedDate) : Date.now();
    return Number.isFinite(launchTime) ? launchTime : Date.now();
  }

  private hasFavouriteStop(): boolean {
    try {
      const favourites = JSON.parse(localStorage.getItem(this.favouritesStorageKey) || '[]');
      return Array.isArray(favourites) && favourites.length > 0;
    } catch {
      return false;
    }
  }
}
