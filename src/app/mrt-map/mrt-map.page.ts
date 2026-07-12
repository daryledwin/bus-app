import { Component, ElementRef, OnInit, Optional, ViewChild } from '@angular/core';
import { IonRouterOutlet, NavController } from '@ionic/angular';

import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { LtaTrainServiceAlertsService, TrainServiceAlert } from '../services/lta-train-service-alerts.service';

@Component({
  selector: 'app-mrt-map',
  templateUrl: 'mrt-map.page.html',
  styleUrls: ['mrt-map.page.scss']
})
export class MrtMapPage implements OnInit {
  @ViewChild('mrtMapViewer') private readonly mrtMapViewer?: ElementRef<HTMLElement>;
  @ViewChild('mrtMapImage') private readonly mrtMapImage?: ElementRef<HTMLImageElement>;
  @ViewChild('mrtMapFullscreenViewer') private readonly mrtMapFullscreenViewer?: ElementRef<HTMLElement>;
  @ViewChild('mrtMapFullscreenImage') private readonly mrtMapFullscreenImage?: ElementRef<HTMLImageElement>;

  isLoadingMrtStatus = false;
  mrtStatusError = '';
  mrtAlerts: TrainServiceAlert[] = [];
  mrtMapScale = 1;
  mrtMapPanX = 0;
  mrtMapPanY = 0;
  isMrtMapFullscreenOpen = false;
  mrtMapFullscreenScale = 1;
  mrtMapFullscreenPanX = 0;
  mrtMapFullscreenPanY = 0;
  readonly mrtMapPdfUrl = 'assets/images/mrt%20map.pdf';
  readonly mrtMapImageUrl = 'assets/images/mrt-map.png';
  private pinchStartDistance = 0;
  private pinchStartScale = 1;
  private panStartX = 0;
  private panStartY = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private fullscreenPinchStartDistance = 0;
  private fullscreenPinchStartScale = 1;
  private fullscreenPanStartX = 0;
  private fullscreenPanStartY = 0;
  private fullscreenTouchStartX = 0;
  private fullscreenTouchStartY = 0;
  private fullscreenTouchMoved = false;
  private fullscreenLastTapAt = 0;
  private fullscreenLastTapX = 0;
  private fullscreenLastTapY = 0;
  private readonly mrtLineColors: Record<string, string> = {
    NSL: '#D42E2E',
    EWL: '#009645',
    NEL: '#9900AA',
    CCL: '#FA9E0D',
    DTL: '#005EC4',
    TEL: '#9D5B25',
    BPL: '#7A7A7A',
    STL: '#7A7A7A',
    PTL: '#7A7A7A'
  };

  constructor(
    private readonly navController: NavController,
    private readonly refreshFeedbackService: RefreshFeedbackService,
    private readonly trainServiceAlertsService: LtaTrainServiceAlertsService,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  ngOnInit(): void {
    console.log('MrtMapPage loaded');
    void this.loadMrtStatus().catch(() => undefined);
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

  get mrtMapTransform(): string {
    return `translate3d(${this.mrtMapPanX}px, ${this.mrtMapPanY}px, 0) scale(${this.mrtMapScale})`;
  }

  get mrtMapFullscreenTransform(): string {
    return `translate3d(${this.mrtMapFullscreenPanX}px, ${this.mrtMapFullscreenPanY}px, 0) scale(${this.mrtMapFullscreenScale})`;
  }

  goBack(): void {
    if (this.routerOutlet?.canGoBack()) {
      this.navController.back();
      return;
    }

    this.navController.navigateBack('/tabs/settings');
  }

  openMrtMapFullscreen(): void {
    this.resetMrtMapFullscreenZoom();
    this.isMrtMapFullscreenOpen = true;
  }

  closeMrtMapFullscreen(): void {
    this.isMrtMapFullscreenOpen = false;
    this.resetMrtMapFullscreenZoom();
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

  mrtLineStyle(alert: TrainServiceAlert): Record<string, string> {
    const color = this.mrtLineColor(alert);

    return {
      '--mrt-line-color': color,
      '--mrt-line-soft': this.hexToRgba(color, 0.1),
      '--mrt-line-softer': this.hexToRgba(color, 0.07),
      '--mrt-line-border': this.hexToRgba(color, 0.18)
    };
  }

  mrtDirectionLabel(alert: TrainServiceAlert): string {
    return alert.direction || 'Direction unavailable';
  }

  mrtStationsLabel(alert: TrainServiceAlert): string {
    return alert.stations || 'Stations unavailable';
  }

  async refreshMrtStatus(event: Event): Promise<void> {
    const refresher = event.target as HTMLIonRefresherElement | null;
    let refreshed = false;

    try {
      await this.loadMrtStatus({ force: true });
      refreshed = true;
    } catch (error) {
      console.warn('[MRT] pull-to-refresh failed', error);
    } finally {
      try {
        await refresher?.complete();
      } catch {
        // Refresher completion should never block the page after a failed refresh.
      }
    }

    if (refreshed) {
      await this.refreshFeedbackService.success('MRT status refreshed');
    }
  }

  onMrtMapTouchStart(event: TouchEvent): void {
    if (event.touches.length === 2) {
      this.pinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
      this.pinchStartScale = this.mrtMapScale;
      return;
    }

    if (event.touches.length === 1 && this.mrtMapScale > 1) {
      this.touchStartX = event.touches[0].clientX;
      this.touchStartY = event.touches[0].clientY;
      this.panStartX = this.mrtMapPanX;
      this.panStartY = this.mrtMapPanY;
    }
  }

  onMrtMapTouchMove(event: TouchEvent): void {
    if (event.touches.length === 2 && this.pinchStartDistance > 0) {
      event.preventDefault();
      const distance = this.touchDistance(event.touches[0], event.touches[1]);
      const nextScale = this.clamp(this.pinchStartScale * (distance / this.pinchStartDistance), 1, 3);

      this.mrtMapScale = nextScale;
      this.clampMapPan();
      return;
    }

    if (event.touches.length === 1 && this.mrtMapScale > 1) {
      event.preventDefault();
      this.mrtMapPanX = this.panStartX + event.touches[0].clientX - this.touchStartX;
      this.mrtMapPanY = this.panStartY + event.touches[0].clientY - this.touchStartY;
      this.clampMapPan();
    }
  }

  onMrtMapTouchEnd(): void {
    this.pinchStartDistance = 0;

    if (this.mrtMapScale <= 1.02) {
      this.mrtMapScale = 1;
      this.mrtMapPanX = 0;
      this.mrtMapPanY = 0;
      return;
    }

    this.clampMapPan();
  }

  onMrtMapFullscreenTouchStart(event: TouchEvent): void {
    this.fullscreenTouchMoved = false;

    if (event.touches.length === 2) {
      this.fullscreenPinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
      this.fullscreenPinchStartScale = this.mrtMapFullscreenScale;
      return;
    }

    if (event.touches.length === 1) {
      this.fullscreenTouchStartX = event.touches[0].clientX;
      this.fullscreenTouchStartY = event.touches[0].clientY;
      this.fullscreenPanStartX = this.mrtMapFullscreenPanX;
      this.fullscreenPanStartY = this.mrtMapFullscreenPanY;
    }
  }

  onMrtMapFullscreenTouchMove(event: TouchEvent): void {
    if (event.touches.length === 2 && this.fullscreenPinchStartDistance > 0) {
      event.preventDefault();
      this.fullscreenTouchMoved = true;
      const distance = this.touchDistance(event.touches[0], event.touches[1]);
      const nextScale = this.clamp(this.fullscreenPinchStartScale * (distance / this.fullscreenPinchStartDistance), 1, 4);

      this.mrtMapFullscreenScale = nextScale;
      this.clampFullscreenMapPan();
      return;
    }

    if (event.touches.length === 1 && this.mrtMapFullscreenScale > 1) {
      event.preventDefault();
      const deltaX = event.touches[0].clientX - this.fullscreenTouchStartX;
      const deltaY = event.touches[0].clientY - this.fullscreenTouchStartY;
      this.fullscreenTouchMoved = Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
      this.mrtMapFullscreenPanX = this.fullscreenPanStartX + deltaX;
      this.mrtMapFullscreenPanY = this.fullscreenPanStartY + deltaY;
      this.clampFullscreenMapPan();
    }
  }

  onMrtMapFullscreenTouchEnd(event: TouchEvent): void {
    const endedTouch = event.changedTouches.item(0);

    this.fullscreenPinchStartDistance = 0;

    if (this.mrtMapFullscreenScale <= 1.02) {
      this.resetMrtMapFullscreenZoom();
    } else {
      this.clampFullscreenMapPan();
    }

    if (!endedTouch || this.fullscreenTouchMoved || event.touches.length) {
      return;
    }

    const now = Date.now();
    const isDoubleTap = now - this.fullscreenLastTapAt < 280
      && Math.abs(endedTouch.clientX - this.fullscreenLastTapX) < 36
      && Math.abs(endedTouch.clientY - this.fullscreenLastTapY) < 36;

    this.fullscreenLastTapAt = now;
    this.fullscreenLastTapX = endedTouch.clientX;
    this.fullscreenLastTapY = endedTouch.clientY;

    if (isDoubleTap) {
      event.preventDefault();
      this.toggleMrtMapFullscreenZoomAt(endedTouch.clientX, endedTouch.clientY);
      this.fullscreenLastTapAt = 0;
    }
  }

  onMrtMapFullscreenTouchCancel(): void {
    this.fullscreenPinchStartDistance = 0;
    this.fullscreenTouchMoved = false;
  }

  toggleMrtMapFullscreenZoom(event: MouseEvent): void {
    this.toggleMrtMapFullscreenZoomAt(event.clientX, event.clientY);
  }

  private async loadMrtStatus(options: { force?: boolean } = {}): Promise<void> {
    if (this.isLoadingMrtStatus && !options.force) {
      return;
    }

    this.isLoadingMrtStatus = true;
    this.mrtStatusError = '';

    try {
      this.mrtAlerts = await this.trainServiceAlertsService.getTrainServiceAlerts().toPromise();
    } catch (error) {
      this.mrtAlerts = [];
      this.mrtStatusError = 'Unable to load MRT status right now.';
      throw error;
    } finally {
      this.isLoadingMrtStatus = false;
    }
  }

  private mrtLineColor(alert: TrainServiceAlert): string {
    const line = String(alert.line || '').trim().toUpperCase();

    return this.mrtLineColors[line] || '#7A7A7A';
  }

  private touchDistance(firstTouch: Touch, secondTouch: Touch): number {
    return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
  }

  private clampMapPan(): void {
    const viewer = this.mrtMapViewer?.nativeElement;

    if (!viewer || this.mrtMapScale <= 1) {
      this.mrtMapPanX = 0;
      this.mrtMapPanY = 0;
      return;
    }

    const image = this.mrtMapImage?.nativeElement;
    const renderedWidth = image?.clientWidth || viewer.clientWidth;
    const renderedHeight = image?.clientHeight || viewer.clientHeight;
    const maxPanX = Math.max(0, renderedWidth * this.mrtMapScale - viewer.clientWidth);
    const maxPanY = Math.max(0, renderedHeight * this.mrtMapScale - viewer.clientHeight);

    this.mrtMapPanX = this.clamp(this.mrtMapPanX, -maxPanX, 0);
    this.mrtMapPanY = this.clamp(this.mrtMapPanY, -maxPanY, 0);
  }

  private resetMrtMapFullscreenZoom(): void {
    this.mrtMapFullscreenScale = 1;
    this.mrtMapFullscreenPanX = 0;
    this.mrtMapFullscreenPanY = 0;
    this.fullscreenPinchStartDistance = 0;
    this.fullscreenTouchMoved = false;
    this.fullscreenLastTapAt = 0;
  }

  private toggleMrtMapFullscreenZoomAt(clientX: number, clientY: number): void {
    const viewer = this.mrtMapFullscreenViewer?.nativeElement;

    if (!viewer) {
      return;
    }

    if (this.mrtMapFullscreenScale > 1.05) {
      this.resetMrtMapFullscreenZoom();
      return;
    }

    const rect = viewer.getBoundingClientRect();
    const imageRect = this.mrtMapFullscreenImage?.nativeElement.getBoundingClientRect();
    const imageLeft = imageRect?.left ?? rect.left;
    const imageTop = imageRect?.top ?? rect.top;
    const baseOffsetX = imageLeft - rect.left;
    const baseOffsetY = imageTop - rect.top;
    const tapX = clientX - imageLeft;
    const tapY = clientY - imageTop;
    const nextScale = 2.35;

    this.mrtMapFullscreenScale = nextScale;
    this.mrtMapFullscreenPanX = viewer.clientWidth / 2 - baseOffsetX - tapX * nextScale;
    this.mrtMapFullscreenPanY = viewer.clientHeight / 2 - baseOffsetY - tapY * nextScale;
    this.clampFullscreenMapPan();
  }

  private clampFullscreenMapPan(): void {
    const viewer = this.mrtMapFullscreenViewer?.nativeElement;

    if (!viewer || this.mrtMapFullscreenScale <= 1) {
      this.mrtMapFullscreenPanX = 0;
      this.mrtMapFullscreenPanY = 0;
      return;
    }

    const image = this.mrtMapFullscreenImage?.nativeElement;
    const renderedWidth = image?.clientWidth || viewer.clientWidth;
    const renderedHeight = image?.clientHeight || viewer.clientHeight;
    const maxPanX = Math.max(0, renderedWidth * this.mrtMapFullscreenScale - viewer.clientWidth);
    const maxPanY = Math.max(0, renderedHeight * this.mrtMapFullscreenScale - viewer.clientHeight);

    this.mrtMapFullscreenPanX = this.clamp(this.mrtMapFullscreenPanX, -maxPanX, 0);
    this.mrtMapFullscreenPanY = this.clamp(this.mrtMapFullscreenPanY, -maxPanY, 0);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private hexToRgba(hex: string, alpha: number): string {
    const normalizedHex = hex.replace('#', '');
    const red = parseInt(normalizedHex.slice(0, 2), 16);
    const green = parseInt(normalizedHex.slice(2, 4), 16);
    const blue = parseInt(normalizedHex.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
}
