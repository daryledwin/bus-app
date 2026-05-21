import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular';

import { CreatenamePageRoutingModule } from './createname-routing.module';

import { CreatenamePage } from './createname.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CreatenamePageRoutingModule
  ],
  declarations: [CreatenamePage]
})
export class CreatenamePageModule {}
