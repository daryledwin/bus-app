import { Component, ElementRef, OnInit, Optional, ViewChild } from '@angular/core';
import { IonRouterOutlet, NavController } from '@ionic/angular';

import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { LtaTrainServiceAlertsService, TrainServiceAlert } from '../services/lta-train-service-alerts.service';

interface MapPinchAnchor {
  baseOffsetX: number;
  baseOffsetY: number;
  contentX: number;
  contentY: number;
}

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
  readonly mrtMapImageUrl = 'assets/images/mrt-map-2026.png';
  private pinchStartDistance = 0;
  private pinchStartScale = 1;
  private pinchAnchor?: MapPinchAnchor;
  private panStartX = 0;
  private panStartY = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private mapBaseOffsetX = 0;
  private mapBaseOffsetY = 0;
  private fullscreenPinchStartDistance = 0;
  private fullscreenPinchStartScale = 1;
  private fullscreenPinchAnchor?: MapPinchAnchor;
  private fullscreenPanStartX = 0;
  private fullscreenPanStartY = 0;
  private fullscreenTouchStartX = 0;
  private fullscreenTouchStartY = 0;
  private fullscreenBaseOffsetX = 0;
  private fullscreenBaseOffsetY = 0;
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
    return `translate(${this.mrtMapPanX}px, ${this.mrtMapPanY}px) scale(${this.mrtMapScale})`;
  }

  get mrtMapFullscreenTransform(): string {
    return `translate(${this.mrtMapFullscreenPanX}px, ${this.mrtMapFullscreenPanY}px) scale(${this.mrtMapFullscreenScale})`;
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
      this.pinchAnchor = this.createPinchAnchor(
        this.mrtMapViewer?.nativeElement,
        this.mrtMapImage?.nativeElement,
        this.mrtMapPanX,
        this.mrtMapPanY,
        this.mrtMapScale,
        event.touches[0],
        event.touches[1]
      );

      if (this.pinchAnchor) {
        this.mapBaseOffsetX = this.pinchAnchor.baseOffsetX;
        this.mapBaseOffsetY = this.pinchAnchor.baseOffsetY;
      }
      return;
    }

    if (event.touches.length === 1 && this.mrtMapScale > 1) {
      this.captureMapBaseOffset();
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
      const maximumScale = this.maximumNativeMapScale(
        this.mrtMapViewer?.nativeElement,
        this.mrtMapImage?.nativeElement,
        this.mrtMapScale,
        3
      );
      const nextScale = this.clamp(this.pinchStartScale * (distance / this.pinchStartDistance), 1, maximumScale);
      const midpoint = this.touchMidpoint(event.touches[0], event.touches[1]);
      const viewer = this.mrtMapViewer?.nativeElement;

      if (viewer && this.pinchAnchor) {
        const rect = viewer.getBoundingClientRect();
        this.mrtMapPanX = midpoint.x - rect.left - this.pinchAnchor.baseOffsetX - this.pinchAnchor.contentX * nextScale;
        this.mrtMapPanY = midpoint.y - rect.top - this.pinchAnchor.baseOffsetY - this.pinchAnchor.contentY * nextScale;
      }

      this.mrtMapScale = nextScale;
      this.clampMapPan(this.mapBaseOffsetX, this.mapBaseOffsetY);
      return;
    }

    if (event.touches.length === 1 && this.mrtMapScale > 1) {
      event.preventDefault();
      this.mrtMapPanX = this.panStartX + event.touches[0].clientX - this.touchStartX;
      this.mrtMapPanY = this.panStartY + event.touches[0].clientY - this.touchStartY;
      this.clampMapPan(this.mapBaseOffsetX, this.mapBaseOffsetY);
    }
  }

  onMrtMapTouchEnd(event: TouchEvent): void {
    this.pinchStartDistance = 0;
    this.pinchAnchor = undefined;

    if (this.mrtMapScale <= 1.02) {
      this.mrtMapScale = 1;
      this.mrtMapPanX = 0;
      this.mrtMapPanY = 0;
      return;
    }

    this.clampMapPan(this.mapBaseOffsetX, this.mapBaseOffsetY);

    if (event.touches.length === 1) {
      this.touchStartX = event.touches[0].clientX;
      this.touchStartY = event.touches[0].clientY;
      this.panStartX = this.mrtMapPanX;
      this.panStartY = this.mrtMapPanY;
    }
  }

  onMrtMapFullscreenTouchStart(event: TouchEvent): void {
    this.fullscreenTouchMoved = false;

    if (event.touches.length === 2) {
      this.fullscreenPinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
      this.fullscreenPinchStartScale = this.mrtMapFullscreenScale;
      this.fullscreenPinchAnchor = this.createPinchAnchor(
        this.mrtMapFullscreenViewer?.nativeElement,
        this.mrtMapFullscreenImage?.nativeElement,
        this.mrtMapFullscreenPanX,
        this.mrtMapFullscreenPanY,
        this.mrtMapFullscreenScale,
        event.touches[0],
        event.touches[1]
      );

      if (this.fullscreenPinchAnchor) {
        this.fullscreenBaseOffsetX = this.fullscreenPinchAnchor.baseOffsetX;
        this.fullscreenBaseOffsetY = this.fullscreenPinchAnchor.baseOffsetY;
      }
      return;
    }

    if (event.touches.length === 1) {
      this.captureFullscreenBaseOffset();
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
      const maximumScale = this.maximumNativeMapScale(
        this.mrtMapFullscreenViewer?.nativeElement,
        this.mrtMapFullscreenImage?.nativeElement,
        this.mrtMapFullscreenScale,
        4
      );
      const nextScale = this.clamp(
        this.fullscreenPinchStartScale * (distance / this.fullscreenPinchStartDistance),
        1,
        maximumScale
      );
      const midpoint = this.touchMidpoint(event.touches[0], event.touches[1]);
      const viewer = this.mrtMapFullscreenViewer?.nativeElement;

      if (viewer && this.fullscreenPinchAnchor) {
        const rect = viewer.getBoundingClientRect();
        this.mrtMapFullscreenPanX = midpoint.x - rect.left - this.fullscreenPinchAnchor.baseOffsetX
          - this.fullscreenPinchAnchor.contentX * nextScale;
        this.mrtMapFullscreenPanY = midpoint.y - rect.top - this.fullscreenPinchAnchor.baseOffsetY
          - this.fullscreenPinchAnchor.contentY * nextScale;
      }

      this.mrtMapFullscreenScale = nextScale;
      this.clampFullscreenMapPan(this.fullscreenBaseOffsetX, this.fullscreenBaseOffsetY);
      return;
    }

    if (event.touches.length === 1 && this.mrtMapFullscreenScale > 1) {
      event.preventDefault();
      const deltaX = event.touches[0].clientX - this.fullscreenTouchStartX;
      const deltaY = event.touches[0].clientY - this.fullscreenTouchStartY;
      this.fullscreenTouchMoved = Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
      this.mrtMapFullscreenPanX = this.fullscreenPanStartX + deltaX;
      this.mrtMapFullscreenPanY = this.fullscreenPanStartY + deltaY;
      this.clampFullscreenMapPan(this.fullscreenBaseOffsetX, this.fullscreenBaseOffsetY);
    }
  }

  onMrtMapFullscreenTouchEnd(event: TouchEvent): void {
    const endedTouch = event.changedTouches.item(0);

    this.fullscreenPinchStartDistance = 0;
    this.fullscreenPinchAnchor = undefined;

    if (this.mrtMapFullscreenScale <= 1.02) {
      this.resetMrtMapFullscreenZoom();
    } else {
      this.clampFullscreenMapPan(this.fullscreenBaseOffsetX, this.fullscreenBaseOffsetY);
    }

    if (event.touches.length === 1) {
      this.fullscreenTouchStartX = event.touches[0].clientX;
      this.fullscreenTouchStartY = event.touches[0].clientY;
      this.fullscreenPanStartX = this.mrtMapFullscreenPanX;
      this.fullscreenPanStartY = this.mrtMapFullscreenPanY;
      return;
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
    this.fullscreenPinchAnchor = undefined;
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

  private touchMidpoint(firstTouch: Touch, secondTouch: Touch): { x: number; y: number } {
    return {
      x: (firstTouch.clientX + secondTouch.clientX) / 2,
      y: (firstTouch.clientY + secondTouch.clientY) / 2
    };
  }

  private createPinchAnchor(
    viewer: HTMLElement | undefined,
    image: HTMLImageElement | undefined,
    panX: number,
    panY: number,
    scale: number,
    firstTouch: Touch,
    secondTouch: Touch
  ): MapPinchAnchor | undefined {
    if (!viewer || !image) {
      return undefined;
    }

    const viewerRect = viewer.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const midpoint = this.touchMidpoint(firstTouch, secondTouch);
    const baseOffsetX = imageRect.left - viewerRect.left - panX;
    const baseOffsetY = imageRect.top - viewerRect.top - panY;

    return {
      baseOffsetX,
      baseOffsetY,
      contentX: (midpoint.x - viewerRect.left - baseOffsetX - panX) / scale,
      contentY: (midpoint.y - viewerRect.top - baseOffsetY - panY) / scale
    };
  }

  private captureMapBaseOffset(): void {
    const viewer = this.mrtMapViewer?.nativeElement;
    const image = this.mrtMapImage?.nativeElement;

    if (!viewer || !image) {
      return;
    }

    const viewerRect = viewer.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    this.mapBaseOffsetX = imageRect.left - viewerRect.left - this.mrtMapPanX;
    this.mapBaseOffsetY = imageRect.top - viewerRect.top - this.mrtMapPanY;
  }

  private clampMapPan(baseOffsetX = this.mapBaseOffsetX, baseOffsetY = this.mapBaseOffsetY): void {
    const viewer = this.mrtMapViewer?.nativeElement;
    const image = this.mrtMapImage?.nativeElement;

    if (!viewer || !image || this.mrtMapScale <= 1) {
      this.mrtMapPanX = 0;
      this.mrtMapPanY = 0;
      return;
    }

    this.mrtMapPanX = this.clampMapAxis(
      this.mrtMapPanX,
      image.clientWidth * this.mrtMapScale,
      viewer.clientWidth,
      viewer.clientLeft,
      baseOffsetX
    );
    this.mrtMapPanY = this.clampMapAxis(
      this.mrtMapPanY,
      image.clientHeight * this.mrtMapScale,
      viewer.clientHeight,
      viewer.clientTop,
      baseOffsetY
    );
  }

  private resetMrtMapFullscreenZoom(): void {
    this.mrtMapFullscreenScale = 1;
    this.mrtMapFullscreenPanX = 0;
    this.mrtMapFullscreenPanY = 0;
    this.fullscreenPinchStartDistance = 0;
    this.fullscreenPinchAnchor = undefined;
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
    const image = this.mrtMapFullscreenImage?.nativeElement;

    if (!image) {
      return;
    }

    const imageRect = image.getBoundingClientRect();
    const baseOffsetX = imageRect.left - rect.left - this.mrtMapFullscreenPanX;
    const baseOffsetY = imageRect.top - rect.top - this.mrtMapFullscreenPanY;
    const tapX = (clientX - rect.left - baseOffsetX - this.mrtMapFullscreenPanX) / this.mrtMapFullscreenScale;
    const tapY = (clientY - rect.top - baseOffsetY - this.mrtMapFullscreenPanY) / this.mrtMapFullscreenScale;
    const nextScale = Math.min(
      2.35,
      this.maximumNativeMapScale(viewer, image, this.mrtMapFullscreenScale, 4)
    );

    this.fullscreenBaseOffsetX = baseOffsetX;
    this.fullscreenBaseOffsetY = baseOffsetY;
    this.mrtMapFullscreenScale = nextScale;
    this.mrtMapFullscreenPanX = clientX - rect.left - baseOffsetX - tapX * nextScale;
    this.mrtMapFullscreenPanY = clientY - rect.top - baseOffsetY - tapY * nextScale;
    this.clampFullscreenMapPan(baseOffsetX, baseOffsetY);
  }

  private captureFullscreenBaseOffset(): void {
    const viewer = this.mrtMapFullscreenViewer?.nativeElement;
    const image = this.mrtMapFullscreenImage?.nativeElement;

    if (!viewer || !image) {
      return;
    }

    const viewerRect = viewer.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    this.fullscreenBaseOffsetX = imageRect.left - viewerRect.left - this.mrtMapFullscreenPanX;
    this.fullscreenBaseOffsetY = imageRect.top - viewerRect.top - this.mrtMapFullscreenPanY;
  }

  private clampFullscreenMapPan(
    baseOffsetX = this.fullscreenBaseOffsetX,
    baseOffsetY = this.fullscreenBaseOffsetY
  ): void {
    const viewer = this.mrtMapFullscreenViewer?.nativeElement;
    const image = this.mrtMapFullscreenImage?.nativeElement;

    if (!viewer || !image || this.mrtMapFullscreenScale <= 1) {
      this.mrtMapFullscreenPanX = 0;
      this.mrtMapFullscreenPanY = 0;
      return;
    }

    this.mrtMapFullscreenPanX = this.clampMapAxis(
      this.mrtMapFullscreenPanX,
      image.clientWidth * this.mrtMapFullscreenScale,
      viewer.clientWidth,
      viewer.clientLeft,
      baseOffsetX
    );
    this.mrtMapFullscreenPanY = this.clampMapAxis(
      this.mrtMapFullscreenPanY,
      image.clientHeight * this.mrtMapFullscreenScale,
      viewer.clientHeight,
      viewer.clientTop,
      baseOffsetY
    );
  }

  private clampMapAxis(
    pan: number,
    scaledContentSize: number,
    viewportSize: number,
    viewportStart: number,
    baseOffset: number
  ): number {
    if (scaledContentSize <= viewportSize) {
      return this.alignToDevicePixel(viewportStart + (viewportSize - scaledContentSize) / 2 - baseOffset);
    }

    const minPan = viewportStart + viewportSize - baseOffset - scaledContentSize;
    const maxPan = viewportStart - baseOffset;
    const clampedPan = this.clamp(pan, minPan, maxPan);
    const alignedPan = this.alignToDevicePixel(clampedPan);

    return alignedPan >= minPan && alignedPan <= maxPan ? alignedPan : clampedPan;
  }

  private maximumNativeMapScale(
    viewer: HTMLElement | undefined,
    image: HTMLImageElement | undefined,
    currentScale: number,
    interactionLimit: number
  ): number {
    if (!viewer || !image || !image.naturalWidth || !image.naturalHeight) {
      return interactionLimit;
    }

    const imageRect = image.getBoundingClientRect();
    const safeCurrentScale = Math.max(1, currentScale);
    const baseRenderedWidth = imageRect.width / safeCurrentScale;
    const baseRenderedHeight = imageRect.height / safeCurrentScale;
    const devicePixelRatio = this.devicePixelRatio();

    if (!baseRenderedWidth || !baseRenderedHeight) {
      return interactionLimit;
    }

    const nativeWidthScale = image.naturalWidth / (baseRenderedWidth * devicePixelRatio);
    const nativeHeightScale = image.naturalHeight / (baseRenderedHeight * devicePixelRatio);

    return Math.max(1, Math.min(interactionLimit, nativeWidthScale, nativeHeightScale));
  }

  private alignToDevicePixel(value: number): number {
    const devicePixelRatio = this.devicePixelRatio();
    return Math.round(value * devicePixelRatio) / devicePixelRatio;
  }

  private devicePixelRatio(): number {
    return typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
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
