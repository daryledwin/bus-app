import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';

import { PinnedBusesPageRoutingModule } from './pinned-buses-routing.module';
import { PinnedBusesPage } from './pinned-buses.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    PinnedBusesPageRoutingModule
  ],
  declarations: [PinnedBusesPage]
})
export class PinnedBusesPageModule {}
