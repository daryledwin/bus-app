import { Injectable } from '@angular/core';
import { IonContent } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class SameTabScrollService {
  private animationId = 0;
  private readonly activeAnimations = new WeakMap<HTMLElement, number>();

  async toTop(content?: IonContent): Promise<boolean> {
    if (!content) {
      return false;
    }

    const scrollElement = await content.getScrollElement();
    const startTop = scrollElement.scrollTop;

    if (startTop <= 6) {
      return false;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      scrollElement.scrollTop = 0;
      return true;
    }

    const duration = Math.min(780, 560 + (startTop * 0.12));
    const startedAt = performance.now();
    const animationId = ++this.animationId;
    this.activeAnimations.set(scrollElement, animationId);

    await new Promise<void>((resolve) => {
      const animate = (now: number) => {
        if (this.activeAnimations.get(scrollElement) !== animationId) {
          resolve();
          return;
        }

        const progress = Math.min((now - startedAt) / duration, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        scrollElement.scrollTop = startTop * (1 - easedProgress);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.activeAnimations.delete(scrollElement);
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });

    return true;
  }
}
