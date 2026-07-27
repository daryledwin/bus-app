import { Capacitor } from '@capacitor/core';
import { of } from 'rxjs';

import { environment } from '../../environments/environment';
import { BusLiveActivityPayload } from './widget-bridge.service';
import { LiveActivityTrackingService } from './live-activity-tracking.service';

describe('LiveActivityTrackingService single-activity handoff', () => {
  let service: LiveActivityTrackingService;
  let bridge: jasmine.SpyObj<any>;
  let http: jasmine.SpyObj<any>;
  let backendSessions: Set<string>;
  let nativeActivities: Map<string, BusLiveActivityPayload>;
  let eventLog: string[];
  let maximumBackendSessionCount: number;
  let originalLiveActivitiesEnabled: boolean;
  let activitySequence: number;

  const payload = (serviceNo: string, busStopCode = '01012'): BusLiveActivityPayload => {
    const now = Date.now();
    return {
      serviceNo,
      busStopName: `Stop ${busStopCode}`,
      busStopCode,
      arrivalStatus: '5 min',
      nextArrivalTiming: '12 min',
      thirdArrivalTiming: '18 min',
      arrivalVisitNumber: 1,
      nextArrivalVisitNumber: 2,
      thirdArrivalVisitNumber: 1,
      busType: 'Double Deck',
      wheelchairAccessible: true,
      seatAvailability: 'Seats Available',
      arrivalAt: now + 5 * 60 * 1000,
      lastUpdatedAt: now,
      startedAt: now,
      expiresAt: now + 30 * 60 * 1000
    };
  };

  beforeEach(() => {
    originalLiveActivitiesEnabled = environment.liveActivitiesEnabled;
    environment.liveActivitiesEnabled = false;
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);

    backendSessions = new Set<string>();
    nativeActivities = new Map<string, BusLiveActivityPayload>();
    eventLog = [];
    maximumBackendSessionCount = 0;
    activitySequence = 0;

    http = jasmine.createSpyObj('HttpClient', ['post', 'delete']);
    http.post.and.callFake((url: string, body: any) => {
      if (url.endsWith('/api/live-activity-sessions')) {
        backendSessions.add(body.activityId);
        maximumBackendSessionCount = Math.max(maximumBackendSessionCount, backendSessions.size);
        eventLog.push(`backend:add:${body.activityId}`);
      }
      return of({});
    });
    http.delete.and.callFake((url: string) => {
      const activityId = decodeURIComponent(url.split('/').pop() || '');
      backendSessions.delete(activityId);
      eventLog.push(`backend:delete:${activityId}`);
      return of({});
    });

    bridge = jasmine.createSpyObj('WidgetBridgeService', [
      'startBusLiveActivity',
      'endBusLiveActivity',
      'getActiveBusLiveActivities',
      'addLiveActivityPushTokenListener',
      'updateBusLiveActivity'
    ]);
    bridge.startBusLiveActivity.and.callFake(async (activityPayload: BusLiveActivityPayload) => {
      const activityId = `activity-${activityPayload.serviceNo}-${++activitySequence}`;
      nativeActivities.set(activityId, activityPayload);
      eventLog.push(`native:start:${activityId}`);
      return {
        started: true,
        activityId,
        pushToken: `token-${activityId}`,
        pushEnabled: true,
        apnsEnvironment: 'development'
      };
    });
    bridge.endBusLiveActivity.and.callFake(async (activityId: string) => {
      nativeActivities.delete(activityId);
      eventLog.push(`native:end:${activityId}`);
    });
    bridge.getActiveBusLiveActivities.and.callFake(async () => ({
      activities: Array.from(nativeActivities.entries()).map(([activityId, activityPayload]) => ({
        ...activityPayload,
        activityId,
        pushToken: `token-${activityId}`,
        apnsEnvironment: 'development'
      })),
      orphanedActivityIds: []
    }));

    service = new LiveActivityTrackingService(http, bridge, {} as any);
  });

  afterEach(async () => {
    await service.end(false);
    environment.liveActivitiesEnabled = originalLiveActivitiesEnabled;
  });

  it('starts bus A when nothing is tracked', async () => {
    expect(await service.start(payload('A'))).toBeTrue();

    expect(bridge.startBusLiveActivity).toHaveBeenCalledTimes(1);
    expect(service.isTracking('01012', 'A')).toBeTrue();
    expect(service.currentState.serviceNo).toBe('A');
    expect(nativeActivities.size).toBe(1);
    expect(backendSessions.size).toBe(1);
  });

  it('ends and unregisters bus A before starting bus B', async () => {
    await service.start(payload('A'));
    const activityA = Array.from(nativeActivities.keys())[0];

    expect(await service.start(payload('B', '02049'))).toBeTrue();

    const endAIndex = eventLog.indexOf(`native:end:${activityA}`);
    const deleteAIndex = eventLog.indexOf(`backend:delete:${activityA}`);
    const startBIndex = eventLog.findIndex((event) => event.startsWith('native:start:activity-B-'));
    expect(endAIndex).toBeGreaterThan(-1);
    expect(deleteAIndex).toBeGreaterThan(-1);
    expect(endAIndex).toBeLessThan(startBIndex);
    expect(deleteAIndex).toBeLessThan(startBIndex);
    expect(service.isTracking('01012', 'A')).toBeFalse();
    expect(service.isTracking('02049', 'B')).toBeTrue();
    expect(nativeActivities.size).toBe(1);
    expect(backendSessions.size).toBe(1);
  });

  it('keeps only the final bus after rapid taps for bus B and bus C', async () => {
    await service.start(payload('A'));

    const startB = service.start(payload('B'));
    const startC = service.start(payload('C', '03011'));
    await Promise.all([startB, startC]);

    expect(service.isTracking('01012', 'A')).toBeFalse();
    expect(service.isTracking('01012', 'B')).toBeFalse();
    expect(service.isTracking('03011', 'C')).toBeTrue();
    expect(service.currentState.serviceNo).toBe('C');
    expect(nativeActivities.size).toBe(1);
    expect(backendSessions.size).toBe(1);
    expect(bridge.startBusLiveActivity.calls.allArgs().map((args) => args[0].serviceNo)).toEqual(['A', 'C']);
  });

  it('does not create a duplicate for the currently tracked bus', async () => {
    await service.start(payload('A'));
    const originalActivityId = Array.from(nativeActivities.keys())[0];

    expect(await service.start(payload('A'))).toBeTrue();

    expect(bridge.startBusLiveActivity).toHaveBeenCalledTimes(1);
    expect(bridge.endBusLiveActivity).not.toHaveBeenCalled();
    expect(Array.from(nativeActivities.keys())).toEqual([originalActivityId]);
    expect(backendSessions.size).toBe(1);
  });

  it('never allows more than one backend session during replacements', async () => {
    await service.start(payload('A'));
    await service.start(payload('B', '02049'));
    await service.start(payload('C', '03011'));

    expect(maximumBackendSessionCount).toBe(1);
    expect(backendSessions.size).toBe(1);
    expect(nativeActivities.size).toBe(1);
  });
});
