import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SplashOverlayService {
  private readonly coldStartLoadingSubject = new Subject<boolean>();
  readonly coldStartLoading$ = this.coldStartLoadingSubject.asObservable();

  showColdStartLoading(): void {
    this.coldStartLoadingSubject.next(true);
  }

  hideColdStartLoading(): void {
    this.coldStartLoadingSubject.next(false);
  }
}
