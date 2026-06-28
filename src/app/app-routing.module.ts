import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { OnboardingService } from './services/onboarding.service';

const routes: Routes = [
  {
    path: 'onboarding',
    loadChildren: () => import('./onboarding/onboarding.module').then(m => m.OnboardingPageModule)
  },
  {
    path: 'about-me',
    canActivate: [OnboardingService],
    loadChildren: () => import('./about-me/about-me.module').then(m => m.AboutMePageModule)
  },
  {
    path: 'bus-routes',
    canActivate: [OnboardingService],
    loadChildren: () => import('./bus-routes/bus-routes.module').then(m => m.BusRoutesPageModule)
  },
  {
    path: 'mrt-map',
    canActivate: [OnboardingService],
    loadChildren: () => import('./mrt-map/mrt-map.module').then(m => m.MrtMapPageModule)
  },
  {
    path: 'settings',
    redirectTo: '/tabs/settings',
    pathMatch: 'full'
  },
  {
    path: '',
    canActivate: [OnboardingService],
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },
  {
    path: '**',
    redirectTo: '/tabs/tab1'
  },
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
