import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-gameroom',
  templateUrl: './gameroom.page.html',
  styleUrls: ['./gameroom.page.scss'],
})
export class GameroomPage {
  readonly routeId: string | null;

  constructor(private route: ActivatedRoute) {
    this.routeId = this.route.snapshot.paramMap.get('room_id');
  }
}
