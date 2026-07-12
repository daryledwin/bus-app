import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { PinnedBusesPage } from './pinned-buses.page';

const routes: Routes = [
  {
    path: '',
    component: PinnedBusesPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PinnedBusesPageRoutingModule {}
