require('dotenv').config();

const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const https = require('https');
const http2 = require('http2');

const app = express();
// Render provides PORT at runtime; local development falls back to 3000.
const PORT = process.env.PORT || 3000;
// Keep the LTA AccountKey on the backend only. Configure it as a Render environment variable.
const accountKey = process.env.LTA_ACCOUNT_KEY;
const liveActivitySessionSecret = process.env.LIVE_ACTIVITY_SESSION_SECRET;
const apnsTeamId = process.env.APNS_TEAM_ID;
const apnsKeyId = process.env.APNS_KEY_ID;
const apnsPrivateKey = process.env.APNS_PRIVATE_KEY;
const apnsPrivateKeyBase64 = process.env.APNS_PRIVATE_KEY_BASE64;
const apnsPrivateKeyPath = process.env.APNS_PRIVATE_KEY_PATH;
const apnsTopic = process.env.APNS_LIVE_ACTIVITY_TOPIC
  || `${process.env.APNS_BUNDLE_ID || 'com.daryledwin.bus'}.push-type.liveactivity`;
const apnsEnvironment = (process.env.APNS_ENVIRONMENT || 'development').toLowerCase();
const liveActivityPushIntervalMs = Number(process.env.LIVE_ACTIVITY_PUSH_INTERVAL_MS) || 10 * 1000;
const liveActivityPushStaleAfterMs = Number(process.env.LIVE_ACTIVITY_PUSH_STALE_AFTER_MS) || 20 * 1000;
const ltaArrivalEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';
const ltaBusStopsEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
const ltaBusRoutesEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/BusRoutes';
const ltaTrainServiceAlertsEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts';
const busStopsPageSize = 500;
const busRoutesPageSize = 500;
const busStopsCacheTtl = 12 * 60 * 60 * 1000;
const busRoutesCacheTtl = 12 * 60 * 60 * 1000;
const busRoutesRefreshInterval = 10 * 60 * 60 * 1000;
const ltaHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20
});
let busStopsCache = null;
let busStopsCacheTime = 0;
let busStopsRequest = null;
let busRoutesCache = null;
let busRoutesCacheTime = 0;
let busRoutesRequest = null;
let busRoutesRefreshTimer = null;
const liveActivitySessions = new Map();
let liveActivityPushTimer = null;
let apnsJwtCache = null;

// CORS is enabled for Ionic dev, Capacitor iOS, and Render-hosted backend access.
const corsOptions = {
  origin: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({
  limit: '32kb'
}));

function hasAccountKey(res) {
  if (accountKey) {
    return true;
  }

  res.status(500).json({
    error: 'The LTA_ACCOUNT_KEY environment variable is missing.'
  });
  return false;
}

function ltaRequestOptions(params) {
  return {
    headers: {
      AccountKey: accountKey,
      accept: 'application/json'
    },
    httpsAgent: ltaHttpsAgent,
    params,
    timeout: 15000
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryLtaRequest(error) {
  const status = error.response && error.response.status;

  return !status || status === 429 || status >= 500;
}

async function getFromLta(url, params, attempts = 2) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await axios.get(url, ltaRequestOptions(params));
    } catch (error) {
      lastError = error;

      if (attempt === attempts - 1 || !shouldRetryLtaRequest(error)) {
        throw error;
      }

      await wait(800 * (attempt + 1));
    }
  }

  throw lastError;
}

function ltaFailure(res, error) {
  const status = error.response && error.response.status;

  return res.status(502).json({
    error: status
      ? `LTA DataMall returned status ${status}.`
      : 'Unable to reach LTA DataMall right now.'
  });
}

function cleanBusStop(stop) {
  return {
    BusStopCode: stop.BusStopCode,
    Description: stop.Description,
    RoadName: stop.RoadName,
    Latitude: stop.Latitude,
    Longitude: stop.Longitude
  };
}

function cleanBusRoute(route) {
  return {
    ServiceNo: route.ServiceNo,
    Operator: route.Operator,
    Direction: route.Direction,
    StopSequence: route.StopSequence,
    BusStopCode: route.BusStopCode,
    Distance: route.Distance,
    WD_FirstBus: route.WD_FirstBus,
    WD_LastBus: route.WD_LastBus,
    SAT_FirstBus: route.SAT_FirstBus,
    SAT_LastBus: route.SAT_LastBus,
    SUN_FirstBus: route.SUN_FirstBus,
    SUN_LastBus: route.SUN_LastBus
  };
}

function cleanTrainServiceAlert(alert) {
  const message = Array.isArray(alert.Message)
    ? alert.Message[0] || {}
    : alert.Message || {};

  return {
    Status: Number(alert.Status) || 0,
    Line: alert.Line || '',
    Direction: alert.Direction || '',
    Stations: alert.Stations || '',
    FreePublicBus: alert.FreePublicBus || '',
    FreeMRTShuttle: alert.FreeMRTShuttle || '',
    MRTShuttleDirection: alert.MRTShuttleDirection || '',
    Message: {
      Content: message.Content || '',
      CreatedDate: message.CreatedDate || ''
    }
  };
}

function normalizeServiceNo(serviceNo) {
  return String(serviceNo || '').trim().toUpperCase();
}

function minutesAway(estimatedArrival) {
  if (!estimatedArrival) {
    return null;
  }

  const arrivalTime = new Date(estimatedArrival).getTime();

  if (Number.isNaN(arrivalTime)) {
    return null;
  }

  return Math.max(0, Math.ceil((arrivalTime - Date.now()) / 60000));
}

function timingLabel(estimatedArrival) {
  const minutes = minutesAway(estimatedArrival);

  if (minutes === null) {
    return 'No Bus';
  }

  if (minutes <= 1) {
    return 'Arriving';
  }

  return `${minutes} min`;
}

function loadLabel(load) {
  switch (load) {
    case 'SEA':
      return 'Seats available';
    case 'SDA':
      return 'Few seats left';
    case 'LSD':
      return 'No chance of a seat';
    default:
      return 'Load unavailable';
  }
}

function typeLabel(type) {
  switch (type) {
    case 'SD':
      return 'Single deck';
    case 'DD':
      return 'Double deck';
    case 'BD':
      return 'Bendy bus';
    default:
      return 'Type unavailable';
  }
}

function swiftDateSecondsFromUnixMs(unixMs) {
  return (unixMs / 1000) - 978307200;
}

function unixMsFromEstimatedArrival(estimatedArrival) {
  if (!estimatedArrival) {
    return 0;
  }

  const arrivalTime = new Date(estimatedArrival).getTime();

  return Number.isNaN(arrivalTime) ? 0 : arrivalTime;
}

function buildLiveActivityContentState(service) {
  const nextBus = service.NextBus || {};
  const subsequentBus = service.NextBus2 || {};
  const lastUpdatedAt = Date.now();
  const arrivalAt = unixMsFromEstimatedArrival(nextBus.EstimatedArrival);

  return {
    arrivalStatus: timingLabel(nextBus.EstimatedArrival),
    nextArrivalTiming: timingLabel(subsequentBus.EstimatedArrival),
    thirdArrivalTiming: timingLabel((service.NextBus3 || {}).EstimatedArrival),
    busType: typeLabel(nextBus.Type),
    wheelchairAccessible: nextBus.Feature === 'WAB',
    seatAvailability: loadLabel(nextBus.Load),
    arrivalAt,
    arrivalAtForActivityKit: swiftDateSecondsFromUnixMs(arrivalAt || lastUpdatedAt),
    lastUpdatedAt,
    lastUpdatedAtForActivityKit: swiftDateSecondsFromUnixMs(lastUpdatedAt)
  };
}

function apnsHost() {
  return apnsEnvironment === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function loadApnsPrivateKey() {
  const rawKey = apnsPrivateKey
    || (apnsPrivateKeyBase64 ? Buffer.from(apnsPrivateKeyBase64, 'base64').toString('utf8') : '')
    || (apnsPrivateKeyPath ? fs.readFileSync(apnsPrivateKeyPath, 'utf8') : '');

  return rawKey.replace(/\\n/g, '\n').trim();
}

function apnsIsConfigured() {
  return Boolean(apnsTeamId && apnsKeyId && (apnsPrivateKey || apnsPrivateKeyBase64 || apnsPrivateKeyPath) && apnsTopic);
}

function apnsConfigStatus() {
  return {
    configured: apnsIsConfigured(),
    hasTeamId: Boolean(apnsTeamId),
    hasKeyId: Boolean(apnsKeyId),
    hasPrivateKey: Boolean(apnsPrivateKey || apnsPrivateKeyBase64 || apnsPrivateKeyPath),
    topic: apnsTopic,
    environment: apnsEnvironment
  };
}

function apnsJwt() {
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (apnsJwtCache && nowSeconds - apnsJwtCache.issuedAt < 45 * 60) {
    return apnsJwtCache.token;
  }

  const header = {
    alg: 'ES256',
    kid: apnsKeyId
  };
  const claims = {
    iss: apnsTeamId,
    iat: nowSeconds
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: loadApnsPrivateKey(),
    dsaEncoding: 'ieee-p1363'
  });
  const token = `${signingInput}.${base64Url(signature)}`;

  apnsJwtCache = {
    token,
    issuedAt: nowSeconds
  };

  return token;
}

function apnsPayloadForUpdate(contentState, expiresAt) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const staleDate = Math.floor((Date.now() + liveActivityPushStaleAfterMs) / 1000);
  const expirationDate = Math.floor(expiresAt / 1000);

  return {
    aps: {
      timestamp: nowSeconds,
      event: 'update',
      'content-state': activityKitContentState(contentState),
      'stale-date': staleDate,
      'dismissal-date': expirationDate
    }
  };
}

function apnsPayloadForEnd(contentState) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    aps: {
      timestamp: nowSeconds,
      event: 'end',
      'content-state': activityKitContentState(contentState),
      'dismissal-date': nowSeconds
    }
  };
}

function activityKitContentState(contentState) {
  return {
    arrivalStatus: contentState.arrivalStatus,
    nextArrivalTiming: contentState.nextArrivalTiming,
    thirdArrivalTiming: contentState.thirdArrivalTiming,
    busType: contentState.busType,
    wheelchairAccessible: contentState.wheelchairAccessible,
    seatAvailability: contentState.seatAvailability,
    arrivalAt: contentState.arrivalAtForActivityKit,
    lastUpdatedAt: contentState.lastUpdatedAtForActivityKit
  };
}

async function sendApnsLiveActivityPush(session, payload, reason) {
  if (!apnsIsConfigured()) {
    console.warn('[LiveActivity Push] APNs not configured; update push skipped.', {
      activityId: session.activityId,
      serviceNo: session.serviceNo,
      busStopCode: session.busStopCode,
      ...apnsConfigStatus()
    });

    return {
      sent: false,
      skipped: 'not_configured'
    };
  }

  const client = http2.connect(apnsHost());
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    let responseBody = '';
    let settled = false;
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${session.pushToken}`,
      authorization: `bearer ${apnsJwt()}`,
      'apns-topic': apnsTopic,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(session.expiresAt / 1000))
    });

    request.setEncoding('utf8');

    request.on('response', (headers) => {
      request.statusCode = Number(headers[':status']) || 0;
      request.apnsId = headers['apns-id'];
    });

    request.on('data', (chunk) => {
      responseBody += chunk;
    });

    request.on('end', () => {
      if (settled) {
        return;
      }

      settled = true;
      client.close();

      let reasonText = '';

      if (responseBody) {
        try {
          reasonText = JSON.parse(responseBody).reason || responseBody;
        } catch {
          reasonText = responseBody;
        }
      }

      console.log('[LiveActivity Push] APNs update response.', {
        reason,
        activityId: session.activityId,
        serviceNo: session.serviceNo,
        busStopCode: session.busStopCode,
        statusCode: request.statusCode,
        apnsReason: reasonText || 'OK',
        apnsId: request.apnsId,
        environment: apnsEnvironment,
        topic: apnsTopic
      });

      if (request.statusCode >= 200 && request.statusCode < 300) {
        resolve({
          sent: true,
          statusCode: request.statusCode,
          apnsId: request.apnsId
        });
        return;
      }

      const error = new Error(`APNs update failed with status ${request.statusCode}${reasonText ? `: ${reasonText}` : ''}`);
      error.statusCode = request.statusCode;
      error.apnsReason = reasonText;
      reject(error);
    });

    request.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      client.close();
      reject(error);
    });

    client.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });

    request.end(body);
  });
}

function isAuthorizedLiveActivityRequest(req) {
  if (!liveActivitySessionSecret) {
    return true;
  }

  return req.get('authorization') === `Bearer ${liveActivitySessionSecret}`;
}

async function refreshLiveActivitySession(session, reason) {
  if (!accountKey) {
    console.warn(`[LiveActivity Push] Skipped ${session.activityId}: LTA_ACCOUNT_KEY is missing.`);
    return;
  }

  if (Date.now() >= session.expiresAt) {
    liveActivitySessions.delete(session.activityId);
    console.log('[LiveActivity Push] Session expired.', {
      activityId: session.activityId,
      serviceNo: session.serviceNo,
      busStopCode: session.busStopCode,
      expiresAt: session.expiresAt
    });
    return;
  }

  if (session.refreshInFlight) {
    console.log('[LiveActivity Push] Refresh skipped because the previous cycle is still running.', {
      reason,
      activityId: session.activityId,
      serviceNo: session.serviceNo,
      busStopCode: session.busStopCode
    });
    return;
  }

  session.refreshInFlight = true;

  try {

  console.log('[LiveActivity Push] Backend LTA fetch started.', {
    reason,
    activityId: session.activityId,
    serviceNo: session.serviceNo,
    busStopCode: session.busStopCode
  });
  const response = await getFromLta(ltaArrivalEndpoint, {
    BusStopCode: session.busStopCode
  }, 3);
  const services = Array.isArray(response.data.Services) ? response.data.Services : [];
  const service = services.find((item) => normalizeServiceNo(item.ServiceNo) === session.serviceNo);

  console.log('[LiveActivity Push] Backend LTA fetch completed.', {
    reason,
    activityId: session.activityId,
    serviceNo: session.serviceNo,
    busStopCode: session.busStopCode,
    serviceCount: services.length,
    trackedServiceFound: Boolean(service)
  });

  if (!service) {
    console.warn(`[LiveActivity Push] Tracked service not found for activity=${session.activityId} stop=${session.busStopCode} service=${session.serviceNo}.`);
    return;
  }

  const contentState = buildLiveActivityContentState(service);

  console.log('[LiveActivity Push] Parsed arrival values.', {
    reason,
    activityId: session.activityId,
    serviceNo: session.serviceNo,
    busStopCode: session.busStopCode,
    estimatedArrivals: [service.NextBus, service.NextBus2, service.NextBus3]
      .map((bus) => (bus || {}).EstimatedArrival || null),
    arrivalStatus: contentState.arrivalStatus,
    nextArrivalTiming: contentState.nextArrivalTiming,
    thirdArrivalTiming: contentState.thirdArrivalTiming
  });

  if (!session.active || liveActivitySessions.get(session.activityId) !== session) {
    console.log('[LiveActivity Push] Discarding fetched state for an ended session.', {
      activityId: session.activityId,
      serviceNo: session.serviceNo,
      busStopCode: session.busStopCode
    });
    return;
  }

  await sendActivityKitUpdatePush(session, contentState, reason);
  session.lastContentState = contentState;
  session.updatedAt = Date.now();
  } finally {
    session.refreshInFlight = false;
  }
}

async function sendActivityKitUpdatePush(session, contentState, reason) {
  const payload = apnsPayloadForUpdate(contentState, session.expiresAt);

  console.log('[LiveActivity Push] Sending APNs update.', {
    reason,
    activityId: session.activityId,
    serviceNo: session.serviceNo,
    busStopCode: session.busStopCode,
    arrivalStatus: contentState.arrivalStatus,
    nextArrivalTiming: contentState.nextArrivalTiming,
    thirdArrivalTiming: contentState.thirdArrivalTiming,
    busType: contentState.busType,
    wheelchairAccessible: contentState.wheelchairAccessible,
    seatAvailability: contentState.seatAvailability,
    arrivalAt: contentState.arrivalAt,
    lastUpdatedAt: contentState.lastUpdatedAt,
    environment: apnsEnvironment,
    topic: apnsTopic
  });

  return sendApnsLiveActivityPush(session, payload, reason);
}

async function refreshAllLiveActivitySessions(reason) {
  const sessions = Array.from(liveActivitySessions.values());

  if (!sessions.length) {
    return;
  }

  console.log('[LiveActivity Push] Refresh cycle started.', {
    reason,
    sessionCount: sessions.length
  });

  await Promise.allSettled(sessions.map(async (session) => {
    try {
      await refreshLiveActivitySession(session, reason);
    } catch (error) {
      console.warn('[LiveActivity Push] Refresh failed.', {
        reason,
        activityId: session.activityId,
        serviceNo: session.serviceNo,
        busStopCode: session.busStopCode,
        statusCode: error.statusCode,
        apnsReason: error.apnsReason,
        message: error.message
      });

      if (error.apnsReason === 'BadDeviceToken'
        || error.apnsReason === 'DeviceTokenNotForTopic'
        || error.apnsReason === 'Unregistered'
        || error.apnsReason === 'ExpiredProviderToken') {
        liveActivitySessions.delete(session.activityId);
        console.log('[LiveActivity Push] Session removed after APNs failure.', {
          activityId: session.activityId,
          serviceNo: session.serviceNo,
          busStopCode: session.busStopCode,
          apnsReason: error.apnsReason
        });
      }
    }
  }));
}

function startLiveActivityPushLoop() {
  if (liveActivityPushTimer) {
    clearInterval(liveActivityPushTimer);
  }

  liveActivityPushTimer = setInterval(() => {
    refreshAllLiveActivitySessions('scheduled').catch((error) => {
      console.warn('[LiveActivity Push] Scheduled refresh cycle failed.', {
        message: error.message
      });
    });
  }, liveActivityPushIntervalMs);

  if (typeof liveActivityPushTimer.unref === 'function') {
    liveActivityPushTimer.unref();
  }

  console.log('[LiveActivity Push] Refresh loop started.', {
    intervalMs: liveActivityPushIntervalMs,
    staleAfterMs: liveActivityPushStaleAfterMs,
    ...apnsConfigStatus()
  });
}

function unwrapTrainServiceAlerts(rawResponse) {
  if (Array.isArray(rawResponse)) {
    return rawResponse;
  }

  if (Array.isArray(rawResponse && rawResponse.value)) {
    return rawResponse.value;
  }

  if (Array.isArray(rawResponse && rawResponse.alerts)) {
    return rawResponse.alerts;
  }

  if (Array.isArray(rawResponse && rawResponse.data)) {
    return rawResponse.data;
  }

  if (rawResponse && typeof rawResponse === 'object' && rawResponse.Status !== undefined) {
    return [rawResponse];
  }

  return [];
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function filterBusStops(stops, search) {
  const normalizedSearch = normalizeSearchText(search);

  if (!normalizedSearch) {
    return stops;
  }

  const tokens = normalizedSearch.split(' ').filter(Boolean);

  return stops.filter((stop) => {
    const searchableText = normalizeSearchText(`${stop.Description} ${stop.RoadName} ${stop.BusStopCode}`);

    return tokens.every((token) => searchableText.includes(token));
  });
}

async function fetchBusStops() {
  const cachedStopsAreFresh = busStopsCache && Date.now() - busStopsCacheTime < busStopsCacheTtl;

  if (cachedStopsAreFresh) {
    return busStopsCache;
  }

  if (busStopsRequest) {
    return busStopsRequest;
  }

  busStopsRequest = (async () => {
    const stops = [];
    let skip = 0;

    while (true) {
      const response = await getFromLta(ltaBusStopsEndpoint, {
        $skip: skip
      });
      const page = Array.isArray(response.data.value) ? response.data.value : [];

      stops.push(...page.map(cleanBusStop));

      if (page.length < busStopsPageSize) {
        busStopsCache = stops;
        busStopsCacheTime = Date.now();
        return busStopsCache;
      }

      skip += busStopsPageSize;
    }
  })();

  try {
    return await busStopsRequest;
  } finally {
    busStopsRequest = null;
  }
}

async function fetchBusRoutes(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const reason = options.reason || 'request';
  const cachedRoutesAreFresh = busRoutesCache && Date.now() - busRoutesCacheTime < busRoutesCacheTtl;

  if (cachedRoutesAreFresh && !forceRefresh) {
    return busRoutesCache;
  }

  if (busRoutesRequest) {
    console.log(`[BusRoutes cache] Reusing in-flight cache warm for ${reason}.`);
    return busRoutesRequest;
  }

  busRoutesRequest = (async () => {
    const startedAt = Date.now();
    const routes = [];
    let skip = 0;

    console.log(`[BusRoutes cache] Warming started (${reason}).`);

    while (true) {
      const response = await getFromLta(ltaBusRoutesEndpoint, {
        $skip: skip
      });
      const page = Array.isArray(response.data.value) ? response.data.value : [];

      routes.push(...page.map(cleanBusRoute));

      if (page.length < busRoutesPageSize) {
        busRoutesCache = routes;
        busRoutesCacheTime = Date.now();
        console.log(
          `[BusRoutes cache] Warming succeeded (${reason}) in ${Date.now() - startedAt}ms. Cached ${busRoutesCache.length} route records.`
        );
        return busRoutesCache;
      }

      skip += busRoutesPageSize;
    }
  })();

  try {
    return await busRoutesRequest;
  } catch (error) {
    console.error(`[BusRoutes cache] Warming failed (${reason}).`, error.message);
    throw error;
  } finally {
    busRoutesRequest = null;
  }
}

function warmBusRoutesCache(reason = 'startup') {
  if (!accountKey) {
    console.warn(`[BusRoutes cache] Warming skipped (${reason}): LTA_ACCOUNT_KEY is missing.`);
    return;
  }

  fetchBusRoutes({
    forceRefresh: true,
    reason
  }).catch(() => {
    // fetchBusRoutes logs the failure. Keep the server running and try again later.
  });
}

function startBusRoutesCacheWarmers() {
  warmBusRoutesCache('startup');

  if (busRoutesRefreshTimer) {
    clearInterval(busRoutesRefreshTimer);
  }

  busRoutesRefreshTimer = setInterval(() => {
    warmBusRoutesCache('background refresh');
  }, busRoutesRefreshInterval);

  if (typeof busRoutesRefreshTimer.unref === 'function') {
    busRoutesRefreshTimer.unref();
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok'
  });
});

app.post('/api/live-activity-sessions', async (req, res) => {
  if (!isAuthorizedLiveActivityRequest(req)) {
    return res.status(401).json({
      error: 'Unauthorized live activity session request.'
    });
  }

  const activityId = String(req.body.activityId || '').trim();
  const pushToken = String(req.body.pushToken || '').trim();
  const busStopCode = String(req.body.busStopCode || '').trim();
  const serviceNo = normalizeServiceNo(req.body.serviceNo);
  const busStopName = String(req.body.busStopName || '').trim();
  const expiresAt = Number(req.body.expiresAt) || Date.now() + 30 * 60 * 1000;

  if (!activityId || !pushToken || !/^\d{5}$/.test(busStopCode) || !/^[A-Z0-9]+$/.test(serviceNo)) {
    return res.status(400).json({
      error: 'Please provide activityId, pushToken, busStopCode, and serviceNo.'
    });
  }

  const session = {
    activityId,
    pushToken,
    busStopCode,
    serviceNo,
    busStopName,
    expiresAt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    refreshInFlight: false
  };

  liveActivitySessions.set(activityId, session);
  console.log('[LiveActivity Push] Session registered.', {
    activityId,
    serviceNo,
    busStopCode,
    expiresAt,
    pushTokenLength: pushToken.length,
    ...apnsConfigStatus()
  });
  console.log('[LiveActivity Push] Push token received.', {
    activityId,
    serviceNo,
    busStopCode,
    pushTokenLength: pushToken.length
  });

  refreshLiveActivitySession(session, 'registered').catch((error) => {
    console.warn('[LiveActivity Push] Initial refresh failed.', {
      activityId,
      serviceNo,
      busStopCode,
      error: error.message
    });
  });

  return res.status(202).json({
    status: 'registered'
  });
});

app.post('/api/live-activity-sessions/:activityId/refresh', async (req, res) => {
  if (!isAuthorizedLiveActivityRequest(req)) {
    return res.status(401).json({
      error: 'Unauthorized live activity session request.'
    });
  }

  const activityId = String(req.params.activityId || '').trim();
  const session = liveActivitySessions.get(activityId);

  if (!session) {
    return res.status(404).json({ error: 'Live Activity session not found.' });
  }

  try {
    await refreshLiveActivitySession(session, `app-${String(req.body.reason || 'manual')}`);
    return res.status(202).json({ status: 'refreshed' });
  } catch (error) {
    console.warn('[LiveActivity Push] App-requested refresh failed; previous state retained.', {
      activityId,
      serviceNo: session.serviceNo,
      busStopCode: session.busStopCode,
      message: error.message
    });
    return res.status(202).json({ status: 'retry_scheduled' });
  }
});

app.delete('/api/live-activity-sessions/:activityId', async (req, res) => {
  if (!isAuthorizedLiveActivityRequest(req)) {
    return res.status(401).json({
      error: 'Unauthorized live activity session request.'
    });
  }

  const activityId = String(req.params.activityId || '').trim();
  const session = liveActivitySessions.get(activityId);
  let endPush = { sent: false, skipped: 'session_not_found' };

  if (session) {
    session.active = false;
    const contentState = session.lastContentState || {
      arrivalStatus: 'Tracking ended',
      nextArrivalTiming: 'No Bus',
      thirdArrivalTiming: 'No Bus',
      busType: 'Type unavailable',
      wheelchairAccessible: false,
      seatAvailability: 'Load unavailable',
      arrivalAtForActivityKit: swiftDateSecondsFromUnixMs(Date.now()),
      lastUpdatedAtForActivityKit: swiftDateSecondsFromUnixMs(Date.now())
    };

    try {
      endPush = await sendApnsLiveActivityPush(session, apnsPayloadForEnd(contentState), 'stopped');
    } catch (error) {
      console.warn('[LiveActivity Push] APNs end failed; deleting session.', {
        activityId,
        serviceNo: session.serviceNo,
        busStopCode: session.busStopCode,
        statusCode: error.statusCode,
        apnsReason: error.apnsReason,
        message: error.message
      });
      endPush = { sent: false, error: error.message };
    }
  }

  const deleted = liveActivitySessions.delete(activityId);

  console.log('[LiveActivity Push] Session deleted.', {
    activityId,
    deleted,
    serviceNo: session && session.serviceNo,
    busStopCode: session && session.busStopCode,
    endPush
  });

  return res.json({
    status: deleted ? 'ended' : 'not_found'
  });
});

app.get('/api/bus-arrival', async (req, res) => {
  const busStopCode = String(req.query.busStopCode || '').trim();
  const liveTrackReason = String(req.query._liveTrackReason || '').trim();

  if (!/^\d{5}$/.test(busStopCode)) {
    return res.status(400).json({
      error: 'Please provide a valid 5-digit bus stop code.'
    });
  }

  if (!hasAccountKey(res)) {
    return;
  }

  try {
    res.set('Cache-Control', 'no-store');
    console.log('[LiveTrack] backend bus arrival request received', {
      busStopCode,
      reason: liveTrackReason || 'app',
      receivedAt: new Date().toISOString()
    });
    const response = await getFromLta(ltaArrivalEndpoint, {
      BusStopCode: busStopCode
    }, 3);

    return res.json(response.data);
  } catch (error) {
    return ltaFailure(res, error);
  }
});

app.get('/api/bus-stops', async (req, res) => {
  if (!hasAccountKey(res)) {
    return;
  }

  try {
    const stops = await fetchBusStops();

    return res.json(filterBusStops(stops, req.query.search));
  } catch (error) {
    return ltaFailure(res, error);
  }
});

app.get('/api/bus-routes', async (req, res) => {
  const serviceNo = String(req.query.serviceNo || '').trim().toUpperCase();

  if (!/^[A-Z0-9]+$/.test(serviceNo)) {
    return res.status(400).json({
      error: 'Please provide a valid bus service number.'
    });
  }

  if (!hasAccountKey(res)) {
    return;
  }

  try {
    const lookupStartedAt = Date.now();
    const routes = await fetchBusRoutes();
    const filteredRoutes = routes.filter((route) => String(route.ServiceNo || '').toUpperCase() === serviceNo);

    console.log(
      `[BusRoutes cache] Lookup for ${serviceNo} returned ${filteredRoutes.length} records in ${Date.now() - lookupStartedAt}ms.`
    );

    return res.json(filteredRoutes);
  } catch (error) {
    return ltaFailure(res, error);
  }
});

app.get('/api/train-service-alerts', async (req, res) => {
  if (!hasAccountKey(res)) {
    return;
  }

  try {
    console.log(`[TrainServiceAlerts] Request URL: ${ltaTrainServiceAlertsEndpoint}`);
    const response = await getFromLta(ltaTrainServiceAlertsEndpoint, undefined, 3);
    console.log(`[TrainServiceAlerts] HTTP status: ${response.status}`);
    console.log('[TrainServiceAlerts] Raw JSON response:', JSON.stringify(response.data));

    const alerts = unwrapTrainServiceAlerts(response.data);
    console.log(`[TrainServiceAlerts] Parsed alert count: ${alerts.length}`);

    return res.json(alerts.map(cleanTrainServiceAlert));
  } catch (error) {
    console.error('[TrainServiceAlerts] Caught error object:', {
      message: error.message,
      status: error.response && error.response.status,
      data: error.response && error.response.data,
      code: error.code
    });
    return ltaFailure(res, error);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LTA bus proxy listening on port ${PORT}`);
  startBusRoutesCacheWarmers();
  startLiveActivityPushLoop();
});
