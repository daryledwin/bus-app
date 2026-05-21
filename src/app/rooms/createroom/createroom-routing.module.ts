import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { CreateroomPage } from './createroom.page';

const routes: Routes = [
  {
    path: '',
    component: CreateroomPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CreateroomPageRoutingModule {}
