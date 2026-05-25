import { Component, OnDestroy, OnInit } from '@angular/core';

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
  }

  private randomTagline(): string {
    return this.splashTaglines[Math.floor(Math.random() * this.splashTaglines.length)];
  }
}
