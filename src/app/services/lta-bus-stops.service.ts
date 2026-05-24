import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

type BusStopsResponse = BusStop[] | {
  value?: BusStop[];
  data?: BusStop[];
  busStops?: BusStop[];
  stops?: BusStop[];
  results?: BusStop[];
};

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
  private readonly endpoint = 'https://bus-app-vk72.onrender.com/api/bus-stops';
  private busStopsRequest?: Observable<BusStop[]>;

  constructor(private readonly http: HttpClient) {}

  getBusStops(forceRefresh = false): Observable<BusStop[]> {
    if (forceRefresh) {
      this.busStopsRequest = undefined;
    }

    if (!this.busStopsRequest) {
      this.busStopsRequest = this.http.get<BusStopsResponse>(this.endpoint).pipe(
        tap((response) => console.log('Bus stops fetch response:', response)),
        map((response) => this.unwrapBusStops(response)),
        shareReplay(1)
      );
    }

    return this.busStopsRequest;
  }

  searchBusStops(query: string): Observable<BusStop[]> {
    const params = new HttpParams().set('search', query.trim());

    return this.http.get<BusStopsResponse>(this.endpoint, { params }).pipe(
      tap((response) => console.log('Bus stops fetch response:', response)),
      map((response) => this.unwrapBusStops(response))
    );
  }

  private unwrapBusStops(response: BusStopsResponse): BusStop[] {
    if (Array.isArray(response)) {
      return response;
    }

    return response.value
      || response.data
      || response.busStops
      || response.stops
      || response.results
      || [];
  }
}
