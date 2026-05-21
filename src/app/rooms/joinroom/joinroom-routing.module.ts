import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { JoinroomPage } from './joinroom.page';

const routes: Routes = [
  {
    path: '',
    component: JoinroomPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class JoinroomPageRoutingModule {}
