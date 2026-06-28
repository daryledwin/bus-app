import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MrtMapPage } from './mrt-map.page';
import { MrtMapPageRoutingModule } from './mrt-map-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    MrtMapPageRoutingModule
  ],
  declarations: [MrtMapPage]
})
export class MrtMapPageModule {}
