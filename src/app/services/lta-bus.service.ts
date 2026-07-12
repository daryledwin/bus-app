import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { map, mergeMap, retryWhen, timeout } from 'rxjs/operators';

import { environment } from '../../environments/environment';

interface LtaBusResponse {
  BusStopCode?: string;
  Services?: LtaServiceResponse[];
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
export class LtaBusService {
  private readonly endpoint = `${environment.apiBaseUrl}/api/bus-arrival`;

  constructor(private readonly http: HttpClient) {}

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

    return this.http.get<LtaBusResponse>(this.endpoint, { params }).pipe(
      timeout(requestTimeoutMs),
      retryWhen((errors) => errors.pipe(
        mergeMap((error, retryIndex) => {
          if (retryIndex >= maxRetryIndex || !this.isTransientError(error)) {
            return throwError(error);
          }

          return timer(retryIndex === 0 ? 1200 : 3200);
        })
      )),
      map((response) => ({
        busStopCode: response.BusStopCode || cleanedBusStopCode,
        services: (response.Services || []).map((service) => this.mapService(service))
      }))
    );
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
