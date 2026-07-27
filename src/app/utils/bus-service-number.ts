export interface BusRouteServiceRecord {
  ServiceNo?: string;
}

export function normalizeBusServiceNumber(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function compareBusServiceNumbers(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

export function uniqueSortedBusServiceNumbers(routes: BusRouteServiceRecord[]): string[] {
  const serviceNumbers = routes
    .map((route) => normalizeBusServiceNumber(route?.ServiceNo))
    .filter(Boolean);

  return Array.from(new Set(serviceNumbers)).sort(compareBusServiceNumbers);
}
