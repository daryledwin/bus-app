import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, map, mergeMap, retryWhen, tap, timeout } from 'rxjs/operators';

import { environment } from '../../environments/environment';

type TrainServiceAlertsResponse = TrainServiceAlertResponse[] | {
  value?: TrainServiceAlertResponse[];
  alerts?: TrainServiceAlertResponse[];
  data?: TrainServiceAlertResponse[];
};

interface TrainAlertMessageResponse {
  Content?: string;
  CreatedDate?: string;
}

interface TrainServiceAlertResponse {
  Status?: number;
  Line?: string;
  Direction?: string;
  Stations?: string;
  FreePublicBus?: string | boolean;
  FreeMRTShuttle?: string | boolean;
  MRTShuttleDirection?: string;
  Message?: TrainAlertMessageResponse | TrainAlertMessageResponse[];
}

export interface TrainServiceAlert {
  status: number;
  line: string;
  direction: string;
  stations: string;
  freePublicBus: boolean;
  freeMrtShuttle: boolean;
  mrtShuttleDirection: string;
  messageContent: string;
  createdDate: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class LtaTrainServiceAlertsService {
  private readonly endpoint = `${environment.apiBaseUrl}/api/train-service-alerts`;

  constructor(private readonly http: HttpClient) {}

  getTrainServiceAlerts(): Observable<TrainServiceAlert[]> {
    console.log('[TrainServiceAlerts] Request URL:', this.endpoint);

    return this.http.get<TrainServiceAlertsResponse>(this.endpoint, { observe: 'response' }).pipe(
      timeout(18000),
      retryWhen((errors) => errors.pipe(
        mergeMap((error, retryIndex) => {
          if (retryIndex >= 1 || !this.isTransientError(error)) {
            return throwError(error);
          }

          return timer(1200);
        })
      )),
      tap((response) => {
        console.log('[TrainServiceAlerts] HTTP status:', response.status);
        console.log('[TrainServiceAlerts] Raw JSON response:', response.body);
      }),
      map((response) => {
        const alerts = this.unwrapAlertsFromResponse(response);
        console.log('[TrainServiceAlerts] Parsed alert count:', alerts.length);

        return alerts.map((alert) => this.mapAlert(alert));
      }),
      catchError((error) => {
        console.error('[TrainServiceAlerts] Caught error object:', error);
        return throwError(error);
      })
    );
  }

  private unwrapAlertsFromResponse(response: HttpResponse<TrainServiceAlertsResponse>): TrainServiceAlertResponse[] {
    return this.unwrapAlerts(response.body || []);
  }

  private unwrapAlerts(response: TrainServiceAlertsResponse): TrainServiceAlertResponse[] {
    if (Array.isArray(response)) {
      return response;
    }

    return response.value || response.alerts || response.data || [];
  }

  private mapAlert(alert: TrainServiceAlertResponse): TrainServiceAlert {
    const message = Array.isArray(alert.Message)
      ? alert.Message[0] || {}
      : alert.Message || {};

    return {
      status: Number(alert.Status) || 0,
      line: alert.Line || '',
      direction: alert.Direction || '',
      stations: alert.Stations || '',
      freePublicBus: this.toBoolean(alert.FreePublicBus),
      freeMrtShuttle: this.toBoolean(alert.FreeMRTShuttle),
      mrtShuttleDirection: alert.MRTShuttleDirection || '',
      messageContent: message.Content || '',
      createdDate: message.CreatedDate || null
    };
  }

  private toBoolean(value: string | boolean | undefined): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    return ['true', 'yes', 'y', '1'].includes(String(value || '').trim().toLowerCase());
  }

  private isTransientError(error: any): boolean {
    return error?.name === 'TimeoutError'
      || error?.status === 0
      || error?.status === 429
      || error?.status >= 500;
  }
}
