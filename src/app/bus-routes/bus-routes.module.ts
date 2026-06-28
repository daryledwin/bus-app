import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { BusRoutesPage } from './bus-routes.page';
import { BusRoutesPageRoutingModule } from './bus-routes-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    BusRoutesPageRoutingModule
  ],
  declarations: [BusRoutesPage]
})
export class BusRoutesPageModule {}
