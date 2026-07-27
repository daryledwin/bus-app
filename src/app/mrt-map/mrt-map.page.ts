import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  Optional,
  ViewChild
} from '@angular/core';
import { IonRouterOutlet, NavController } from '@ionic/angular';

import { RefreshFeedbackService } from '../services/refresh-feedback.service';
import { LtaTrainServiceAlertsService, TrainServiceAlert } from '../services/lta-train-service-alerts.service';

interface MapPinchAnchor {
  contentX: number;
  contentY: number;
}

interface MapViewportMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  baseOffsetX: number;
  baseOffsetY: number;
  maximumScale: number;
}

interface MapGestureState {
  scale: number;
  panX: number;
  panY: number;
  renderedScale: number;
  renderedPanX: number;
  renderedPanY: number;
  pinchStartDistance: number;
  pinchStartScale: number;
  pinchAnchor?: MapPinchAnchor;
  panStartX: number;
  panStartY: number;
  touchStartX: number;
  touchStartY: number;
  touchMoved: boolean;
  lastTapAt: number;
  lastTapX: number;
  lastTapY: number;
  frameId?: number;
  settleFrameId?: number;
  metrics?: MapViewportMetrics;
}

@Component({
  selector: 'app-mrt-map',
  templateUrl: 'mrt-map.page.html',
  styleUrls: ['mrt-map.page.scss']
})
export class MrtMapPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mrtMapViewer') private readonly mrtMapViewer?: ElementRef<HTMLElement>;
  @ViewChild('mrtMapCanvas') private readonly mrtMapCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mrtMapSourceImage') private readonly mrtMapSourceImage?: ElementRef<HTMLImageElement>;
  @ViewChild('mrtMapFullscreenViewer') private readonly mrtMapFullscreenViewer?: ElementRef<HTMLElement>;
  @ViewChild('mrtMapFullscreenCanvas') private readonly mrtMapFullscreenCanvas?: ElementRef<HTMLCanvasElement>;

  isLoadingMrtStatus = false;
  mrtStatusError = '';
  mrtAlerts: TrainServiceAlert[] = [];
  isMrtMapFullscreenOpen = false;
  readonly mrtMapImageUrl = 'assets/images/mrt-map-2026.png';
  private readonly mrtMapNaturalWidth = 8189;
  private readonly mrtMapNaturalHeight = 8192;
  private readonly maximumCanvasDimension = 6144;
  private isMrtMapSourceReady = false;
  private readonly inlineGesture = this.createGestureState();
  private readonly fullscreenGesture = this.createGestureState();
  private inlineGestureCleanup?: () => void;
  private fullscreenGestureCleanup?: () => void;
  private inlineMapResizeObserver?: ResizeObserver;
  private initialMapRenderFrameId?: number;
  private hasInlineMapEnteredView = false;
  private hasRenderedInitialInlineMap = false;
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
    private readonly ngZone: NgZone,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  ngOnInit(): void {
    console.log('MrtMapPage loaded');
    void this.loadMrtStatus().catch(() => undefined);
  }

  ngAfterViewInit(): void {
    this.installInlineGestureHandlers();
    this.observeInlineMapSize();

    if (this.mrtMapSourceImage?.nativeElement.complete) {
      this.onMrtMapSourceLoad();
    }
  }

  ngOnDestroy(): void {
    this.inlineGestureCleanup?.();
    this.fullscreenGestureCleanup?.();
    this.cancelGestureFrame(this.inlineGesture);
    this.cancelGestureFrame(this.fullscreenGesture);
    this.inlineMapResizeObserver?.disconnect();

    if (this.initialMapRenderFrameId !== undefined) {
      cancelAnimationFrame(this.initialMapRenderFrameId);
      this.initialMapRenderFrameId = undefined;
    }
  }

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = true;
    }
  }

  ionViewDidEnter(): void {
    this.hasInlineMapEnteredView = true;
    this.scheduleInitialInlineMapRender();
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

  openMrtMapFullscreen(): void {
    this.resetGesture(this.fullscreenGesture, this.mrtMapFullscreenCanvas?.nativeElement);
    this.isMrtMapFullscreenOpen = true;
  }

  closeMrtMapFullscreen(): void {
    this.isMrtMapFullscreenOpen = false;
    this.fullscreenGestureCleanup?.();
    this.fullscreenGestureCleanup = undefined;
    this.resetGesture(this.fullscreenGesture, this.mrtMapFullscreenCanvas?.nativeElement);
  }

  onMrtMapFullscreenDidPresent(): void {
    this.installFullscreenGestureHandlers();
  }

  onMrtMapSourceLoad(): void {
    const sourceImage = this.mrtMapSourceImage?.nativeElement;

    if (!sourceImage) {
      return;
    }

    console.log({
      src: sourceImage.currentSrc || sourceImage.src,
      naturalWidth: sourceImage.naturalWidth,
      naturalHeight: sourceImage.naturalHeight,
      width: sourceImage.width,
      height: sourceImage.height,
      devicePixelRatio: this.devicePixelRatio()
    });

    this.isMrtMapSourceReady = sourceImage.naturalWidth === this.mrtMapNaturalWidth
      && sourceImage.naturalHeight === this.mrtMapNaturalHeight;

    if (!this.isMrtMapSourceReady) {
      console.error(
        `[MRT] Expected the full-resolution ${this.mrtMapNaturalWidth}×${this.mrtMapNaturalHeight} map asset, `
        + `but loaded ${sourceImage.naturalWidth}×${sourceImage.naturalHeight}.`
      );
      return;
    }

    this.scheduleInitialInlineMapRender();
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

  private createGestureState(): MapGestureState {
    return {
      scale: 1,
      panX: 0,
      panY: 0,
      renderedScale: 1,
      renderedPanX: 0,
      renderedPanY: 0,
      pinchStartDistance: 0,
      pinchStartScale: 1,
      panStartX: 0,
      panStartY: 0,
      touchStartX: 0,
      touchStartY: 0,
      touchMoved: false,
      lastTapAt: 0,
      lastTapX: 0,
      lastTapY: 0
    };
  }

  private observeInlineMapSize(): void {
    const viewer = this.mrtMapViewer?.nativeElement;

    if (!viewer || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.inlineMapResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];

        if (entry?.contentRect.width > 0 && entry.contentRect.height > 0) {
          this.scheduleInitialInlineMapRender();
        }
      });
      this.inlineMapResizeObserver.observe(viewer);
    });
  }

  private scheduleInitialInlineMapRender(): void {
    if (
      this.hasRenderedInitialInlineMap
      || !this.hasInlineMapEnteredView
      || !this.isMrtMapSourceReady
      || this.initialMapRenderFrameId !== undefined
    ) {
      return;
    }

    this.initialMapRenderFrameId = requestAnimationFrame(() => {
      this.initialMapRenderFrameId = undefined;

      if (this.tryRenderInitialInlineMap()) {
        return;
      }

      this.scheduleInitialInlineMapRender();
    });
  }

  private tryRenderInitialInlineMap(): boolean {
    const viewer = this.mrtMapViewer?.nativeElement;
    const canvas = this.mrtMapCanvas?.nativeElement;

    if (
      !viewer
      || !canvas
      || viewer.clientWidth <= 0
      || viewer.clientHeight <= 0
      || canvas.clientWidth <= 0
      || canvas.clientHeight <= 0
    ) {
      return false;
    }

    this.inlineGesture.metrics = this.measureMap(viewer, 3);
    this.resetGesture(this.inlineGesture, canvas);
    canvas.style.visibility = 'visible';
    this.hasRenderedInitialInlineMap = true;
    this.inlineMapResizeObserver?.disconnect();
    return true;
  }

  private installInlineGestureHandlers(): void {
    const viewer = this.mrtMapViewer?.nativeElement;
    const canvas = this.mrtMapCanvas?.nativeElement;

    if (!viewer || !canvas || this.inlineGestureCleanup) {
      return;
    }

    this.inlineGesture.metrics = this.measureMap(viewer, 3);
    this.inlineGestureCleanup = this.installGestureHandlers(viewer, canvas, this.inlineGesture, 3, false);
  }

  private installFullscreenGestureHandlers(): void {
    const viewer = this.mrtMapFullscreenViewer?.nativeElement;
    const canvas = this.mrtMapFullscreenCanvas?.nativeElement;

    if (!viewer || !canvas) {
      return;
    }

    this.fullscreenGestureCleanup?.();
    this.fullscreenGesture.metrics = this.measureMap(viewer, 4);
    this.resetGesture(this.fullscreenGesture, canvas);
    this.fullscreenGestureCleanup = this.installGestureHandlers(viewer, canvas, this.fullscreenGesture, 4, true);
  }

  private installGestureHandlers(
    viewer: HTMLElement,
    canvas: HTMLCanvasElement,
    state: MapGestureState,
    interactionLimit: number,
    enableDoubleTap: boolean
  ): () => void {
    const start = (event: TouchEvent) => this.handleGestureStart(event, viewer, canvas, state, interactionLimit);
    const move = (event: TouchEvent) => this.handleGestureMove(event, canvas, state);
    const end = (event: TouchEvent) => {
      this.handleGestureEnd(event, viewer, canvas, state, interactionLimit, enableDoubleTap);
    };
    const cancel = () => this.handleGestureCancel(canvas, state);
    const doubleClick = (event: MouseEvent) => {
      event.preventDefault();
      this.prepareGestureCanvas(canvas, state);
      this.toggleGestureZoomAt(event.clientX, event.clientY, viewer, canvas, state, interactionLimit);
    };

    this.ngZone.runOutsideAngular(() => {
      viewer.addEventListener('touchstart', start, { passive: true });
      viewer.addEventListener('touchmove', move, { passive: false });
      viewer.addEventListener('touchend', end, { passive: false });
      viewer.addEventListener('touchcancel', cancel, { passive: true });

      if (enableDoubleTap) {
        viewer.addEventListener('dblclick', doubleClick);
      }
    });

    return () => {
      viewer.removeEventListener('touchstart', start);
      viewer.removeEventListener('touchmove', move);
      viewer.removeEventListener('touchend', end);
      viewer.removeEventListener('touchcancel', cancel);
      viewer.removeEventListener('dblclick', doubleClick);
    };
  }

  private handleGestureStart(
    event: TouchEvent,
    viewer: HTMLElement,
    canvas: HTMLCanvasElement,
    state: MapGestureState,
    interactionLimit: number
  ): void {
    this.prepareGestureCanvas(canvas, state);
    state.touchMoved = false;
    state.metrics = this.measureMap(viewer, interactionLimit);

    if (event.touches.length === 2) {
      const midpoint = this.touchMidpoint(event.touches[0], event.touches[1]);
      const metrics = state.metrics;
      state.pinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
      state.pinchStartScale = state.scale;
      state.pinchAnchor = {
        contentX: (midpoint.x - metrics.left - metrics.baseOffsetX - state.panX) / state.scale,
        contentY: (midpoint.y - metrics.top - metrics.baseOffsetY - state.panY) / state.scale
      };
      return;
    }

    if (event.touches.length === 1) {
      state.touchStartX = event.touches[0].clientX;
      state.touchStartY = event.touches[0].clientY;
      state.panStartX = state.panX;
      state.panStartY = state.panY;
    }
  }

  private handleGestureMove(event: TouchEvent, canvas: HTMLCanvasElement, state: MapGestureState): void {
    const metrics = state.metrics;

    if (!metrics) {
      return;
    }

    if (event.touches.length === 2 && state.pinchStartDistance > 0 && state.pinchAnchor) {
      event.preventDefault();
      state.touchMoved = true;
      const distance = this.touchDistance(event.touches[0], event.touches[1]);
      const midpoint = this.touchMidpoint(event.touches[0], event.touches[1]);
      state.scale = this.clamp(
        state.pinchStartScale * (distance / state.pinchStartDistance),
        1,
        metrics.maximumScale
      );
      state.panX = midpoint.x - metrics.left - metrics.baseOffsetX - state.pinchAnchor.contentX * state.scale;
      state.panY = midpoint.y - metrics.top - metrics.baseOffsetY - state.pinchAnchor.contentY * state.scale;
      this.clampGesturePan(state);
      this.scheduleGestureTransform(canvas, state);
      return;
    }

    if (event.touches.length === 1 && state.scale > 1) {
      event.preventDefault();
      const deltaX = event.touches[0].clientX - state.touchStartX;
      const deltaY = event.touches[0].clientY - state.touchStartY;
      state.touchMoved = Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
      state.panX = state.panStartX + deltaX;
      state.panY = state.panStartY + deltaY;
      this.clampGesturePan(state);
      this.scheduleGestureTransform(canvas, state);
    }
  }

  private handleGestureEnd(
    event: TouchEvent,
    viewer: HTMLElement,
    canvas: HTMLCanvasElement,
    state: MapGestureState,
    interactionLimit: number,
    enableDoubleTap: boolean
  ): void {
    const endedTouch = event.changedTouches.item(0);
    state.pinchStartDistance = 0;
    state.pinchAnchor = undefined;

    if (state.scale <= 1.02) {
      state.scale = 1;
      state.panX = 0;
      state.panY = 0;
      this.scheduleGestureTransform(canvas, state);
    } else {
      this.clampGesturePan(state);
      this.scheduleGestureTransform(canvas, state);
    }

    if (event.touches.length === 1) {
      state.touchStartX = event.touches[0].clientX;
      state.touchStartY = event.touches[0].clientY;
      state.panStartX = state.panX;
      state.panStartY = state.panY;
      return;
    }

    this.settleMapCanvas(canvas, state);

    if (!enableDoubleTap || !endedTouch || state.touchMoved || event.touches.length) {
      return;
    }

    const now = Date.now();
    const isDoubleTap = now - state.lastTapAt < 280
      && Math.abs(endedTouch.clientX - state.lastTapX) < 36
      && Math.abs(endedTouch.clientY - state.lastTapY) < 36;

    state.lastTapAt = now;
    state.lastTapX = endedTouch.clientX;
    state.lastTapY = endedTouch.clientY;

    if (isDoubleTap) {
      event.preventDefault();
      this.toggleGestureZoomAt(endedTouch.clientX, endedTouch.clientY, viewer, canvas, state, interactionLimit);
      state.lastTapAt = 0;
    }
  }

  private handleGestureCancel(canvas: HTMLCanvasElement, state: MapGestureState): void {
    state.pinchStartDistance = 0;
    state.pinchAnchor = undefined;
    state.touchMoved = false;
    this.settleMapCanvas(canvas, state);
  }

  private toggleGestureZoomAt(
    clientX: number,
    clientY: number,
    viewer: HTMLElement,
    canvas: HTMLCanvasElement,
    state: MapGestureState,
    interactionLimit: number
  ): void {
    if (state.scale > 1.05) {
      this.resetGesture(state, canvas);
      return;
    }

    state.metrics = this.measureMap(viewer, interactionLimit);
    const metrics = state.metrics;
    const tapX = (clientX - metrics.left - metrics.baseOffsetX - state.panX) / state.scale;
    const tapY = (clientY - metrics.top - metrics.baseOffsetY - state.panY) / state.scale;
    state.scale = Math.min(2.35, metrics.maximumScale);
    state.panX = clientX - metrics.left - metrics.baseOffsetX - tapX * state.scale;
    state.panY = clientY - metrics.top - metrics.baseOffsetY - tapY * state.scale;
    this.clampGesturePan(state);
    this.scheduleGestureTransform(canvas, state);
    this.settleMapCanvas(canvas, state);
  }

  private measureMap(
    viewer: HTMLElement,
    interactionLimit: number
  ): MapViewportMetrics {
    const viewerRect = viewer.getBoundingClientRect();
    const width = viewer.clientWidth;
    const height = viewer.clientHeight;
    const contentWidth = width;
    const contentHeight = contentWidth * (this.mrtMapNaturalHeight / this.mrtMapNaturalWidth);
    const left = viewerRect.left + viewer.clientLeft;
    const top = viewerRect.top + viewer.clientTop;
    const baseOffsetX = (width - contentWidth) / 2;
    const baseOffsetY = (height - contentHeight) / 2;
    const devicePixelRatio = this.devicePixelRatio();
    const sourceImage = this.mrtMapSourceImage?.nativeElement;
    const nativeWidthScale = sourceImage?.naturalWidth
      ? sourceImage.naturalWidth / (Math.max(1, contentWidth) * devicePixelRatio)
      : interactionLimit;
    const nativeHeightScale = sourceImage?.naturalHeight
      ? sourceImage.naturalHeight / (Math.max(1, contentHeight) * devicePixelRatio)
      : interactionLimit;

    return {
      left,
      top,
      width,
      height,
      contentWidth,
      contentHeight,
      baseOffsetX,
      baseOffsetY,
      maximumScale: Math.max(1, Math.min(interactionLimit, nativeWidthScale, nativeHeightScale))
    };
  }

  private clampGesturePan(state: MapGestureState): void {
    const metrics = state.metrics;

    if (!metrics || state.scale <= 1) {
      state.panX = 0;
      state.panY = 0;
      return;
    }

    state.panX = this.clampMapAxis(
      state.panX,
      metrics.contentWidth * state.scale,
      metrics.width,
      metrics.baseOffsetX
    );
    state.panY = this.clampMapAxis(
      state.panY,
      metrics.contentHeight * state.scale,
      metrics.height,
      metrics.baseOffsetY
    );
  }

  private clampMapAxis(
    pan: number,
    scaledContentSize: number,
    viewportSize: number,
    baseOffset: number
  ): number {
    if (scaledContentSize <= viewportSize) {
      return this.alignToDevicePixel((viewportSize - scaledContentSize) / 2 - baseOffset);
    }

    const minPan = viewportSize - baseOffset - scaledContentSize;
    const maxPan = -baseOffset;
    const clampedPan = this.clamp(pan, minPan, maxPan);
    const alignedPan = this.alignToDevicePixel(clampedPan);

    return alignedPan >= minPan && alignedPan <= maxPan ? alignedPan : clampedPan;
  }

  private scheduleGestureTransform(canvas: HTMLCanvasElement, state: MapGestureState): void {
    if (state.frameId !== undefined) {
      return;
    }

    state.frameId = requestAnimationFrame(() => {
      state.frameId = undefined;
      const metrics = state.metrics;

      if (!metrics) {
        return;
      }

      const relativeScale = state.scale / state.renderedScale;
      const translateX = metrics.baseOffsetX + state.panX
        - relativeScale * (metrics.baseOffsetX + state.renderedPanX);
      const translateY = metrics.baseOffsetY + state.panY
        - relativeScale * (metrics.baseOffsetY + state.renderedPanY);
      canvas.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${relativeScale})`;
    });
  }

  private resetGesture(state: MapGestureState, canvas?: HTMLCanvasElement): void {
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    state.pinchStartDistance = 0;
    state.pinchAnchor = undefined;
    state.touchMoved = false;
    state.lastTapAt = 0;

    if (canvas) {
      this.scheduleGestureTransform(canvas, state);
      this.settleMapCanvas(canvas, state);
    }
  }

  private prepareGestureCanvas(canvas: HTMLCanvasElement, state: MapGestureState): void {
    if (state.settleFrameId !== undefined) {
      cancelAnimationFrame(state.settleFrameId);
      state.settleFrameId = undefined;
    }

    canvas.style.willChange = 'transform';
  }

  private settleMapCanvas(canvas: HTMLCanvasElement, state: MapGestureState): void {
    if (state.frameId !== undefined) {
      cancelAnimationFrame(state.frameId);
      state.frameId = undefined;
    }

    this.renderMapCanvas(canvas, state);

    if (state.settleFrameId !== undefined) {
      cancelAnimationFrame(state.settleFrameId);
    }

    state.settleFrameId = requestAnimationFrame(() => {
      state.settleFrameId = requestAnimationFrame(() => {
        state.settleFrameId = undefined;
        canvas.style.willChange = 'auto';
      });
    });
  }

  private renderMapCanvas(canvas: HTMLCanvasElement, state: MapGestureState): void {
    const sourceImage = this.mrtMapSourceImage?.nativeElement;
    const metrics = state.metrics;

    if (!this.isMrtMapSourceReady || !sourceImage || !metrics) {
      return;
    }

    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;

    if (!cssWidth || !cssHeight) {
      return;
    }

    const devicePixelRatio = this.devicePixelRatio();
    const uncappedBackingWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    const uncappedBackingHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
    const backingLimitScale = Math.min(
      1,
      this.maximumCanvasDimension / Math.max(uncappedBackingWidth, uncappedBackingHeight)
    );
    const backingWidth = Math.max(1, Math.round(uncappedBackingWidth * backingLimitScale));
    const backingHeight = Math.max(1, Math.round(uncappedBackingHeight * backingLimitScale));

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    const context = canvas.getContext('2d', { alpha: false });

    if (!context) {
      return;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, backingWidth, backingHeight);

    const mapLeft = metrics.baseOffsetX + state.panX;
    const mapTop = metrics.baseOffsetY + state.panY;
    const visibleContentLeft = this.clamp(-mapLeft / state.scale, 0, metrics.contentWidth);
    const visibleContentTop = this.clamp(-mapTop / state.scale, 0, metrics.contentHeight);
    const visibleContentRight = this.clamp(
      (metrics.width - mapLeft) / state.scale,
      0,
      metrics.contentWidth
    );
    const visibleContentBottom = this.clamp(
      (metrics.height - mapTop) / state.scale,
      0,
      metrics.contentHeight
    );
    const sourceX = visibleContentLeft / metrics.contentWidth * sourceImage.naturalWidth;
    const sourceY = visibleContentTop / metrics.contentHeight * sourceImage.naturalHeight;
    const sourceWidth = (visibleContentRight - visibleContentLeft)
      / metrics.contentWidth * sourceImage.naturalWidth;
    const sourceHeight = (visibleContentBottom - visibleContentTop)
      / metrics.contentHeight * sourceImage.naturalHeight;
    const backingScaleX = backingWidth / cssWidth;
    const backingScaleY = backingHeight / cssHeight;
    const destinationX = (mapLeft + visibleContentLeft * state.scale) * backingScaleX;
    const destinationY = (mapTop + visibleContentTop * state.scale) * backingScaleY;
    const destinationWidth = (visibleContentRight - visibleContentLeft)
      * state.scale * backingScaleX;
    const destinationHeight = (visibleContentBottom - visibleContentTop)
      * state.scale * backingScaleY;

    if (sourceWidth > 0 && sourceHeight > 0 && destinationWidth > 0 && destinationHeight > 0) {
      context.drawImage(
        sourceImage,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight
      );
    }

    state.renderedScale = state.scale;
    state.renderedPanX = state.panX;
    state.renderedPanY = state.panY;
    canvas.style.transform = 'translate3d(0, 0, 0) scale(1)';
  }

  private cancelGestureFrame(state: MapGestureState): void {
    if (state.frameId !== undefined) {
      cancelAnimationFrame(state.frameId);
      state.frameId = undefined;
    }

    if (state.settleFrameId !== undefined) {
      cancelAnimationFrame(state.settleFrameId);
      state.settleFrameId = undefined;
    }
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
