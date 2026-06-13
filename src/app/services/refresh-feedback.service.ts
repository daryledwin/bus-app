import { Injectable } from '@angular/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { ToastController } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class RefreshFeedbackService {
  private activeToast?: HTMLIonToastElement;

  constructor(private readonly toastController: ToastController) {}

  async success(message: string): Promise<void> {
    await this.lightHaptic();
    await this.showToast(message);
  }

  async favouriteSaved(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics are a nice-to-have. Saving should never fail because of them.
    }
  }

  async lightImpact(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics are a nice-to-have. UI feedback should never fail because of them.
    }
  }

  private async lightHaptic(): Promise<void> {
    try {
      await Haptics.notification({ type: NotificationType.Success });
      console.log('Pull refresh haptic triggered');
    } catch {
      // Haptics are a nice-to-have. Refresh should never fail because of them.
    }
  }

  private async showToast(message: string): Promise<void> {
    try {
      await this.activeToast?.dismiss();

      this.activeToast = await this.toastController.create({
        message,
        duration: 1700,
        position: 'top',
        cssClass: 'mybus-refresh-toast'
      });

      this.activeToast.onDidDismiss().then(() => {
        this.activeToast = undefined;
      });

      await this.activeToast.present();
    } catch {
      // Toast feedback should not block refresh completion.
    }
  }
}
