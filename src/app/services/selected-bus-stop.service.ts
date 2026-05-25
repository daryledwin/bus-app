import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BusStop } from './lta-bus-stops.service';

@Injectable({
  providedIn: 'root'
})
export class SelectedBusStopService {
  private readonly selectedStopSubject = new BehaviorSubject<BusStop | null>(null);
  readonly selectedStop$ = this.selectedStopSubject.asObservable();

  selectStop(stop: BusStop): void {
    this.selectedStopSubject.next(stop);
  }

  clearSelection(): void {
    this.selectedStopSubject.next(null);
  }
}
