const assert = require('node:assert/strict');
const test = require('node:test');
const { filterBusStops, normalizeSearchAliases } = require('./bus-stop-search');

const stops = [
  { BusStopCode: '59009', Description: 'Yishun Int', RoadName: 'Yishun Ave 2' },
  { BusStopCode: '59079', Description: 'Yishun Stn', RoadName: 'Yishun Ave 2' },
  { BusStopCode: '10000', Description: 'International Plaza', RoadName: 'Anson Rd' }
];

test('matches full, abbreviated, and partial alias searches', () => {
  assert.equal(filterBusStops(stops, 'Yishun Interchange')[0].BusStopCode, '59009');
  assert.equal(filterBusStops(stops, 'Yishun Int')[0].BusStopCode, '59009');
  assert.equal(filterBusStops(stops, 'Yishun inter')[0].BusStopCode, '59009');
  assert.equal(filterBusStops(stops, 'Yishun st')[0].BusStopCode, '59079');
});

test('does not replace aliases inside words', () => {
  assert.equal(normalizeSearchAliases('international'), 'international');
  assert.equal(filterBusStops(stops, 'international')[0].BusStopCode, '10000');
});

test('deduplicates repeated stop codes', () => {
  assert.equal(filterBusStops([stops[0], { ...stops[0] }], 'Yishun').length, 1);
});
