import { Component, OnDestroy, OnInit } from '@angular/core';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  splashVisible = true;
  splashLeaving = false;
  splashTagline = '';

  private splashExitTimer?: ReturnType<typeof setTimeout>;
  private splashRemoveTimer?: ReturnType<typeof setTimeout>;
  private backendKeepAliveTimer?: ReturnType<typeof setInterval>;
  private readonly visibilityChangeHandler = () => {
    if (!document.hidden) {
      this.warmBackend();
    }
  };

  private readonly splashTaglines = [
    'your next ride, lowk stress free.',
    'settle in, we busin 🚌',
    'good commute energy only',
    'okay let’s go already',
    'calm rides. less pain.',
    'making SG commutes less sian',
    'bus 67 kinda day',
    'moving softly through singapore',
    'one more ride then home',
    'no rush, bus coming'
  ];

  ngOnInit(): void {
    this.splashTagline = this.randomTagline();
    this.warmBackend();
    this.backendKeepAliveTimer = setInterval(() => this.warmBackend(), 240000);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);

    this.splashExitTimer = setTimeout(() => {
      this.splashLeaving = true;
    }, 2450);
    this.splashRemoveTimer = setTimeout(() => {
      this.splashVisible = false;
    }, 3050);
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

    document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
  }

  private randomTagline(): string {
    return this.splashTaglines[Math.floor(Math.random() * this.splashTaglines.length)];
  }

  private warmBackend(): void {
    fetch(`${environment.apiBaseUrl}/health`, { cache: 'no-store' }).catch(() => {
      // Best-effort keep-alive only; arrival searches still handle errors normally.
    });
  }
}
