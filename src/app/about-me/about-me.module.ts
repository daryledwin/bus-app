import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { AboutMePageRoutingModule } from './about-me-routing.module';
import { AboutMePage } from './about-me.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    AboutMePageRoutingModule
  ],
  declarations: [AboutMePage]
})
export class AboutMePageModule {}
