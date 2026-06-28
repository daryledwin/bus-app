import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { BusRoutesPage } from './bus-routes.page';

const routes: Routes = [
  {
    path: '',
    component: BusRoutesPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class BusRoutesPageRoutingModule {}
