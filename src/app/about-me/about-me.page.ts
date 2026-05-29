import { Component, Optional } from '@angular/core';
import { IonRouterOutlet, NavController } from '@ionic/angular';

@Component({
  selector: 'app-about-me',
  templateUrl: './about-me.page.html',
  styleUrls: ['./about-me.page.scss']
})
export class AboutMePage {
  constructor(
    private readonly navController: NavController,
    @Optional() private readonly routerOutlet?: IonRouterOutlet
  ) {}

  ionViewWillEnter(): void {
    if (this.routerOutlet) {
      this.routerOutlet.swipeGesture = true;
    }
  }

  goBack(): void {
    if (this.routerOutlet?.canGoBack()) {
      this.navController.back();
      return;
    }

    this.navController.navigateBack('/tabs/tab1');
  }
}
