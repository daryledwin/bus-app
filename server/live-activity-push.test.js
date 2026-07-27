const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const axios = require('axios');
const http2 = require('http2');

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.LTA_ACCOUNT_KEY = 'test-account-key';
process.env.APNS_TEAM_ID = 'TESTTEAM01';
process.env.APNS_KEY_ID = 'TESTKEY001';
process.env.APNS_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.APNS_LIVE_ACTIVITY_TOPIC = 'com.daryledwin.bus.push-type.liveactivity';

const apnsRequests = [];
const ltaRequests = [];
let ltaCallCount = 0;
let freezeLtaArrivals = false;
let frozenArrival = 0;
let visitNumbers = ['1', '2', '1'];

http2.connect = (host) => {
  const client = new EventEmitter();
  client.close = () => {};
  client.request = (headers) => {
    const request = new EventEmitter();
    request.setEncoding = () => {};
    request.setTimeout = () => {};
    request.destroy = (error) => request.emit('error', error);
    request.end = (body) => {
      apnsRequests.push({ host, headers, payload: JSON.parse(body) });
      queueMicrotask(() => {
        request.emit('response', { ':status': 200, 'apns-id': `test-${apnsRequests.length}` });
        request.emit('end');
      });
    };
    return request;
  };
  return client;
};

axios.get = async (url, options) => {
  ltaCallCount += 1;
  ltaRequests.push({ url, options });
  const baseArrival = freezeLtaArrivals
    ? frozenArrival
    : Date.now() + (4 + ltaCallCount) * 60 * 1000;
  return {
    status: 200,
    headers: {
      date: new Date().toUTCString(),
      age: '0',
      'cache-control': 'no-store'
    },
    data: {
      Services: [{
        ServiceNo: options.params.BusStopCode === '11111' ? '10' : '20',
        NextBus: {
          EstimatedArrival: new Date(baseArrival).toISOString(),
          VisitNumber: visitNumbers[0],
          Type: 'DD',
          Feature: 'WAB',
          Load: 'SEA'
        },
        NextBus2: {
          EstimatedArrival: new Date(baseArrival + 5 * 60 * 1000).toISOString(),
          VisitNumber: visitNumbers[1]
        },
        NextBus3: {
          EstimatedArrival: new Date(baseArrival + 10 * 60 * 1000).toISOString(),
          VisitNumber: visitNumbers[2]
        }
      }]
    }
  };
};

const {
  apnsTopic,
  liveActivityPushIntervalMs,
  liveActivitySessions,
  registerLiveActivitySession,
  refreshAllLiveActivitySessions
} = require('./server');

function session(activityId, busStopCode, serviceNo, apnsEnvironment) {
  const now = Date.now();
  return {
    activityId,
    pushToken: `token-${activityId}`,
    busStopCode,
    serviceNo,
    busStopName: `Stop ${busStopCode}`,
    apnsEnvironment,
    expiresAt: now + 30 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    active: true,
    refreshInFlight: false
  };
}

test.beforeEach(() => {
  liveActivitySessions.clear();
  apnsRequests.length = 0;
  ltaRequests.length = 0;
  ltaCallCount = 0;
  freezeLtaArrivals = false;
  frozenArrival = 0;
  visitNumbers = ['1', '2', '1'];
});

test('one session fetches fresh LTA data and sends a complete ActivityKit update', async () => {
  assert.equal(liveActivityPushIntervalMs, 15_000);
  liveActivitySessions.set('activity-one', session('activity-one', '11111', '10', 'development'));

  await refreshAllLiveActivitySessions('test-one');

  assert.equal(ltaRequests.length, 1);
  assert.equal(apnsRequests.length, 1);
  assert.equal(apnsTopic, 'com.daryledwin.bus.push-type.liveactivity');
  assert.equal(apnsRequests[0].host, 'https://api.sandbox.push.apple.com');
  assert.equal(apnsRequests[0].headers['apns-topic'], apnsTopic);
  assert.equal(apnsRequests[0].headers['apns-push-type'], 'liveactivity');
  assert.equal(ltaRequests[0].options.headers['cache-control'], 'no-cache, no-store, max-age=0');

  const aps = apnsRequests[0].payload.aps;
  assert.equal(aps.event, 'update');
  assert.ok(Math.abs(aps.timestamp - Math.floor(Date.now() / 1000)) <= 1);
  assert.deepEqual(Object.keys(aps['content-state']).sort(), [
    'arrivalAt',
    'arrivalStatus',
    'arrivalVisitNumber',
    'busType',
    'lastUpdatedAt',
    'nextArrivalTiming',
    'nextArrivalVisitNumber',
    'seatAvailability',
    'thirdArrivalTiming',
    'thirdArrivalVisitNumber',
    'wheelchairAccessible'
  ]);
  assert.equal(aps['content-state'].arrivalVisitNumber, 1);
  assert.equal(aps['content-state'].nextArrivalVisitNumber, 2);
  assert.equal(aps['content-state'].thirdArrivalVisitNumber, 1);
  assert.equal(liveActivitySessions.size, 1);
  assert.equal(liveActivitySessions.get('activity-one').refreshInFlight, false);
});

test('registration remains stored and a rotated token updates the same session', async () => {
  const registration = {
    activityId: 'activity-token-update',
    pushToken: 'first-token',
    busStopCode: '11111',
    serviceNo: '10',
    busStopName: 'Test stop',
    expiresAt: Date.now() + 30 * 60 * 1000,
    apnsEnvironment: 'production'
  };
  assert.equal(registerLiveActivitySession(registration).status, 'registered');
  const createdAt = liveActivitySessions.get(registration.activityId).createdAt;

  assert.equal(registerLiveActivitySession({ ...registration, pushToken: 'rotated-token' }).status, 'registered');
  while (liveActivitySessions.get(registration.activityId).refreshInFlight) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(liveActivitySessions.size, 1);
  assert.equal(liveActivitySessions.get(registration.activityId).apnsEnvironment, 'production');
  assert.equal(liveActivitySessions.get(registration.activityId).pushToken, 'rotated-token');
  assert.equal(liveActivitySessions.get(registration.activityId).createdAt, createdAt);
});

test('two sessions refresh independently and route to their build APNs environments', async () => {
  liveActivitySessions.set('activity-dev', session('activity-dev', '11111', '10', 'development'));
  liveActivitySessions.set('activity-prod', session('activity-prod', '22222', '20', 'production'));

  await refreshAllLiveActivitySessions('test-two');

  assert.equal(ltaRequests.length, 2);
  assert.equal(apnsRequests.length, 2);
  assert.deepEqual(new Set(apnsRequests.map((request) => request.host)), new Set([
    'https://api.sandbox.push.apple.com',
    'https://api.push.apple.com'
  ]));
  assert.equal(liveActivitySessions.size, 2);
  assert.ok(liveActivitySessions.get('activity-dev').lastContentState);
  assert.ok(liveActivitySessions.get('activity-prod').lastContentState);
});

test('unchanged arrival labels do not suppress the next APNs refresh', async () => {
  freezeLtaArrivals = true;
  frozenArrival = Date.now() + 8 * 60 * 1000;
  liveActivitySessions.set('activity-repeat', session('activity-repeat', '11111', '10', 'development'));

  await refreshAllLiveActivitySessions('first');
  await refreshAllLiveActivitySessions('second');

  assert.equal(ltaRequests.length, 2);
  assert.equal(apnsRequests.length, 2);
  assert.ok(apnsRequests[1].payload.aps.timestamp >= apnsRequests[0].payload.aps.timestamp);
});

test('a VisitNumber-only change updates the arrival change signature', async () => {
  freezeLtaArrivals = true;
  frozenArrival = Date.now() + 8 * 60 * 1000;
  liveActivitySessions.set('activity-visit-change', session('activity-visit-change', '11111', '10', 'development'));

  await refreshAllLiveActivitySessions('first-visit');
  const firstSignature = liveActivitySessions.get('activity-visit-change').lastArrivalSignature;

  visitNumbers = ['2', '2', '1'];
  await refreshAllLiveActivitySessions('second-visit');
  const secondSignature = liveActivitySessions.get('activity-visit-change').lastArrivalSignature;

  assert.notEqual(secondSignature, firstSignature);
  assert.equal(liveActivitySessions.get('activity-visit-change').lastContentState.arrivalVisitNumber, 2);
});
