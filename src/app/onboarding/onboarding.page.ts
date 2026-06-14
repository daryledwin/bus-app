import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { OnboardingService } from '../services/onboarding.service';

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss']
})
export class OnboardingPage {
  isRequestingLocation = false;

  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly router: Router
  ) {}

  async allowLocation(): Promise<void> {
    if (this.isRequestingLocation) {
      return;
    }

    this.isRequestingLocation = true;
    const locationChoice = await this.onboardingService.requestLocation();
    this.finish(locationChoice);
  }

  skipLocation(): void {
    this.finish('deferred');
  }

  private finish(locationChoice: 'granted' | 'deferred' | 'denied'): void {
    this.onboardingService.complete(locationChoice);
    this.router.navigateByUrl('/tabs/tab1', { replaceUrl: true });
  }
}
