import { Component, OnInit, Optional } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IonRouterOutlet, NavController } from '@ionic/angular';

import { LtaTrainServiceAlertsService, TrainServiceAlert } from '../services/lta-train-service-alerts.service';

@Component({
  selector: 'app-mrt-map',
  templateUrl: 'mrt-map.page.html',
  styleUrls: ['mrt-map.page.scss']
})
export class MrtMapPage implements OnInit {
  isLoadingMrtStatus = false;
  mrtStatusError = '';
  mrtAlerts: TrainServiceAlert[] = [];
  readonly mrtMapPdfUrl = 'assets/images/mrt%20map.pdf';
  readonly trustedMrtMapPdfUrl: SafeResourceUrl;

  constructor(
    private readonly navController: NavController,
    private readonly sanitizer: DomSanitizer,
    private readonly trainServiceAlertsService: LtaTrainServiceAlertsService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {
    this.trustedMrtMapPdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.mrtMapPdfUrl);
  }

  ngOnInit(): void {
    console.log('MrtMapPage loaded');
    this.loadMrtStatus();
  }

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = true;
    }
  }

  get majorMrtAlerts(): TrainServiceAlert[] {
    return this.mrtAlerts.filter((alert) => alert.status === 2);
  }

  get hasMrtDisruption(): boolean {
    return this.majorMrtAlerts.length > 0;
  }

  goBack(): void {
    if (this.routerOutlet?.canGoBack()) {
      this.navController.back();
      return;
    }

    this.navController.navigateBack('/tabs/settings');
  }

  mrtUpdatedLabel(alerts = this.majorMrtAlerts.length ? this.majorMrtAlerts : this.mrtAlerts): string {
    const latestCreatedDate = alerts
      .map((alert) => alert.createdDate)
      .filter((date): date is string => !!date)
      .sort()
      .pop();

    if (!latestCreatedDate) {
      return 'Updated just now';
    }

    const timestamp = new Date(latestCreatedDate).getTime();

    if (Number.isNaN(timestamp)) {
      return 'Updated just now';
    }

    const minutesAgo = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));

    if (minutesAgo < 1) {
      return 'Updated just now';
    }

    if (minutesAgo < 60) {
      return `Updated ${minutesAgo} min ago`;
    }

    return `Updated ${new Date(latestCreatedDate).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit'
    })}`;
  }

  mrtLineLabel(alert: TrainServiceAlert): string {
    return alert.line || 'MRT';
  }

  mrtDirectionLabel(alert: TrainServiceAlert): string {
    return alert.direction || 'Direction unavailable';
  }

  mrtStationsLabel(alert: TrainServiceAlert): string {
    return alert.stations || 'Stations unavailable';
  }

  private loadMrtStatus(): void {
    if (this.isLoadingMrtStatus) {
      return;
    }

    this.isLoadingMrtStatus = true;
    this.mrtStatusError = '';

    this.trainServiceAlertsService.getTrainServiceAlerts().subscribe({
      next: (alerts) => {
        this.mrtAlerts = alerts;
        this.isLoadingMrtStatus = false;
      },
      error: () => {
        this.mrtAlerts = [];
        this.mrtStatusError = 'Unable to load MRT status right now.';
        this.isLoadingMrtStatus = false;
      }
    });
  }
}
