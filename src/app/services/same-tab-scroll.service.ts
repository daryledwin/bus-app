import { Injectable, NgZone } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { IonContent } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class SameTabScrollService {
  constructor(private readonly ngZone: NgZone) {}

  async toTop(content?: IonContent): Promise<boolean> {
    if (!content) {
      return false;
    }

    const scrollElement = await content.getScrollElement();
    const startTop = scrollElement.scrollTop;

    if (startTop <= 6) {
      return false;
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : Capacitor.isNativePlatform() ? 280 : 420;
    await this.ngZone.runOutsideAngular(() => content.scrollToTop(duration));

    return true;
  }
}
