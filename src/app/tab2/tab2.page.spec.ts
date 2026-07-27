import { of, Subject } from 'rxjs';
import * as L from 'leaflet';

import { Tab2Page } from './tab2.page';

describe('Tab2Page progressive nearby location', () => {
  let component: Tab2Page;
  let locationService: {
    currentLocation: jasmine.Spy;
    requestPermissionAndLocation: jasmine.Spy;
  };
  let refresherComplete: jasmine.Spy;
  let busStopsService: {
    getBusStops: jasmine.Spy;
    getBusStopsNear: jasmine.Spy;
  };
  let feedbackService: {
    success: jasmine.Spy;
    info: jasmine.Spy;
    lightImpact: jasmine.Spy;
    mediumImpact: jasmine.Spy;
  };

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
    busStopsService = {
      getBusStops: jasmine.createSpy('getBusStops').and.returnValue(of(stops)),
      getBusStopsNear: jasmine.createSpy('getBusStopsNear').and.returnValue(of(stops))
    };
    feedbackService = {
      success: jasmine.createSpy('success').and.resolveTo(undefined),
      info: jasmine.createSpy('info').and.resolveTo(undefined),
      lightImpact: jasmine.createSpy('lightImpact').and.resolveTo(undefined),
      mediumImpact: jasmine.createSpy('mediumImpact').and.resolveTo(undefined)
    };

    component = new Tab2Page(
      busStopsService as any,
      locationService as any,
      { run: (callback: () => void) => callback() } as any,
      {
        locationChoice: () => 'granted',
        shouldRequestLocationAutomatically: () => true,
        complete: () => undefined
      } as any,
      feedbackService as any,
      { requestAutomaticReviewIfEligible: () => Promise.resolve() } as any,
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

  it('blocks pull-to-refresh while the map is expanded', async () => {
    component.isMapExpanded = true;

    await component.refreshNearbyStops({ target: { complete: refresherComplete } } as any);

    expect(refresherComplete).toHaveBeenCalled();
    expect(locationService.requestPermissionAndLocation).not.toHaveBeenCalled();
  });

  it('renders individual stops with the existing blue bus marker', () => {
    const icon = (component as any).stopIcon(false);

    expect(icon.options.className).toBe('nearby-stop-marker');
    expect(icon.options.html).toContain('<svg');
  });

  it('loads the page list from the user location without requesting the full stop catalogue', async () => {
    locationService.currentLocation.and.resolveTo(quickLocation);

    await component.loadNearbyStops();

    expect(busStopsService.getBusStops).not.toHaveBeenCalled();
    expect(busStopsService.getBusStopsNear).toHaveBeenCalledWith(
      quickLocation.latitude,
      quickLocation.longitude,
      50
    );
    expect(component.nearbyStops.length).toBe(1);
  });

  it('debounces repeated settled map movements into one capped centre request', async () => {
    jasmine.clock().install();
    const manyStops = Array.from({ length: 100 }, (_, index) => ({
      ...stops[0],
      BusStopCode: String(index).padStart(5, '0')
    }));
    busStopsService.getBusStopsNear.and.returnValue(of(manyStops));
    (component as any).map = {
      getCenter: () => ({ lat: 1.35, lng: 103.82 })
    };
    const replaceMapMarkers = spyOn<any>(component, 'replaceMapMarkers');

    (component as any).mapMoveWasUserInitiated = true;
    (component as any).handleSettledMapMovement();
    (component as any).mapMoveWasUserInitiated = true;
    (component as any).handleSettledMapMovement();
    jasmine.clock().tick(219);
    expect(busStopsService.getBusStopsNear).not.toHaveBeenCalled();

    jasmine.clock().tick(1);
    await Promise.resolve();
    expect(busStopsService.getBusStopsNear).toHaveBeenCalledOnceWith(1.35, 103.82, 40);
    expect(replaceMapMarkers).toHaveBeenCalled();
    expect((replaceMapMarkers.calls.mostRecent().args[0] as unknown[]).length).toBe(40);
    jasmine.clock().uninstall();
  });

  it('cancels an older marker request when the user pans again', () => {
    const activeRequest = new Subject<typeof stops>();
    busStopsService.getBusStopsNear.and.returnValue(activeRequest);
    (component as any).map = {
      getCenter: () => ({ lat: 1.35, lng: 103.82 })
    };

    (component as any).refreshMapStopsAroundCenter();
    expect(activeRequest.observers.length).toBe(1);

    (component as any).mapMoveWasUserInitiated = true;
    (component as any).handleSettledMapMovement();
    expect(activeRequest.observers.length).toBe(0);
  });

  it('reuses overlapping markers and removes markers from the previous area', () => {
    const oldMarker = {
      remove: jasmine.createSpy('remove'),
      setIcon: jasmine.createSpy('setIcon')
    };
    const retainedMarker = {
      remove: jasmine.createSpy('remove'),
      setIcon: jasmine.createSpy('setIcon')
    };
    (component as any).map = {};
    (component as any).stopMarkers = new Map([
      ['old-area', oldMarker],
      [stops[0].BusStopCode, retainedMarker]
    ]);

    (component as any).replaceMapMarkers(stops, quickLocation);

    expect(oldMarker.remove).toHaveBeenCalled();
    expect(retainedMarker.remove).not.toHaveBeenCalled();
    expect(retainedMarker.setIcon).toHaveBeenCalled();
    expect((component as any).stopMarkers.size).toBe(1);
  });

  it('does not change the user-location Nearby Stops list when map markers refresh', () => {
    const userLocationStops = stops.map((stop) => ({ ...stop, distanceMeters: 20 }));
    component.nearbyStops = userLocationStops;
    (component as any).map = {};
    (component as any).replaceMapMarkers([], { latitude: 1.40, longitude: 103.90 });

    expect(component.nearbyStops).toBe(userLocationStops);
  });

  it('toggles the compact card when the selected map marker is tapped again', () => {
    const stop = { ...stops[0], distanceMeters: 100 };
    component.isMapExpanded = true;

    component.selectNearbyStop(stop, true);
    expect(component.isExpandedStopCardVisible).toBeTrue();

    component.selectNearbyStop(stop, true);
    expect(component.isExpandedStopCardVisible).toBeFalse();
    expect(component.selectedNearbyStop?.BusStopCode).toBe(stop.BusStopCode);
  });

  it('uses the compact popup for a marker tap while the map is collapsed', () => {
    const stop = { ...stops[0], distanceMeters: 100 };
    const openCompactPopup = spyOn<any>(component, 'openSelectedStopCallout');
    component.isMapExpanded = false;

    component.selectNearbyStop(stop, true);

    expect(openCompactPopup).toHaveBeenCalledOnceWith(stop);
    expect(component.isExpandedStopCardVisible).toBeFalse();
    expect(component.selectedNearbyStop).toBe(stop);
    expect(feedbackService.lightImpact).toHaveBeenCalledTimes(1);
  });

  it('smoothly places a collapsed-map marker below centre to leave room for its popup', () => {
    const stop = { ...stops[0], distanceMeters: 100 };
    const setView = jasmine.createSpy('setView');
    const unproject = jasmine.createSpy('unproject').and.callFake((point: L.Point) => point);
    (component as any).map = {
      getZoom: () => 15,
      getSize: () => L.point(320, 180),
      project: () => L.point(100, 100),
      unproject,
      setView
    };
    component.isMapExpanded = false;

    (component as any).focusMapOnSelectedStop(stop);

    expect(unproject.calls.mostRecent().args[0].y).toBeCloseTo(64, 1);
    expect(setView).toHaveBeenCalledWith(jasmine.anything(), 16, jasmine.objectContaining({
      animate: true,
      duration: 0.38
    }));
  });

  it('uses the larger expanded-map selection offset without moving the marker off-screen', () => {
    const stop = { ...stops[0], distanceMeters: 100 };
    const unproject = jasmine.createSpy('unproject').and.callFake((point: L.Point) => point);
    (component as any).map = {
      getZoom: () => 16,
      getSize: () => L.point(700, 700),
      project: () => L.point(300, 300),
      unproject,
      setView: jasmine.createSpy('setView')
    };
    component.isMapExpanded = true;

    (component as any).focusMapOnSelectedStop(stop);

    expect(unproject.calls.mostRecent().args[0].y).toBe(244);
  });

  it('uses medium haptics for both favourite actions', () => {
    const stop = { ...stops[0], distanceMeters: 100 };

    component.toggleFavouriteStop(stop);
    component.toggleFavouriteStop(stop);

    expect(feedbackService.mediumImpact).toHaveBeenCalledTimes(2);
  });

  it('shows brief locate feedback and uses a light haptic', () => {
    jasmine.clock().install();
    component.hasUserLocation = true;
    (component as any).map = {
      getZoom: () => 15,
      setView: jasmine.createSpy('setView'),
      closePopup: () => undefined
    };

    component.recenterOnUserLocation();
    expect(component.isRecenteringMap).toBeTrue();
    expect(feedbackService.lightImpact).toHaveBeenCalledTimes(1);

    jasmine.clock().tick(460);
    expect(component.isRecenteringMap).toBeFalse();
    jasmine.clock().uninstall();
  });

  it('preserves selection while expanding and collapsing the same map element', () => {
    jasmine.clock().install();
    const card = document.createElement('section');
    spyOn(card, 'getBoundingClientRect').and.returnValue({
      top: 180, left: 18, width: 354, height: 194,
      right: 372, bottom: 374, x: 18, y: 180,
      toJSON: () => undefined
    });
    spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    (component as any).nearbyMapCardElement = { nativeElement: card };
    component.selectedNearbyStop = { ...stops[0], distanceMeters: 100 };
    component.isExpandedStopCardVisible = true;

    component.expandMap();
    expect(component.isMapExpanded).toBeTrue();

    component.collapseMap();
    jasmine.clock().tick(450);
    expect(component.isMapOverlayActive).toBeFalse();
    expect(component.selectedNearbyStop?.BusStopCode).toBe('01012');
    expect(component.isExpandedStopCardVisible).toBeFalse();
    expect(feedbackService.lightImpact).toHaveBeenCalledTimes(2);
    jasmine.clock().uninstall();
  });
});
