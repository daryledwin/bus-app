import { Injectable } from '@angular/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { AlertController } from '@ionic/angular';

interface ItunesLookupResponse {
  resultCount?: number;
  results?: ItunesLookupResult[];
}

interface ItunesLookupResult {
  version?: string;
  trackViewUrl?: string;
}

const TEST_APP_STORE_VERSION_OVERRIDE: string | undefined = undefined;

@Injectable({
  providedIn: 'root'
})
export class AppUpdateService {
  private readonly lookupUrl = 'https://itunes.apple.com/lookup?bundleId=com.daryledwin.bus&country=sg';
  private hasCheckedThisLaunch = false;

  constructor(private readonly alertController: AlertController) {}

  async checkForAppStoreUpdate(): Promise<void> {
    if (this.hasCheckedThisLaunch) {
      return;
    }

    this.hasCheckedThisLaunch = true;

    try {
      const appInfo = await App.getInfo();
      const currentVersion = appInfo.version;
      const response = await fetch(this.lookupUrl, { cache: 'no-store' });

      if (!response.ok) {
        return;
      }

      const lookup = await response.json() as ItunesLookupResponse;
      const appStoreResult = lookup.results?.[0];
      const appStoreVersion = TEST_APP_STORE_VERSION_OVERRIDE || appStoreResult?.version;
      const appStoreUrl = appStoreResult?.trackViewUrl;

      if (!currentVersion || !appStoreVersion || !appStoreUrl) {
        return;
      }

      if (!this.isNewerVersion(appStoreVersion, currentVersion)) {
        return;
      }

      await this.showUpdateAlert(appStoreUrl);
    } catch {
      // Update checks are best-effort and should never block app usage.
    }
  }

  private async showUpdateAlert(appStoreUrl: string): Promise<void> {
    const alert = await this.alertController.create({
      cssClass: 'mybus-update-alert',
      header: 'Update Available',
      message: 'A newer version of MyBus SG is available on the App Store.',
      buttons: [
        {
          cssClass: 'mybus-update-alert__later',
          text: 'Later',
          role: 'cancel'
        },
        {
          cssClass: 'mybus-update-alert__update',
          text: 'Update',
          handler: () => {
            void this.openAppStore(appStoreUrl);
          }
        }
      ]
    });

    await alert.present();
  }

  private async openAppStore(appStoreUrl: string): Promise<void> {
    try {
      await Browser.open({ url: appStoreUrl });
    } catch {
      window.location.href = appStoreUrl;
    }
  }

  private isNewerVersion(appStoreVersion: string, currentVersion: string): boolean {
    const appStoreParts = this.versionParts(appStoreVersion);
    const currentParts = this.versionParts(currentVersion);
    const length = Math.max(appStoreParts.length, currentParts.length);

    for (let index = 0; index < length; index++) {
      const appStorePart = appStoreParts[index] || 0;
      const currentPart = currentParts[index] || 0;

      if (appStorePart > currentPart) {
        return true;
      }

      if (appStorePart < currentPart) {
        return false;
      }
    }

    return false;
  }

  private versionParts(version: string): number[] {
    return version
      .split('.')
      .map((part) => Number.parseInt(part.replace(/\D.*$/, ''), 10))
      .map((part) => Number.isFinite(part) ? part : 0);
  }
}
