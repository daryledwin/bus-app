import { of } from 'rxjs';

import { Tab2Page } from './tab2.page';

describe('Tab2Page progressive nearby location', () => {
  let component: Tab2Page;
  let locationService: {
    currentLocation: jasmine.Spy;
    requestPermissionAndLocation: jasmine.Spy;
  };
  let refresherComplete: jasmine.Spy;

  const quickLocation = { latitude: 1.3001, longitude: 103.8001 };
  const refinedLocation = { latitude: 1.301, longitude: 103.801 };
  const stops = [{
    BusStopCode: '01012',
    Description: 'Test Stop',
    RoadName: 'Test Road',
    Latitude: 1.301,
    Longitude: 103.801
  }];

  beforeEach(() => {
    localStorage.clear();
    locationService = {
      currentLocation: jasmine.createSpy('currentLocation').and.resolveTo(refinedLocation),
      requestPermissionAndLocation: jasmine.createSpy('requestPermissionAndLocation').and.resolveTo(quickLocation)
    };
    refresherComplete = jasmine.createSpy('complete').and.resolveTo(undefined);

    component = new Tab2Page(
      { getBusStops: () => of(stops) } as any,
      locationService as any,
      { run: (callback: () => void) => callback() } as any,
      {
        locationChoice: () => 'granted',
        shouldRequestLocationAutomatically: () => true,
        complete: () => undefined
      } as any,
      {
        success: () => Promise.resolve(),
        info: () => Promise.resolve(),
        lightImpact: () => Promise.resolve()
      } as any,
      {} as any,
      { url: '/tabs/tab2', navigate: () => undefined, navigateByUrl: () => undefined } as any,
      {} as any,
      {} as any,
      { syncWidgetData: () => undefined } as any
    );
  });

  it('uses low accuracy for the blocking part of pull refresh, then refines in the background', async () => {
    await component.refreshNearbyStops({ target: { complete: refresherComplete } } as any);

    expect(locationService.requestPermissionAndLocation).toHaveBeenCalledOnceWith({
      enableHighAccuracy: false,
      maximumAge: 0,
      timeout: 6500
    });
    expect(refresherComplete).toHaveBeenCalled();
    expect(locationService.currentLocation).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 7000
    });
  });

  it('shares an active resume quick request and starts refinement only after it settles', async () => {
    let resolveQuickLocation!: (location: typeof quickLocation) => void;
    const activeQuickLocation = new Promise<typeof quickLocation>((resolve) => {
      resolveQuickLocation = resolve;
    });
    (component as any).resumeQuickLocationRequest = activeQuickLocation;

    const refresh = component.refreshNearbyStops({ target: { complete: refresherComplete } } as any);
    await Promise.resolve();

    expect(locationService.requestPermissionAndLocation).not.toHaveBeenCalled();
    expect(locationService.currentLocation).not.toHaveBeenCalled();
    expect(refresherComplete).not.toHaveBeenCalled();

    resolveQuickLocation(quickLocation);
    await refresh;

    expect(refresherComplete).toHaveBeenCalled();
    expect(locationService.currentLocation).toHaveBeenCalledOnceWith({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 7000
    });
  });

  it('warms location after resume without entering the page loading state', async () => {
    let resolveQuickLocation!: (location: typeof quickLocation) => void;
    locationService.currentLocation.and.returnValue(new Promise<typeof quickLocation>((resolve) => {
      resolveQuickLocation = resolve;
    }));

    const warmup = (component as any).warmNearbyLocationAfterResume();

    expect(component.isLoadingLocation).toBeFalse();
    expect(locationService.currentLocation).toHaveBeenCalledOnceWith({
      enableHighAccuracy: false,
      maximumAge: 0,
      timeout: 6500
    });

    resolveQuickLocation(quickLocation);
    await warmup;

    expect(component.isUsingFallbackLocation).toBeFalse();
  });

  it('keeps last-known state until a real quick location succeeds', async () => {
    let resolveQuickLocation!: (location: typeof quickLocation) => void;
    const activeQuickLocation = new Promise<typeof quickLocation>((resolve) => {
      resolveQuickLocation = resolve;
    });
    (component as any).resumeQuickLocationRequest = activeQuickLocation;
    component.nearbyStops = stops.map((stop) => ({ ...stop, distanceMeters: 100 }));
    component.hasUserLocation = true;
    component.isUsingFallbackLocation = true;
    component.nearbyError = 'Using your last known location while your phone refreshes nearby stops.';

    const refresh = component.refreshNearbyStops({ target: { complete: refresherComplete } } as any);
    await Promise.resolve();

    expect(component.isUsingFallbackLocation).toBeTrue();
    expect(component.nearbyError).toContain('last known location');

    resolveQuickLocation(quickLocation);
    await refresh;

    expect(component.isUsingFallbackLocation).toBeFalse();
    expect(component.nearbyError).toBe('');
  });
});
