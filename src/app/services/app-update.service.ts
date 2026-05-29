import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { App } from '@capacitor/app';
import { environment } from '../../environments/environment';

interface AppVersionResponse {
  latestVersion: string;
  minimumSupportedVersion: string;
  updateUrl: string;
}

export interface AppUpdateStatus {
  forced: boolean;
  latestVersion: string;
  updateUrl: string;
}

@Injectable({
  providedIn: 'root'
})
export class AppUpdateService {
  private readonly endpoint = `${environment.apiBaseUrl}/api/app-version`;
  private readonly fallbackVersion = '0.0.1';
  private readonly testInstalledVersionKey = 'myBusUpdateTestVersion';
  private readonly testLatestVersionKey = 'myBusUpdateLatestVersion';
  private readonly testMinimumVersionKey = 'myBusUpdateMinimumSupportedVersion';
  private readonly testUpdateUrlKey = 'myBusUpdateUrl';

  constructor(private readonly http: HttpClient) {}

  async checkForUpdate(): Promise<AppUpdateStatus | null> {
    try {
      const [installedVersion, versionInfo] = await Promise.all([
        this.installedVersion(),
        this.versionInfo()
      ]);

      if (this.compareVersions(installedVersion, versionInfo.minimumSupportedVersion) < 0) {
        return {
          forced: true,
          latestVersion: versionInfo.latestVersion,
          updateUrl: versionInfo.updateUrl
        };
      }

      if (this.compareVersions(installedVersion, versionInfo.latestVersion) < 0) {
        return {
          forced: false,
          latestVersion: versionInfo.latestVersion,
          updateUrl: versionInfo.updateUrl
        };
      }
    } catch (error) {
      console.warn('App update check skipped:', error);
    }

    return null;
  }

  private async installedVersion(): Promise<string> {
    const testVersion = localStorage.getItem(this.testInstalledVersionKey)?.trim();

    if (testVersion) {
      return testVersion;
    }

    try {
      const info = await App.getInfo();
      return info.version || this.fallbackVersion;
    } catch {
      return this.fallbackVersion;
    }
  }

  private async versionInfo(): Promise<AppVersionResponse> {
    const response = await this.http.get<AppVersionResponse>(this.endpoint).toPromise();
    const latestVersion = localStorage.getItem(this.testLatestVersionKey)?.trim() || response?.latestVersion || this.fallbackVersion;
    const minimumSupportedVersion = localStorage.getItem(this.testMinimumVersionKey)?.trim()
      || response?.minimumSupportedVersion
      || this.fallbackVersion;
    const updateUrl = localStorage.getItem(this.testUpdateUrlKey)?.trim() || response?.updateUrl || 'https://apps.apple.com/';

    return {
      latestVersion,
      minimumSupportedVersion,
      updateUrl
    };
  }

  private compareVersions(leftVersion: string, rightVersion: string): number {
    const leftParts = this.versionParts(leftVersion);
    const rightParts = this.versionParts(rightVersion);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const left = leftParts[index] || 0;
      const right = rightParts[index] || 0;

      if (left !== right) {
        return left > right ? 1 : -1;
      }
    }

    return 0;
  }

  private versionParts(version: string): number[] {
    return String(version || '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => Number(part) || 0);
  }
}
