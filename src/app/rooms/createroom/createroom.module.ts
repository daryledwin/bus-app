import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular';

import { CreateroomPageRoutingModule } from './createroom-routing.module';

import { CreateroomPage } from './createroom.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CreateroomPageRoutingModule
  ],
  declarations: [CreateroomPage]
})
export class CreateroomPageModule {}
