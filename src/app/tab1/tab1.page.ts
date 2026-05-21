import { Component } from '@angular/core';

interface NearbyBus {
  service: string;
  destination: string;
  stop: string;
  arrival: string;
  nextArrival: string;
  occupancy: string;
  deck: string;
  load: 'light' | 'steady' | 'cozy';
  arriving?: boolean;
}

interface SavedRoute {
  label: string;
  route: string;
  note: string;
  icon: string;
  tone: 'sage' | 'sun' | 'clay';
}

interface NavItem {
  label: string;
  icon: string;
  active?: boolean;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page {
  readonly greeting = 'good morning';

  readonly suggestedStops = [
    'near me',
    'bus 143',
    'Tiong Bahru',
    'Dhoby Ghaut'
  ];

  readonly nearbyBuses: NearbyBus[] = [
    {
      service: '156',
      destination: 'Clementi Interchange',
      stop: 'Opp NEX',
      arrival: '4 min',
      nextArrival: 'next in 11 min',
      occupancy: 'Seats likely',
      deck: 'single deck',
      load: 'light'
    },
    {
      service: '53',
      destination: 'Changi Airport Terminal 2',
      stop: 'Serangoon Stn Exit C',
      arrival: 'Now',
      nextArrival: 'next in 9 min',
      occupancy: 'Standing room',
      deck: 'double deck',
      load: 'steady',
      arriving: true
    },
    {
      service: '147',
      destination: 'Hougang Central',
      stop: 'S\'goon Ctrl',
      arrival: '7 min',
      nextArrival: 'next in 14 min',
      occupancy: 'Quite full',
      deck: 'single deck',
      load: 'cozy'
    }
  ];

  readonly savedRoutes: SavedRoute[] = [
    {
      label: 'Home',
      route: 'Serangoon to Toa Payoh',
      note: 'Bus 73 · mellow morning',
      icon: 'home-outline',
      tone: 'sage'
    },
    {
      label: 'School',
      route: 'NEX to Bukit Timah',
      note: 'Bus 156 · 31 min',
      icon: 'school-outline',
      tone: 'sun'
    },
    {
      label: 'Work',
      route: 'Dhoby Ghaut to One-North',
      note: 'Bus 95 · easy transfer',
      icon: 'briefcase-outline',
      tone: 'clay'
    }
  ];

  readonly recentPlaces = [
    'Botanic Gardens',
    'Joo Chiat',
    'Marina South'
  ];

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home-outline', active: true },
    { label: 'Explore', icon: 'map-outline' },
    { label: 'Saved', icon: 'bookmark-outline' },
    { label: 'Nearby', icon: 'navigate-outline' },
    { label: 'Profile', icon: 'person-circle-outline' }
  ];
}
