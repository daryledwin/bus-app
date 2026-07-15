import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, CapacitorHttp, PluginListenerHandle } from '@capacitor/core';
import { defer, from, Observable, of, throwError, timer } from 'rxjs';
import { catchError, map, mergeMap, retryWhen, tap, timeout } from 'rxjs/operators';

import { environment } from '../../environments/environment';

interface LtaBusResponse {
  BusStopCode?: string;
  Services?: LtaServiceResponse[];
  _diagnostics?: {
    backendReceivedAt?: number;
  };
}

interface LtaServiceResponse {
  ServiceNo: string;
  Operator: string;
  NextBus: LtaBusResponseItem;
  NextBus2: LtaBusResponseItem;
  NextBus3: LtaBusResponseItem;
}

interface LtaBusResponseItem {
  OriginCode?: string;
  DestinationCode?: string;
  EstimatedArrival?: string;
  Load?: string;
  Feature?: string;
  Type?: string;
}

export interface BusArrivalEstimate {
  originCode: string | null;
  destinationCode: string | null;
  estimatedArrival: string | null;
  minutesAway: number | null;
  timing: string;
  load: string;
  wheelchairAccessible: boolean;
  type: string;
}

export interface BusServiceArrival {
  serviceNo: string;
  operator: string;
  nextBus: BusArrivalEstimate;
  subsequentBus: BusArrivalEstimate;
  thirdBus: BusArrivalEstimate;
}

export interface BusArrivalLookup {
  busStopCode: string;
  services: BusServiceArrival[];
}

export interface BusArrivalRequestOptions {
  forceRefresh?: boolean;
  reason?: string;
  retry?: boolean;
  timeoutMs?: number;
  correlationId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class LtaBusService implements OnDestroy {
  private readonly endpoint = `${environment.apiBaseUrl}/api/bus-arrival`;
  private appIsActive = typeof document === 'undefined' || !document.hidden;
  private lifecycleChangeSequence = 0;
  private appStateListener?: PluginListenerHandle;
  private readonly visibilityChangeHandler = () => {
    this.lifecycleChangeSequence++;
    console.info('[BusArrival Diagnostic] visibility changed', {
      visibilityState: document.visibilityState,
      appState: this.currentAppState(),
      dateNow: Date.now(),
      performanceNow: performance.now()
    });
  };

  constructor(private readonly http: HttpClient) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    if (Capacitor.isNativePlatform()) {
      void App.addListener('appStateChange', ({ isActive }) => {
        this.appIsActive = isActive;
        this.lifecycleChangeSequence++;
        console.info('[BusArrival Diagnostic] app state changed', {
          appState: this.currentAppState(),
          isActive,
          dateNow: Date.now(),
          performanceNow: performance.now()
        });
      }).then((listener) => {
        this.appStateListener = listener;
      }).catch((error) => {
        console.warn('[BusArrival Diagnostic] app state listener unavailable', error);
      });
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
    void this.appStateListener?.remove();
  }

  getBusArrivals(busStopCode: string, options: BusArrivalRequestOptions = {}): Observable<BusArrivalLookup> {
    const cleanedBusStopCode = busStopCode.trim();

    if (!/^\d{5}$/.test(cleanedBusStopCode)) {
      return throwError(new Error('Please enter a 5-digit Singapore bus stop code.'));
    }

    let params = new HttpParams().set('busStopCode', cleanedBusStopCode);

    if (options.correlationId) {
      params = params.set('_requestId', options.correlationId);
    }

    if (options.forceRefresh) {
      params = params
        .set('_liveTrackTs', String(Date.now()))
        .set('_liveTrackReason', options.reason || 'force-refresh');
    }

    if (options.forceRefresh) {
      console.debug('[LiveTrack] HTTP request sent', {
        busStopCode: cleanedBusStopCode,
        reason: options.reason || 'force-refresh'
      });
    }

    const requestTimeoutMs = options.timeoutMs || 24000;
    const maxRetryIndex = options.retry === false ? 0 : 2;

    return defer(() => {
      const clientStartedAt = Date.now();
      const performanceStartedAt = performance.now();
      const lifecycleSequenceAtStart = this.lifecycleChangeSequence;
      const diagnosticId = options.correlationId || `uncorrelated-${clientStartedAt}`;

      console.info('[BusArrival Diagnostic] HTTP subscription start', {
        diagnosticId,
        busStopCode: cleanedBusStopCode,
        appState: this.currentAppState(),
        visibilityState: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
        dateNow: clientStartedAt,
        performanceNow: performanceStartedAt
      });

      return this.arrivalResponse(params).pipe(
        timeout(requestTimeoutMs),
        retryWhen((errors) => errors.pipe(
          mergeMap((error, retryIndex) => {
            if (retryIndex >= maxRetryIndex || !this.isTransientError(error)) {
              return throwError(error);
            }

            return timer(retryIndex === 0 ? 1200 : 3200);
          })
        )),
        tap({
          next: (response) => this.logRequestSettled(
            'response',
            response,
            diagnosticId,
            clientStartedAt,
            performanceStartedAt,
            lifecycleSequenceAtStart
          ),
          error: (error) => this.logRequestSettled(
            'error',
            error instanceof HttpErrorResponse ? error : undefined,
            diagnosticId,
            clientStartedAt,
            performanceStartedAt,
            lifecycleSequenceAtStart,
            error
          )
        }),
        map((response) => {
          const body = response.body || {};
          return {
            busStopCode: body.BusStopCode || cleanedBusStopCode,
            services: (body.Services || []).map((service) => this.mapService(service))
          };
        })
      );
    });
  }

  private arrivalResponse(params: HttpParams): Observable<HttpResponse<LtaBusResponse>> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return this.http.get<LtaBusResponse>(this.endpoint, { params, observe: 'response' });
    }

    return defer(() => from(CapacitorHttp.get({
      url: this.endpoint,
      params: this.nativeHttpParams(params),
      responseType: 'json'
    }))).pipe(
      mergeMap((response) => {
        const angularResponse = new HttpResponse<LtaBusResponse>({
          body: response.data as LtaBusResponse,
          headers: new HttpHeaders(response.headers),
          status: response.status,
          url: response.url || this.endpoint
        });

        if (response.status >= 200 && response.status < 300) {
          return of(angularResponse);
        }

        return throwError(new HttpErrorResponse({
          error: response.data,
          headers: angularResponse.headers,
          status: response.status,
          statusText: `HTTP ${response.status}`,
          url: angularResponse.url || this.endpoint
        }));
      }),
      catchError((error) => error instanceof HttpErrorResponse
        ? throwError(error)
        : throwError(new HttpErrorResponse({
          error,
          status: Number((error as any)?.status) || 0,
          statusText: (error as any)?.message || 'Native HTTP request failed',
          url: this.endpoint
        })))
    );
  }

  private nativeHttpParams(params: HttpParams): Record<string, string | string[]> {
    return params.keys().reduce<Record<string, string | string[]>>((nativeParams, key) => {
      const values = params.getAll(key) || [];
      nativeParams[key] = values.length > 1 ? values : values[0] || '';
      return nativeParams;
    }, {});
  }

  private currentAppState(): 'active' | 'inactive' | 'background' {
    if (typeof document !== 'undefined' && document.hidden) {
      return 'background';
    }

    return this.appIsActive ? 'active' : 'inactive';
  }

  private logRequestSettled(
    outcome: 'response' | 'error',
    response: HttpResponse<LtaBusResponse> | HttpErrorResponse | undefined,
    diagnosticId: string,
    clientStartedAt: number,
    performanceStartedAt: number,
    lifecycleSequenceAtStart: number,
    error?: unknown
  ): void {
    const clientReceivedAt = Date.now();
    const performanceReceivedAt = performance.now();
    const elapsedMs = performanceReceivedAt - performanceStartedAt;
    const backendReceivedAtHeader = response?.headers.get('X-Backend-Received-At');
    const backendReceivedAtBody = response instanceof HttpResponse
      ? response.body?._diagnostics?.backendReceivedAt
      : undefined;
    const backendReceivedAt = backendReceivedAtHeader
      ? Number(backendReceivedAtHeader)
      : backendReceivedAtBody;
    const hasBackendTimestamp = Number.isFinite(backendReceivedAt);

    console.info('[BusArrival Diagnostic] HTTP request settled', {
      diagnosticId,
      outcome,
      appState: this.currentAppState(),
      clientStartedAt,
      clientReceivedAt,
      performanceStartedAt,
      performanceReceivedAt,
      elapsedMs: Math.round(elapsedMs),
      backendReceivedAt: hasBackendTimestamp ? backendReceivedAt : undefined,
      apparentPreBackendGapMs: hasBackendTimestamp ? backendReceivedAt! - clientStartedAt : undefined,
      estimatedClientServerClockOffsetMs: hasBackendTimestamp
        ? Math.round(backendReceivedAt! - (clientStartedAt + elapsedMs / 2))
        : undefined,
      lifecycleOrVisibilityChangedWhilePending: this.lifecycleChangeSequence !== lifecycleSequenceAtStart,
      lifecycleChangesWhilePending: this.lifecycleChangeSequence - lifecycleSequenceAtStart,
      error
    });
  }

  private isTransientError(error: any): boolean {
    return error?.name === 'TimeoutError'
      || error?.status === 0
      || error?.status === 429
      || error?.status >= 500;
  }

  private mapService(service: LtaServiceResponse): BusServiceArrival {
    return {
      serviceNo: service.ServiceNo,
      operator: service.Operator,
      nextBus: this.mapEstimate(service.NextBus),
      subsequentBus: this.mapEstimate(service.NextBus2),
      thirdBus: this.mapEstimate(service.NextBus3)
    };
  }

  private mapEstimate(bus: LtaBusResponseItem = {}): BusArrivalEstimate {
    const estimatedArrival = bus.EstimatedArrival || null;
    const minutesAway = this.minutesAway(estimatedArrival);

    return {
      originCode: bus.OriginCode || null,
      destinationCode: bus.DestinationCode || null,
      estimatedArrival,
      minutesAway,
      timing: this.timingLabel(minutesAway),
      load: this.loadLabel(bus.Load),
      wheelchairAccessible: bus.Feature === 'WAB',
      type: this.typeLabel(bus.Type)
    };
  }

  private minutesAway(estimatedArrival: string | null): number | null {
    if (!estimatedArrival) {
      return null;
    }

    const arrivalTime = new Date(estimatedArrival).getTime();

    if (Number.isNaN(arrivalTime)) {
      return null;
    }

    return Math.max(0, Math.ceil((arrivalTime - Date.now()) / 60000));
  }

  private timingLabel(minutesAway: number | null): string {
    if (minutesAway === null) {
      return 'No Bus';
    }

    if (minutesAway <= 1) {
      return 'Arriving';
    }

    return `${minutesAway} min`;
  }

  private loadLabel(load?: string): string {
    switch (load) {
      case 'SEA':
        return 'Seats available';
      case 'SDA':
        return 'Few seats left';
      case 'LSD':
        return 'No chance of a seat';
      default:
        return 'Load unavailable';
    }
  }

  private typeLabel(type?: string): string {
    switch (type) {
      case 'SD':
        return 'Single deck';
      case 'DD':
        return 'Double deck';
      case 'BD':
        return 'Bendy bus';
      default:
        return 'Type unavailable';
    }
  }
}
