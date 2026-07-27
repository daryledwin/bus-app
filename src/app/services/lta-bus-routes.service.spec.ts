import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LtaBusRoutesService } from './lta-bus-routes.service';

describe('LtaBusRoutesService', () => {
  let httpTestingController: HttpTestingController;
  let service: LtaBusRoutesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });

    httpTestingController = TestBed.inject(HttpTestingController);
    service = TestBed.inject(LtaBusRoutesService);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('requests route records using the selected bus stop code', () => {
    let result: any[] = [];

    service.getBusRoutesForStop(' 25729 ').subscribe((routes) => {
      result = routes;
    });

    const request = httpTestingController.expectOne((candidate) =>
      candidate.url.endsWith('/api/bus-routes')
      && candidate.params.get('busStopCode') === '25729'
      && !candidate.params.has('serviceNo')
    );
    request.flush([
      { ServiceNo: '30', BusStopCode: '25729' },
      { ServiceNo: '176', BusStopCode: '25729' }
    ]);

    expect(result.map((route) => route.ServiceNo)).toEqual(['30', '176']);
  });
});
