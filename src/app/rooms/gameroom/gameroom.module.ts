import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular';

import { GameroomPageRoutingModule } from './gameroom-routing.module';

import { GameroomPage } from './gameroom.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    GameroomPageRoutingModule
  ],
  declarations: [GameroomPage]
})
export class GameroomPageModule {}
