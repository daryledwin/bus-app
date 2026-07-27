import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular';

import { BusArrivalEstimate, BusServiceArrival } from '../services/lta-bus.service';
import { Tab1Page } from './tab1.page';

describe('Tab1Page', () => {
  let component: Tab1Page;
  let fixture: ComponentFixture<Tab1Page>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [Tab1Page],
      imports: [FormsModule, HttpClientTestingModule, IonicModule.forRoot(), RouterTestingModule]
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(Tab1Page);
    component = fixture.componentInstance;
    spyOn(component, 'ngOnInit').and.stub();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows Loop 2 only on the specific second-visit arrival in a 1,2,1 sequence', () => {
    component.hasSearchedArrivals = true;
    component.liveBusServices = [arrivalService(1, 2, 1)];

    fixture.detectChanges();

    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.timing-card')
    ) as HTMLElement[];

    expect(cards[0].querySelector('.timing-card__loop-label')).toBeNull();
    expect(cards[1].querySelector('.timing-card__loop-label')?.textContent?.trim()).toBe('Loop 2');
    expect(cards[2].querySelector('.timing-card__loop-label')).toBeNull();
  });

  it('shows Loop 2 when NextBus itself is the second visit', () => {
    component.hasSearchedArrivals = true;
    component.liveBusServices = [arrivalService(2, 2, 1)];

    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.timing-card__loop-label')
    ) as HTMLElement[];

    expect(labels.map((label) => label.textContent?.trim())).toEqual(['Loop 2', 'Loop 2']);
  });

  it('shows no Loop 2 label for first, missing, or malformed-normalized visits', () => {
    component.hasSearchedArrivals = true;
    component.liveBusServices = [arrivalService(1, null, null)];

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.timing-card__loop-label')).toBeNull();
  });

  [393, 375, 320].forEach((deviceWidth) => {
    it(`keeps every ETA and Loop 2 stack centred and unclipped at ${deviceWidth}px`, () => {
      const service = arrivalService(2, 2, 2);
      service.nextBus.timing = 'Arriving';
      component.hasSearchedArrivals = true;
      component.expandedLiveServiceNo = service.serviceNo;
      component.liveBusServices = [service];

      fixture.detectChanges();

      const renderedRow = fixture.nativeElement.querySelector('.timing-row--compact') as HTMLElement;
      const layoutRow = renderedRow.cloneNode(true) as HTMLElement;
      layoutRow.style.left = '0';
      layoutRow.style.position = 'fixed';
      layoutRow.style.top = '0';
      layoutRow.style.visibility = 'hidden';
      layoutRow.style.width = `${deviceWidth - 40}px`;
      document.body.appendChild(layoutRow);

      try {
        const cards = Array.from(layoutRow.querySelectorAll('.timing-card')) as HTMLElement[];
        expect(cards.length).toBe(3);

        cards.forEach((card) => {
          const etaStack = card.querySelector('.timing-card__eta-stack') as HTMLElement;
          const eta = card.querySelector('.timing-card__eta') as HTMLElement;
          const loopLabel = card.querySelector('.timing-card__loop-label') as HTMLElement;
          const cardBounds = card.getBoundingClientRect();
          const etaBounds = eta.getBoundingClientRect();
          const loopBounds = loopLabel.getBoundingClientRect();
          const loopStyle = getComputedStyle(loopLabel);
          const stackStyle = getComputedStyle(etaStack);

          expect(cardBounds.width).toBeGreaterThan(0);
          expect(stackStyle.flexDirection).toBe('column');
          expect(stackStyle.textAlign).toBe('center');
          expect(loopStyle.fontSize).toBe('9.5px');
          expect(loopStyle.textAlign).toBe('center');
          expect(loopBounds.top).toBeGreaterThanOrEqual(etaBounds.bottom + 1);
          expect(loopBounds.left).toBeGreaterThanOrEqual(cardBounds.left);
          expect(loopBounds.right).toBeLessThanOrEqual(cardBounds.right);
          expect(eta.scrollWidth).toBeLessThanOrEqual(eta.clientWidth + 1);
          expect(loopLabel.scrollWidth).toBeLessThanOrEqual(loopLabel.clientWidth + 1);
        });
      } finally {
        layoutRow.remove();
      }
    });
  });
});

function arrivalService(
  nextVisitNumber: number | null,
  subsequentVisitNumber: number | null,
  thirdVisitNumber: number | null
): BusServiceArrival {
  return {
    serviceNo: '265',
    operator: 'SBST',
    nextBus: estimate('3 min', nextVisitNumber),
    subsequentBus: estimate('8 min', subsequentVisitNumber),
    thirdBus: estimate('14 min', thirdVisitNumber)
  };
}

function estimate(timing: string, visitNumber: number | null): BusArrivalEstimate {
  return {
    originCode: '55231',
    destinationCode: '55311',
    estimatedArrival: '2099-07-26T18:49:46+08:00',
    visitNumber,
    latitude: 1.37,
    longitude: 103.84,
    monitored: 1,
    minutesAway: 3,
    timing,
    load: 'Seats available',
    wheelchairAccessible: true,
    type: 'Single deck'
  };
}
