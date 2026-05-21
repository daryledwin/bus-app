import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

import { environment } from '../../environments/environment';

export interface BusStop {
  BusStopCode: string;
  Description: string;
  RoadName: string;
  Latitude: number;
  Longitude: number;
}

@Injectable({
  providedIn: 'root'
})
export class LtaBusStopsService {
  private readonly endpoint = `${environment.apiBaseUrl}/api/bus-stops`;
  private busStopsRequest?: Observable<BusStop[]>;

  constructor(private readonly http: HttpClient) {}

  getBusStops(): Observable<BusStop[]> {
    if (!this.busStopsRequest) {
      this.busStopsRequest = this.http.get<BusStop[]>(this.endpoint).pipe(
        shareReplay(1)
      );
    }

    return this.busStopsRequest;
  }
}
