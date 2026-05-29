import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, map, mergeMap, retryWhen, shareReplay, timeout } from 'rxjs/operators';

import { environment } from '../../environments/environment';

type BusRoutesResponse = BusRoute[] | {
  value?: BusRoute[];
  data?: BusRoute[];
  routes?: BusRoute[];
  busRoutes?: BusRoute[];
  results?: BusRoute[];
};

export interface BusRoute {
  ServiceNo: string;
  Operator: string;
  Direction: number;
  StopSequence: number;
  BusStopCode: string;
  Distance: number;
  WD_FirstBus: string;
  WD_LastBus: string;
  SAT_FirstBus: string;
  SAT_LastBus: string;
  SUN_FirstBus: string;
  SUN_LastBus: string;
}

@Injectable({
  providedIn: 'root'
})
export class LtaBusRoutesService {
  private readonly endpoint = `${environment.apiBaseUrl}/api/bus-routes`;
  private readonly routeRequests = new Map<string, Observable<BusRoute[]>>();

  constructor(private readonly http: HttpClient) {}

  getBusRoutes(serviceNo: string): Observable<BusRoute[]> {
    const cleanedServiceNo = serviceNo.trim().toUpperCase();

    if (!this.routeRequests.has(cleanedServiceNo)) {
      const params = new HttpParams().set('serviceNo', cleanedServiceNo);
      const request = this.http.get<BusRoutesResponse>(this.endpoint, { params }).pipe(
        timeout(30000),
        retryWhen((errors) => errors.pipe(
          mergeMap((error, retryIndex) => {
            if (retryIndex >= 1 || !this.isTransientError(error)) {
              return throwError(error);
            }

            return timer(1800);
          })
        )),
        map((response) => this.unwrapBusRoutes(response)),
        catchError((error) => {
          this.routeRequests.delete(cleanedServiceNo);
          return throwError(error);
        }),
        shareReplay(1)
      );

      this.routeRequests.set(cleanedServiceNo, request);
    }

    return this.routeRequests.get(cleanedServiceNo) as Observable<BusRoute[]>;
  }

  private unwrapBusRoutes(response: BusRoutesResponse): BusRoute[] {
    if (Array.isArray(response)) {
      return response;
    }

    return response.value
      || response.data
      || response.routes
      || response.busRoutes
      || response.results
      || [];
  }

  private isTransientError(error: any): boolean {
    return error?.name === 'TimeoutError'
      || error?.status === 0
      || error?.status === 429
      || error?.status >= 500;
  }
}
