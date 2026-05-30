require('dotenv').config();

const axios = require('axios');
const cors = require('cors');
const express = require('express');
const https = require('https');

const app = express();
// Render provides PORT at runtime; local development falls back to 3000.
const PORT = process.env.PORT || 3000;
// Keep the LTA AccountKey on the backend only. Configure it as a Render environment variable.
const accountKey = process.env.LTA_ACCOUNT_KEY;
const ltaArrivalEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';
const ltaBusStopsEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
const ltaBusRoutesEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/BusRoutes';
const busStopsPageSize = 500;
const busRoutesPageSize = 500;
const busStopsCacheTtl = 12 * 60 * 60 * 1000;
const busRoutesCacheTtl = 12 * 60 * 60 * 1000;
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

// CORS is enabled for Ionic dev, Capacitor iOS, and Render-hosted backend access.
const corsOptions = {
  origin: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

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
      AccountKey: accountKey
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

async function fetchBusRoutes() {
  const cachedRoutesAreFresh = busRoutesCache && Date.now() - busRoutesCacheTime < busRoutesCacheTtl;

  if (cachedRoutesAreFresh) {
    return busRoutesCache;
  }

  if (busRoutesRequest) {
    return busRoutesRequest;
  }

  busRoutesRequest = (async () => {
    const routes = [];
    let skip = 0;

    while (true) {
      const response = await getFromLta(ltaBusRoutesEndpoint, {
        $skip: skip
      });
      const page = Array.isArray(response.data.value) ? response.data.value : [];

      routes.push(...page.map(cleanBusRoute));

      if (page.length < busRoutesPageSize) {
        busRoutesCache = routes;
        busRoutesCacheTime = Date.now();
        return busRoutesCache;
      }

      skip += busRoutesPageSize;
    }
  })();

  try {
    return await busRoutesRequest;
  } finally {
    busRoutesRequest = null;
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok'
  });
});

app.get('/api/bus-arrival', async (req, res) => {
  const busStopCode = String(req.query.busStopCode || '').trim();

  if (!/^\d{5}$/.test(busStopCode)) {
    return res.status(400).json({
      error: 'Please provide a valid 5-digit bus stop code.'
    });
  }

  if (!hasAccountKey(res)) {
    return;
  }

  try {
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
    const routes = await fetchBusRoutes();

    return res.json(routes.filter((route) => String(route.ServiceNo || '').toUpperCase() === serviceNo));
  } catch (error) {
    return ltaFailure(res, error);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LTA bus proxy listening on port ${PORT}`);
});
