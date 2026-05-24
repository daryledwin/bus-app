require('dotenv').config();

const axios = require('axios');
const cors = require('cors');
const express = require('express');

const app = express();
// Render provides PORT at runtime; local development falls back to 3000.
const PORT = process.env.PORT || 3000;
// Keep the LTA AccountKey on the backend only. Configure it as a Render environment variable.
const accountKey = process.env.LTA_ACCOUNT_KEY;
const ltaArrivalEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';
const ltaBusStopsEndpoint = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
const busStopsPageSize = 500;
const busStopsCacheTtl = 12 * 60 * 60 * 1000;
let busStopsCache = null;
let busStopsCacheTime = 0;
let busStopsRequest = null;

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
    params,
    timeout: 10000
  };
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
      const response = await axios.get(ltaBusStopsEndpoint, ltaRequestOptions({
        $skip: skip
      }));
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
    const response = await axios.get(ltaArrivalEndpoint, ltaRequestOptions({
      BusStopCode: busStopCode
    }));

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LTA bus proxy listening on port ${PORT}`);
});
