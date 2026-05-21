import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { GameroomPage } from './gameroom.page';

const routes: Routes = [
  {
    path: '',
    component: GameroomPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class GameroomPageRoutingModule {}
