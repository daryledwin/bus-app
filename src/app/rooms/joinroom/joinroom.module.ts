import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { JoinroomPageRoutingModule } from './joinroom-routing.module';

import { JoinroomPage } from './joinroom.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    JoinroomPageRoutingModule
  ],
  declarations: [JoinroomPage]
})
export class JoinroomPageModule {}
