import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { MrtMapPage } from './mrt-map.page';

const routes: Routes = [
  {
    path: '',
    component: MrtMapPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MrtMapPageRoutingModule {}
