import { of, throwError } from 'rxjs';

import { PinnedBusesPage } from './pinned-buses.page';

describe('PinnedBusesPage manual pinning', () => {
  const stop = {
    BusStopCode: '54009',
    Description: 'Ang Mo Kio Int',
    RoadName: 'Ang Mo Kio Ave 8',
    Latitude: 1.3696,
    Longitude: 103.8485
  };

  let feedback: { info: jasmine.Spy; lightImpact: jasmine.Spy };
  let widgetBridge: { syncWidgetData: jasmine.Spy };
  let routesService: { getBusRoutesForStop: jasmine.Spy };
  let page: PinnedBusesPage;

  beforeEach(() => {
    localStorage.clear();
    feedback = {
      info: jasmine.createSpy('info').and.returnValue(Promise.resolve()),
      lightImpact: jasmine.createSpy('lightImpact').and.returnValue(Promise.resolve())
    };
    widgetBridge = {
      syncWidgetData: jasmine.createSpy('syncWidgetData')
    };
    routesService = {
      getBusRoutesForStop: jasmine.createSpy('getBusRoutesForStop').and.returnValue(of([]))
    };

    page = new PinnedBusesPage(
      { getBusStops: () => of([stop]) } as any,
      routesService as any,
      {} as any,
      {} as any,
      feedback as any,
      widgetBridge as any
    );
    page.selectedBusStop = stop;
    page.isAddBusSheetOpen = true;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('writes the existing pin format and refreshes the page immediately', async () => {
    await page.pinSelectedService('265M');

    expect(JSON.parse(localStorage.getItem('pinnedBusServicesByStop') || '{}')).toEqual({
      '54009': ['265M']
    });
    expect(page.pinnedGroups.length).toBe(1);
    expect(page.pinnedGroups[0].services).toEqual(['265M']);
    expect(page.isAddBusSheetOpen).toBeFalse();
    expect(widgetBridge.syncWidgetData).toHaveBeenCalled();
    expect(feedback.info).toHaveBeenCalledWith('Bus 265M pinned at Ang Mo Kio Int');
  });

  it('does not add a duplicate stop and service pin', async () => {
    localStorage.setItem('pinnedBusServicesByStop', JSON.stringify({
      '54009': ['265']
    }));

    await page.pinSelectedService(' 265 ');

    expect(JSON.parse(localStorage.getItem('pinnedBusServicesByStop') || '{}')).toEqual({
      '54009': ['265']
    });
    expect(widgetBridge.syncWidgetData).not.toHaveBeenCalled();
    expect(feedback.info).toHaveBeenCalledWith('Bus 265 is already pinned at Ang Mo Kio Int');
  });

  it('passes the selected stop code and displays returned route services', async () => {
    const abbottStop = {
      ...stop,
      BusStopCode: '25729',
      Description: 'Abbott'
    };
    routesService.getBusRoutesForStop.and.returnValue(of([
      { ServiceNo: '176' },
      { ServiceNo: '30' },
      { ServiceNo: '176' }
    ]));

    await page.selectBusStop(abbottStop);

    expect(routesService.getBusRoutesForStop).toHaveBeenCalledOnceWith('25729');
    expect(page.availableServices).toEqual(['30', '176']);
    expect(page.stopServicesError).toBe('');
    expect(page.hasNoStopServices).toBeFalse();
  });

  it('uses the empty state when a successful route request returns no services', async () => {
    await page.selectBusStop(stop);

    expect(page.availableServices).toEqual([]);
    expect(page.stopServicesError).toBe('');
    expect(page.hasNoStopServices).toBeTrue();
  });

  it('uses the error state only when the route request fails', async () => {
    routesService.getBusRoutesForStop.and.returnValue(throwError({ status: 503 }));

    await page.selectBusStop(stop);

    expect(page.hasNoStopServices).toBeFalse();
    expect(page.stopServicesError).toBe('Bus services couldn’t be loaded. Check your connection and try again.');
  });
});
