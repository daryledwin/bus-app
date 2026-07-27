const test = require('node:test');
const assert = require('node:assert/strict');

const { filterBusRouteRecords, parseBusRouteQuery } = require('./bus-route-filter');

const routes = [
  { ServiceNo: '30', BusStopCode: '25729' },
  { ServiceNo: '176', BusStopCode: '25729' },
  { ServiceNo: '176', BusStopCode: '25729' },
  { ServiceNo: '30', BusStopCode: '25719' }
];

test('accepts a bus-stop-only route query', () => {
  const query = parseBusRouteQuery({ busStopCode: ' 25729 ' });

  assert.deepEqual(query, { serviceNo: '', busStopCode: '25729' });
  assert.deepEqual(
    filterBusRouteRecords(routes, query).map((route) => route.ServiceNo),
    ['30', '176', '176']
  );
});

test('preserves the existing service-number query', () => {
  const query = parseBusRouteQuery({ serviceNo: ' 176 ' });

  assert.deepEqual(query, { serviceNo: '176', busStopCode: '' });
  assert.equal(filterBusRouteRecords(routes, query).length, 2);
});

test('rejects invalid and missing route filters', () => {
  assert.throws(() => parseBusRouteQuery({}), /service number or bus stop code/);
  assert.throws(() => parseBusRouteQuery({ busStopCode: '2572' }), /valid 5-digit/);
});
