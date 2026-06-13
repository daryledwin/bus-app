import { TestBed } from '@angular/core/testing';
import { IonContent } from '@ionic/angular';

import { SameTabScrollService } from './same-tab-scroll.service';

describe('SameTabScrollService', () => {
  let service: SameTabScrollService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SameTabScrollService);
  });

  it('does nothing when the content is already at the top', async () => {
    const content = {
      getScrollElement: () => Promise.resolve({ scrollTop: 4 })
    };

    expect(await service.toTop(content as unknown as IonContent)).toBeFalse();
  });
});
