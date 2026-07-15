import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { BusArrivalLookup, BusServiceArrival, LtaBusService } from './lta-bus.service';
import { BusLiveActivityPayload, BusLiveActivityRestoreActivity, WidgetBridgeService } from './widget-bridge.service';

export interface LiveActivityTrackingState {
  active: boolean;
  serviceNo: string;
  busStopCode: string;
  busStopName: string;
  arrivalStatus: string;
  nextArrivalTiming: string;
  thirdArrivalTiming: string;
  busType: string;
  wheelchairAccessible: boolean;
  seatAvailability: string;
  arrivalAt: number;
  lastUpdatedAt: number;
  startedAt: number;
  expiresAt: number;
}

export type LiveTrackDebugStage =
  | 'timer'
  | 'httpRequest'
  | 'httpResponse'
  | 'trackedService'
  | 'bridgeUpdate'
  | 'nativeUpdate';

export interface LiveTrackDebugStep {
  label: string;
  ok: boolean | null;
  at: number;
  detail: string;
}

export type LiveTrackDebugState = Record<LiveTrackDebugStage, LiveTrackDebugStep>;

const inactiveTrackingState: LiveActivityTrackingState = {
  active: false,
  serviceNo: '',
  busStopCode: '',
  busStopName: '',
  arrivalStatus: '',
  nextArrivalTiming: '',
  thirdArrivalTiming: '',
  busType: '',
  wheelchairAccessible: false,
  seatAvailability: '',
  arrivalAt: 0,
  lastUpdatedAt: 0,
  startedAt: 0,
  expiresAt: 0
};

const initialDebugState: LiveTrackDebugState = {
  timer: {
    label: '1. Timer tick',
    ok: null,
    at: 0,
    detail: 'Waiting for tracking'
  },
  httpRequest: {
    label: '2. HTTP request sent',
    ok: null,
    at: 0,
    detail: 'Waiting for request'
  },
  httpResponse: {
    label: '3. HTTP response',
    ok: null,
    at: 0,
    detail: 'Waiting for response'
  },
  trackedService: {
    label: '4. Tracked service found',
    ok: null,
    at: 0,
    detail: 'Waiting for service lookup'
  },
  bridgeUpdate: {
    label: '5. updateBusLiveActivity called',
    ok: null,
    at: 0,
    detail: 'Waiting for bridge call'
  },
  nativeUpdate: {
    label: '6. Activity.update completed',
    ok: null,
    at: 0,
    detail: 'Waiting for native completion'
  }
};

@Injectable({
  providedIn: 'root'
})
export class LiveActivityTrackingService {
  private readonly trackingStateSubject = new BehaviorSubject<LiveActivityTrackingState>(inactiveTrackingState);
  private readonly debugStateSubject = new BehaviorSubject<LiveTrackDebugState>(initialDebugState);
  private readonly pollIntervalMs = 15 * 1000;
  private readonly pollRequestTimeoutMs = 24 * 1000;
  // Foreground polling updates the Live Activity only while the app is active. Background and Lock Screen updates require ActivityKit push notifications through APNs.
  private trackingTimeout?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private pollWatchdogTimer?: ReturnType<typeof setInterval>;
  private pollInProgress = false;
  private pollTickCount = 0;
  private appIsActive = true;
  private webViewVisible = typeof document === 'undefined' ? true : !document.hidden;
  private appStateListener?: { remove: () => Promise<void> };
  private pushTokenListener?: PluginListenerHandle;
  private activeActivityId = '';
  private readonly pendingPushTokens = new Map<string, string>();
  private readonly trackedActivities = new Map<string, BusLiveActivityRestoreActivity>();

  readonly trackingState$ = this.trackingStateSubject.asObservable();
  readonly debugState$ = this.debugStateSubject.asObservable();

  constructor(
    private readonly http: HttpClient,
    private readonly widgetBridgeService: WidgetBridgeService,
    private readonly ltaBusService: LtaBusService
  ) {
    if (environment.liveActivitiesEnabled) {
      this.registerForegroundListener();
      this.registerVisibilityListener();
      this.registerPushTokenListener();
      void this.restoreActiveLiveActivity('launch');
    }
  }

  get currentState(): LiveActivityTrackingState {
    return this.trackingStateSubject.value;
  }

  markDebug(stage: LiveTrackDebugStage, ok: boolean, detail: string): void {
    const current = this.debugStateSubject.value;

    this.debugStateSubject.next({
      ...current,
      [stage]: {
        ...current[stage],
        ok,
        at: Date.now(),
        detail
      }
    });
  }

  isTracking(busStopCode: string, serviceNo: string): boolean {
    const normalizedServiceNo = serviceNo.trim().toUpperCase();
    return Array.from(this.trackedActivities.values()).some((activity) => (
      activity.busStopCode === busStopCode.trim()
      && activity.serviceNo.trim().toUpperCase() === normalizedServiceNo
    ));
  }

  async start(payload: BusLiveActivityPayload): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    this.debugStateSubject.next(initialDebugState);
    const startResult = await this.widgetBridgeService.startBusLiveActivity(payload);

    if (!startResult?.started || !startResult.activityId) {
      console.warn('[LiveTrack] Activity start did not return an active activity ID', startResult);
      return false;
    }

    this.activeActivityId = startResult?.activityId || '';
    this.trackedActivities.set(this.activeActivityId, {
      ...payload,
      activityId: this.activeActivityId,
      pushToken: startResult.pushToken,
      apnsEnvironment: startResult.apnsEnvironment
    });
    this.setStateFromPayload(payload);
    console.debug('[LiveTrack] tracking started', {
      serviceNo: payload.serviceNo,
      busStopCode: payload.busStopCode,
      arrivalStatus: payload.arrivalStatus,
      lastUpdatedAt: payload.lastUpdatedAt,
      activityId: this.activeActivityId,
      pushEnabled: Boolean(startResult.pushEnabled),
      pushTokenPending: Boolean(startResult.pushTokenPending),
      hasPushToken: Boolean(startResult.pushToken)
    });

    if (startResult.pushToken) {
      console.debug('[LiveTrack] push token received');
      void this.registerPushUpdateSession(startResult.activityId, startResult.pushToken, payload, startResult.apnsEnvironment);
    } else if (startResult.pushEnabled) {
      const pendingPushToken = this.pendingPushTokens.get(startResult.activityId);

      if (pendingPushToken) {
        this.pendingPushTokens.delete(startResult.activityId);
        void this.registerPushUpdateSession(startResult.activityId, pendingPushToken, payload, startResult.apnsEnvironment);
      } else {
        console.debug('[LiveTrack] push token pending', {
          activityId: startResult.activityId
        });
      }
    }

    return true;
  }

  async update(payload: BusLiveActivityPayload): Promise<void> {
    const state = this.currentState;
    const normalizedStateStopCode = state.busStopCode.trim();
    const normalizedPayloadStopCode = payload.busStopCode.trim();
    const normalizedStateServiceNo = state.serviceNo.trim().toUpperCase();
    const normalizedPayloadServiceNo = payload.serviceNo.trim().toUpperCase();

    if (!state.active) {
      this.markDebug('bridgeUpdate', false, `inactive state for ${payload.serviceNo}`);
      console.debug('[LiveTrack] native update skipped: inactive tracking state', {
        payloadServiceNo: payload.serviceNo,
        payloadBusStopCode: payload.busStopCode
      });
      return;
    }

    if (normalizedStateStopCode !== normalizedPayloadStopCode || normalizedStateServiceNo !== normalizedPayloadServiceNo) {
      this.markDebug('bridgeUpdate', false, `mismatch state ${state.serviceNo}/${state.busStopCode}, payload ${payload.serviceNo}/${payload.busStopCode}`);
      console.debug('[LiveTrack] native update skipped: state/payload mismatch', {
        stateServiceNo: state.serviceNo,
        payloadServiceNo: payload.serviceNo,
        stateBusStopCode: state.busStopCode,
        payloadBusStopCode: payload.busStopCode
      });
      return;
    }

    if (Date.now() >= state.expiresAt) {
      this.markDebug('bridgeUpdate', false, `expired ${state.serviceNo} at ${new Date(state.expiresAt).toLocaleTimeString('en-SG')}`);
      console.debug('[LiveTrack] native update skipped: tracking expired', {
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode,
        expiresAt: state.expiresAt
      });
      await this.end(false);
      return;
    }

    console.debug('[LiveTrack] calling native update', {
      serviceNo: payload.serviceNo,
      busStopCode: payload.busStopCode,
      arrivalStatus: payload.arrivalStatus,
      lastUpdatedAt: payload.lastUpdatedAt
    });
    this.markDebug('bridgeUpdate', true, `${payload.serviceNo} ${payload.arrivalStatus} @ ${new Date(payload.lastUpdatedAt).toLocaleTimeString('en-SG')}`);
    try {
      await this.widgetBridgeService.updateBusLiveActivity(payload);
      this.markDebug('nativeUpdate', true, `${payload.serviceNo} Activity.update resolved @ ${new Date(payload.lastUpdatedAt).toLocaleTimeString('en-SG')}`);
    } catch (error) {
      this.markDebug('nativeUpdate', false, error instanceof Error ? error.message : String(error));
      throw error;
    }
    console.debug('[LiveTrack] native update success', {
      serviceNo: payload.serviceNo,
      busStopCode: payload.busStopCode,
      lastUpdatedAt: payload.lastUpdatedAt
    });
    this.setStateFromPayload(payload);
  }

  async end(endNative = true, activityId = this.activeActivityId): Promise<void> {
    if (!activityId) {
      return;
    }
    await this.clearNativeActivity(endNative, activityId);
  }

  async endTracking(busStopCode: string, serviceNo: string): Promise<void> {
    const normalizedServiceNo = serviceNo.trim().toUpperCase();
    const match = Array.from(this.trackedActivities.values()).find((activity) => (
      activity.busStopCode === busStopCode.trim()
      && activity.serviceNo.trim().toUpperCase() === normalizedServiceNo
    ));
    if (match) {
      await this.end(true, match.activityId);
    }
  }

  clearIfTracking(busStopCode: string): Promise<void> {
    const activityIds = Array.from(this.trackedActivities.values())
      .filter((activity) => activity.busStopCode === busStopCode)
      .map((activity) => activity.activityId);
    return Promise.all(activityIds.map((activityId) => this.end(true, activityId))).then(() => undefined);
  }

  private setStateFromPayload(payload: BusLiveActivityPayload): void {
    this.clearTimer();
    this.trackingStateSubject.next({
      active: true,
      serviceNo: payload.serviceNo,
      busStopCode: payload.busStopCode,
      busStopName: payload.busStopName,
      arrivalStatus: payload.arrivalStatus,
      nextArrivalTiming: payload.nextArrivalTiming,
      thirdArrivalTiming: payload.thirdArrivalTiming,
      busType: payload.busType,
      wheelchairAccessible: payload.wheelchairAccessible,
      seatAvailability: payload.seatAvailability,
      arrivalAt: payload.arrivalAt,
      lastUpdatedAt: payload.lastUpdatedAt,
      startedAt: payload.startedAt,
      expiresAt: payload.expiresAt
    });
    this.scheduleTimeout(payload.expiresAt);

  }

  private async clearNativeActivity(endNative: boolean, activityId = this.activeActivityId): Promise<void> {
    this.clearTimer();
    this.stopPoller('tracking cleared');
    this.trackedActivities.delete(activityId);
    const remainingActivity = Array.from(this.trackedActivities.values())
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    this.activeActivityId = remainingActivity?.activityId || '';
    if (remainingActivity) {
      this.setStateFromPayload(remainingActivity);
    } else {
      this.trackingStateSubject.next(inactiveTrackingState);
    }
    this.pollTickCount = 0;
    const backendDeleted = await this.endPushUpdateSession(activityId);

    if (!endNative || !Capacitor.isNativePlatform()) {
      return;
    }

    try {
      await this.widgetBridgeService.endBusLiveActivity(activityId);
      console.debug('[LiveTrack] stop action completed', { activityId, backendDeleted, nativeEnded: true });
    } catch (error) {
      console.warn('[LiveTrack] stop action native end failed', { activityId, backendDeleted, error });
    }
  }

  private scheduleTimeout(expiresAt: number): void {
    const delay = Math.max(0, expiresAt - Date.now());
    this.trackingTimeout = setTimeout(() => {
      void this.end(true);
    }, delay);
  }

  private clearTimer(): void {
    if (this.trackingTimeout) {
      clearTimeout(this.trackingTimeout);
      this.trackingTimeout = undefined;
    }
  }

  private registerForegroundListener(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      this.appIsActive = isActive;
      console.debug('[LiveTrack] app foreground state changed', {
        appIsActive: this.appIsActive,
        webViewVisible: this.webViewVisible,
        canRunForegroundPolling: this.canRunForegroundPolling(),
        activeTracking: this.currentState.active
      });

      if (isActive) {
        void this.restoreActiveLiveActivity('resume');
      }
    }).then((listener) => {
      this.appStateListener = listener;
    }).catch((error) => {
      console.warn('[LiveTrack] app foreground listener unavailable', error);
    });
  }

  private registerVisibilityListener(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.addEventListener('visibilitychange', () => {
      this.webViewVisible = !document.hidden;
      console.debug('[LiveTrack] web view visibility changed', {
        webViewVisible: this.webViewVisible,
        appIsActive: this.appIsActive,
        canRunForegroundPolling: this.canRunForegroundPolling(),
        activeTracking: this.currentState.active
      });

      if (this.webViewVisible && this.currentState.active) {
        void this.requestBackendRefresh('foreground');
      }
    });
  }

  private startPollWatchdog(): void {
    if (this.pollWatchdogTimer) {
      return;
    }

    this.pollWatchdogTimer = setInterval(() => {
      if (!this.currentState.active || !this.canRunForegroundPolling() || this.pollTimer) {
        return;
      }

      console.warn('[LiveTrack] poller watchdog restarting missing foreground poller', {
        serviceNo: this.currentState.serviceNo,
        busStopCode: this.currentState.busStopCode,
        pollInProgress: this.pollInProgress,
        tickCount: this.pollTickCount
      });
      this.startPoller();
    }, 5000);
  }

  private registerPushTokenListener(): void {
    const listenerPromise = this.widgetBridgeService.addLiveActivityPushTokenListener((event) => {
      const activityId = event.activityId || '';
      const pushToken = event.pushToken || '';
      const trackedActivity = this.trackedActivities.get(activityId);

      if (!activityId || !pushToken) {
        console.debug('[LiveTrack] push token update ignored: missing activity ID or token', {
          activityId,
          hasPushToken: Boolean(pushToken)
        });
        return;
      }

      if (!trackedActivity) {
        this.pendingPushTokens.set(activityId, pushToken);
        console.debug('[LiveTrack] push token buffered until the activity start resolves', {
          activityId,
          activeActivityId: this.activeActivityId,
          activeTracking: this.currentState.active
        });
        return;
      }

      console.debug('[LiveTrack] push token received', {
        activityId,
        tokenLength: pushToken.length
      });
      trackedActivity.pushToken = pushToken;
      trackedActivity.apnsEnvironment = event.apnsEnvironment || trackedActivity.apnsEnvironment;
      void this.registerPushUpdateSession(
        activityId,
        pushToken,
        trackedActivity,
        trackedActivity.apnsEnvironment
      );
    });

    listenerPromise?.then((listener) => {
      this.pushTokenListener = listener;
    }).catch((error) => {
      console.warn('[LiveTrack] push token listener unavailable', error);
    });
  }

  private startPoller(): void {
    const state = this.currentState;

    if (!state.active) {
      console.debug('[LiveTrack] poller not started: no active tracking state');
      return;
    }

    if (!this.canRunForegroundPolling()) {
      console.debug('[LiveTrack] poller not started: app is backgrounded', {
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode,
        appIsActive: this.appIsActive,
        webViewVisible: this.webViewVisible
      });
      return;
    }

    if (this.pollTimer) {
      console.debug('[LiveTrack] poller already running', {
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode
      });
      return;
    }

    console.debug('[LiveTrack] poller started', {
      serviceNo: state.serviceNo,
      busStopCode: state.busStopCode,
      intervalMs: this.pollIntervalMs
    });

    this.pollTimer = setInterval(() => {
      if (!this.currentState.active) {
        this.stopPoller('tracking inactive on interval tick');
        return;
      }

      if (!this.canRunForegroundPolling()) {
        this.stopPoller('app backgrounded on interval tick');
        return;
      }

      this.pollTickCount += 1;
      this.markDebug('timer', true, `service ${this.currentState.serviceNo} stop ${this.currentState.busStopCode} tick ${this.pollTickCount}`);
      console.debug('[LiveTrack] interval tick', {
        tick: this.pollTickCount,
        serviceNo: this.currentState.serviceNo,
        busStopCode: this.currentState.busStopCode,
        nextTickAt: new Date(Date.now() + this.pollIntervalMs).toISOString()
      });
      void this.refreshTrackedBusAndUpdateLiveActivity('interval');
    }, this.pollIntervalMs);
  }

  private stopPoller(reason: string): void {
    if (!this.pollTimer) {
      return;
    }

    console.debug('[LiveTrack] poller stopped', {
      reason,
      serviceNo: this.currentState.serviceNo,
      busStopCode: this.currentState.busStopCode,
      tickCount: this.pollTickCount
    });
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.pollInProgress = false;
  }

  async refreshTrackedBusAndUpdateLiveActivity(
    reason: 'start' | 'interval' | 'foreground' | 'manual',
    freshArrivalLookup?: BusArrivalLookup
  ): Promise<void> {
    // Arrival screens may ask for an immediate refresh, but the backend remains
    // the only component that fetches and replaces Live Activity content state.
    await this.requestBackendRefresh(reason);
    return;

    const state = this.currentState;
    const independentFetch = !freshArrivalLookup;

    if (!state.active) {
      console.debug('[LiveTrack] refresh skipped: inactive tracking state', { reason });
      return;
    }

    if (!this.canRunForegroundPolling()) {
      console.debug('[LiveTrack] refresh skipped: app is backgrounded', {
        reason,
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode,
        appIsActive: this.appIsActive,
        webViewVisible: this.webViewVisible
      });
      return;
    }

    if (independentFetch && this.pollInProgress) {
      console.debug('[LiveTrack] refresh skipped: previous refresh still running', {
        reason,
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode
      });
      return;
    }

    if (Date.now() >= state.expiresAt) {
      console.debug('[LiveTrack] refresh skipped: tracking expired', {
        reason,
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode,
        expiresAt: state.expiresAt
      });
      await this.end(true);
      return;
    }

    if (independentFetch) {
      this.pollInProgress = true;
    }

    try {
      if (reason === 'interval') {
        console.debug('[LiveTrack] interval tick handling started', {
          tick: this.pollTickCount,
          serviceNo: state.serviceNo,
          busStopCode: state.busStopCode
        });
      }

      console.debug('[LiveTrack] independent fetch started', {
        reason,
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode,
        independentFetch
      });
      console.debug('[LiveTrack] old primary timing:', state.arrivalStatus, {
        lastUpdatedAt: state.lastUpdatedAt
      });

      if (independentFetch) {
        this.markDebug('httpRequest', true, `requesting stop ${state.busStopCode} (${reason})`);
      }
      const arrivalLookup = freshArrivalLookup || await this.ltaBusService.getBusArrivals(state.busStopCode, {
        forceRefresh: true,
        reason,
        retry: true,
        timeoutMs: this.pollRequestTimeoutMs
      }).toPromise();

      if (!arrivalLookup) {
        console.warn('[LiveTrack] fetch failed: empty response', {
          serviceNo: state.serviceNo,
          busStopCode: state.busStopCode
        });
        return;
      }

      this.markDebug('httpResponse', true, `${arrivalLookup.services.length} services for stop ${arrivalLookup.busStopCode}`);
      const responseReceivedLabel = new Date().toLocaleTimeString('en-SG', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      console.debug(`[LiveTrack] response received at ${responseReceivedLabel}`, {
        reason,
        busStopCode: arrivalLookup.busStopCode
      });
      console.debug('[LiveTrack] fetch success', {
        requestedStopCode: state.busStopCode,
        responseStopCode: arrivalLookup.busStopCode,
        serviceCount: arrivalLookup.services.length
      });

      const normalizedServiceNo = state.serviceNo.trim().toUpperCase();
      const trackedService = arrivalLookup.services.find((service) => (
        service.serviceNo.trim().toUpperCase() === normalizedServiceNo
      ));

      if (!trackedService) {
        this.markDebug('trackedService', false, `${state.serviceNo} not found in ${arrivalLookup.services.length} services`);
        console.debug('[LiveTrack] tracked service not found', {
          serviceNo: state.serviceNo,
          availableServices: arrivalLookup.services.map((service) => service.serviceNo)
        });
        await this.end(true);
        return;
      }

      this.markDebug('trackedService', true, `${trackedService.serviceNo} primary ${trackedService.nextBus.timing}`);
      console.debug(`[LiveTrack] tracked service found: ${trackedService.serviceNo}`);
      console.debug('[LiveTrack] new primary timing:', trackedService.nextBus.timing, {
        primaryEstimatedArrival: trackedService.nextBus.estimatedArrival,
        subsequentTiming: trackedService.subsequentBus.timing,
        thirdTiming: trackedService.thirdBus.timing,
        busType: trackedService.nextBus.type,
        wheelchairAccessible: trackedService.nextBus.wheelchairAccessible,
        seatAvailability: trackedService.nextBus.load
      });

      if (!this.hasValidArrival(trackedService)) {
        console.debug('[LiveTrack] refresh ending: tracked service has no valid primary arrival', {
          serviceNo: trackedService.serviceNo,
          timing: trackedService.nextBus.timing,
          estimatedArrival: trackedService.nextBus.estimatedArrival
        });
        await this.end(true);
        return;
      }

      const refreshedAt = Date.now();
      const payload = this.payloadFromService(trackedService, state, refreshedAt);

      console.debug('[LiveTrack] calling native update', {
        serviceNo: payload.serviceNo,
        busStopCode: payload.busStopCode,
        primaryTiming: payload.arrivalStatus,
        subsequentTiming: payload.nextArrivalTiming,
        thirdTiming: payload.thirdArrivalTiming,
        busType: payload.busType,
        wheelchairAccessible: payload.wheelchairAccessible,
        seatAvailability: payload.seatAvailability,
        lastUpdatedAt: payload.lastUpdatedAt
      });

      await this.update(payload);
      console.debug('[LiveTrack] ActivityKit update sent', {
        serviceNo: payload.serviceNo,
        busStopCode: payload.busStopCode,
        primaryTiming: payload.arrivalStatus
      });
      console.debug('[LiveTrack] timestamp reset', {
        lastUpdatedAt: refreshedAt
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if ((error as any)?.status !== undefined || (error as any)?.name === 'TimeoutError') {
        this.markDebug('httpResponse', false, errorMessage);
      }
      console.warn('[LiveTrack] fetch/update failed', {
        reason,
        serviceNo: state.serviceNo,
        busStopCode: state.busStopCode,
        error,
        message: error instanceof Error ? error.message : String(error),
        status: (error as any)?.status,
        name: (error as any)?.name
      });
    } finally {
      if (independentFetch) {
        this.pollInProgress = false;
      }

      if (this.currentState.active && this.canRunForegroundPolling() && !this.pollTimer) {
        this.startPoller();
      }
    }
  }

  private canRunForegroundPolling(): boolean {
    return this.appIsActive || this.webViewVisible;
  }

  private payloadFromService(
    service: BusServiceArrival,
    state: LiveActivityTrackingState,
    lastUpdatedAt: number
  ): BusLiveActivityPayload {
    return {
      serviceNo: state.serviceNo,
      busStopName: state.busStopName,
      busStopCode: state.busStopCode,
      arrivalStatus: service.nextBus.timing,
      nextArrivalTiming: service.subsequentBus.timing,
      thirdArrivalTiming: service.thirdBus.timing,
      busType: service.nextBus.type,
      wheelchairAccessible: service.nextBus.wheelchairAccessible,
      seatAvailability: service.nextBus.load,
      arrivalAt: new Date(service.nextBus.estimatedArrival || '').getTime(),
      lastUpdatedAt,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt
    };
  }

  private payloadFromState(state: LiveActivityTrackingState): BusLiveActivityPayload {
    return {
      serviceNo: state.serviceNo,
      busStopName: state.busStopName,
      busStopCode: state.busStopCode,
      arrivalStatus: state.arrivalStatus,
      nextArrivalTiming: state.nextArrivalTiming,
      thirdArrivalTiming: state.thirdArrivalTiming,
      busType: state.busType,
      wheelchairAccessible: state.wheelchairAccessible,
      seatAvailability: state.seatAvailability,
      arrivalAt: state.arrivalAt,
      lastUpdatedAt: state.lastUpdatedAt,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt
    };
  }

  private hasValidArrival(service: BusServiceArrival): boolean {
    return service.nextBus.minutesAway !== null
      && !!service.nextBus.estimatedArrival
      && Number.isFinite(new Date(service.nextBus.estimatedArrival).getTime())
      && service.nextBus.timing !== 'No Bus';
  }

  private async registerPushUpdateSession(
    activityId: string | undefined,
    pushToken: string | undefined,
    payload: BusLiveActivityPayload,
    apnsEnvironment?: 'development' | 'production'
  ): Promise<boolean> {
    if (!activityId || !pushToken) {
      console.debug('[LiveTrack] push update session not registered: missing ActivityKit activity ID or push token', {
        activityId,
        hasPushToken: Boolean(pushToken)
      });
      return false;
    }

    const body = {
      activityId,
      pushToken,
      busStopCode: payload.busStopCode,
      serviceNo: payload.serviceNo,
      busStopName: payload.busStopName,
      expiresAt: payload.expiresAt,
      apnsEnvironment
    };
    const requestOptions = this.liveActivitySessionRequestOptions();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.http.post(`${environment.apiBaseUrl}/api/live-activity-sessions`, body, requestOptions).toPromise();
        console.debug('[LiveTrack] backend push update session registered', {
          activityId,
          serviceNo: payload.serviceNo,
          busStopCode: payload.busStopCode,
          apnsEnvironment,
          attempt
        });
        return true;
      } catch (error) {
        console.warn('[LiveTrack] backend registration failed but activity remains active', {
          activityId,
          serviceNo: payload.serviceNo,
          busStopCode: payload.busStopCode,
          attempt,
          error
        });

        if (attempt < 3) {
          await this.wait(1200 * attempt);
        }
      }
    }
    return false;
  }

  private async endPushUpdateSession(activityId: string): Promise<boolean> {
    if (!activityId) {
      return true;
    }

    try {
      await this.http.delete(
        `${environment.apiBaseUrl}/api/live-activity-sessions/${encodeURIComponent(activityId)}`,
        this.liveActivitySessionRequestOptions()
      ).toPromise();
      console.debug('[LiveTrack] backend push update session ended', { activityId });
      return true;
    } catch (error) {
      console.warn('[LiveTrack] backend push update session end failed', { activityId, error });
      return false;
    }
  }

  private async restoreActiveLiveActivity(reason: 'launch' | 'resume'): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      const result = await this.widgetBridgeService.getActiveBusLiveActivities();
      const activities = result?.activities || [];
      console.debug('[LiveTrack Restore] active ActivityKit activities found', {
        reason,
        count: activities.length,
        activityIds: activities.map((activity) => activity.activityId)
      });

      const restored = activities[0];
      if (!restored) {
        if (this.currentState.active) {
          const staleActivityId = this.activeActivityId;
          this.clearTimer();
          this.stopPoller('ActivityKit reports no active activity');
          this.activeActivityId = '';
          this.trackingStateSubject.next(inactiveTrackingState);
          const deleted = await this.endPushUpdateSession(staleActivityId);
          console.debug('[LiveTrack Restore] removed stale local/backend record', {
            reason,
            activityId: staleActivityId,
            deleted
          });
        }
        console.debug('[LiveTrack Restore] no active activity; header remains hidden', { reason });
        return;
      }

      this.trackedActivities.clear();
      activities.forEach((activity) => this.trackedActivities.set(activity.activityId, activity));
      this.activeActivityId = restored.activityId;
      this.setStateFromPayload(restored);
      console.debug('[LiveTrack Restore] restored activity into app state', {
        reason,
        activityId: restored.activityId,
        serviceNo: restored.serviceNo,
        busStopCode: restored.busStopCode
      });

      const reconciliationResults = await Promise.all(activities.map(async (activity) => (
        activity.pushToken
          ? this.registerPushUpdateSession(
            activity.activityId,
            activity.pushToken,
            activity,
            activity.apnsEnvironment
          )
          : false
      )));
      const reconciled = reconciliationResults.every(Boolean);
      console.debug('[LiveTrack Restore] backend session reconciliation', {
        reason,
        activityId: restored.activityId,
        activityCount: activities.length,
        method: 'registration',
        reconciled
      });
    } catch (error) {
      console.warn('[LiveTrack Restore] restoration failed', { reason, error });
    }
  }

  private async requestBackendRefresh(reason: 'start' | 'interval' | 'foreground' | 'manual'): Promise<boolean> {
    const activityId = this.activeActivityId;

    if (!activityId || !this.currentState.active) {
      return false;
    }

    try {
      await this.http.post(
        `${environment.apiBaseUrl}/api/live-activity-sessions/${encodeURIComponent(activityId)}/refresh`,
        { reason },
        this.liveActivitySessionRequestOptions()
      ).toPromise();
      console.debug('[LiveTrack] backend refresh requested', { activityId, reason });
      return true;
    } catch (error) {
      console.warn('[LiveTrack] backend refresh request failed; scheduled backend loop remains active', {
        activityId,
        reason,
        error
      });
      return false;
    }
  }

  private liveActivitySessionRequestOptions(): { headers?: Record<string, string> } {
    const token = (environment as any).liveActivitySessionToken;

    return token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : {};
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
