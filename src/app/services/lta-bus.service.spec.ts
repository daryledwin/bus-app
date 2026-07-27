import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { LtaBusService } from './lta-bus.service';

describe('LtaBusService VisitNumber mapping', () => {
  let service: LtaBusService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });

    service = TestBed.inject(LtaBusService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
    service.ngOnDestroy();
  });

  it('normalizes string and numeric VisitNumber values independently for all three slots', () => {
    let result: any;

    service.getBusArrivals('54009', { retry: false }).subscribe((lookup) => {
      result = lookup.services[0];
    });

    const request = httpTestingController.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/api/bus-arrival`
        && candidate.params.get('busStopCode') === '54009'
    );
    request.flush({
      BusStopCode: '54009',
      Services: [{
        ServiceNo: '265',
        Operator: 'SBST',
        NextBus: {
          EstimatedArrival: '2099-07-26T18:49:46+08:00',
          VisitNumber: '1',
          Latitude: '1.3709876666666667',
          Longitude: '103.83625383333333',
          Monitored: '1'
        },
        NextBus2: {
          EstimatedArrival: '2099-07-26T18:56:29+08:00',
          VisitNumber: 2,
          Latitude: 1.374335,
          Longitude: 103.850862,
          Monitored: 1
        },
        NextBus3: {
          EstimatedArrival: '2099-07-26T19:03:54+08:00',
          VisitNumber: '1',
          Latitude: '0.0',
          Longitude: '0.0',
          Monitored: 0
        }
      }]
    });

    expect([
      result.nextBus.visitNumber,
      result.subsequentBus.visitNumber,
      result.thirdBus.visitNumber
    ]).toEqual([1, 2, 1]);
    expect(result.nextBus.latitude).toBeCloseTo(1.3709876666666667);
    expect(result.nextBus.longitude).toBeCloseTo(103.83625383333333);
    expect(result.nextBus.monitored).toBe(1);
    expect(result.subsequentBus.latitude).toBeCloseTo(1.374335);
    expect(result.thirdBus.monitored).toBe(0);
  });

  it('retains NextBus VisitNumber 2 and fails safely for missing or malformed later values', () => {
    let result: any;

    service.getBusArrivals('75009', { retry: false }).subscribe((lookup) => {
      result = lookup.services[0];
    });

    const request = httpTestingController.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/api/bus-arrival`
        && candidate.params.get('busStopCode') === '75009'
    );
    request.flush({
      BusStopCode: '75009',
      Services: [{
        ServiceNo: '291',
        Operator: 'SBST',
        NextBus: {
          EstimatedArrival: '2099-07-26T18:39:42+08:00',
          VisitNumber: '2'
        },
        NextBus2: {
          EstimatedArrival: '2099-07-26T18:43:31+08:00',
          VisitNumber: 'not-a-visit'
        },
        NextBus3: {
          EstimatedArrival: '2099-07-26T18:45:00+08:00'
        }
      }]
    });

    expect(result.nextBus.visitNumber).toBe(2);
    expect(result.subsequentBus.visitNumber).toBeNull();
    expect(result.thirdBus.visitNumber).toBeNull();
  });
});
