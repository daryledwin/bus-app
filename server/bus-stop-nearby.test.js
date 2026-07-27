const assert = require('node:assert/strict');
const test = require('node:test');
const { nearestBusStops, parseNearbyBusStopQuery } = require('./bus-stop-nearby');

const stops = Array.from({ length: 80 }, (_, index) => ({
  BusStopCode: String(index),
  Latitude: 1.30 + (index * 0.001),
  Longitude: 103.80
}));

test('returns a strictly capped nearest-stop set around the requested centre', () => {
  const query = parseNearbyBusStopQuery({ latitude: '1.32', longitude: '103.80', limit: '40' });
  const result = nearestBusStops(stops, query);

  assert.equal(result.length, 40);
  assert.equal(result[0].BusStopCode, '20');
});

test('caps oversized requests at fifty stops', () => {
  const query = parseNearbyBusStopQuery({ latitude: '1.30', longitude: '103.80', limit: '5000' });

  assert.equal(query.limit, 50);
  assert.equal(nearestBusStops(stops, query).length, 50);
});

test('rejects incomplete nearby queries and preserves existing unbounded calls', () => {
  assert.throws(
    () => parseNearbyBusStopQuery({ latitude: '1.30' }),
    /valid latitude, longitude, and limit/
  );
  assert.equal(parseNearbyBusStopQuery({}), null);
  assert.equal(nearestBusStops(stops, null), stops);
});
