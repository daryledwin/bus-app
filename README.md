# Cozy Singapore Bus App

## Local LTA Bus Proxy

The Ionic app calls a local proxy so the browser does not call LTA DataMall directly. Its frontend base URL is configured with `apiBaseUrl` in `src/environments/environment.ts`.

1. Put the LTA DataMall AccountKey in `server/.env`:

   ```env
   LTA_ACCOUNT_KEY=your_lta_datamall_account_key
   ```

2. Install and start the proxy:

   ```sh
   cd server
   npm install
   node server.js
   ```

3. In another terminal, start Ionic:

   ```sh
   ionic serve
   ```

For desktop browser, phone, and native iOS testing, keep the frontend pointed at the Render backend:

```ts
apiBaseUrl: 'https://bus-app-vk72.onrender.com'
```

Then start Ionic with:

```sh
ionic serve --external
```

Use the IP address shown by Ionic to open the app from another device. API calls should still go to Render, not a stale local backend.

The proxy provides:

- `GET /api/bus-arrival?busStopCode=XXXXX` for live arrivals at a validated 5-digit bus stop code.
- `GET /api/bus-stops` for the LTA Bus Stops dataset used by name and road search.
- `POST /api/live-activity-sessions` to register an ActivityKit activity ID, push token, tracked stop code, and service number for server-driven Live Activity updates.
- `POST /api/live-activity-sessions/:activityId/refresh` to request an optional immediate backend refresh while the app is open.
- `DELETE /api/live-activity-sessions/:activityId` to end a backend Live Activity tracking session.

The Bus Stops proxy response is sanitized to `BusStopCode`, `Description`, `RoadName`, `Latitude`, and `Longitude`. It fetches the paged DataMall dataset once and keeps it in an in-memory cache before refreshing later.

## Live Activity Updates

The iOS app requests each Live Activity with `pushType: .token`, observes token updates, and registers the activity ID, push token, stop, service, and signed-build APNs environment with the backend. The backend is the source of truth in both foreground and background: it fetches LTA arrivals every 15 seconds and sends complete replacement content state through APNs. Each activity is stored and refreshed independently. The widget renders the supplied `ContentState` labels directly and does not run a local ETA countdown.

Stopping tracking sends an APNs `end` event and deletes only that activity's backend session. Configure `APNS_TEAM_ID`, `APNS_KEY_ID`, an APNs private key, and `APNS_LIVE_ACTIVITY_TOPIC=com.daryledwin.bus.push-type.liveactivity` on Render. Debug activity tokens are routed to the APNs sandbox and Release activity tokens are routed to production based on the environment registered with each token.

During Live Activity diagnosis, `GET /health` reports the loop interval, APNs configuration status, exact topic, and active session count. The authorized `GET /api/live-activity-sessions` endpoint lists non-secret session diagnostics, including activity ID, stop, service, environment, timestamps, refresh state, and a one-way push-token fingerprint.

## Render Deployment

Create a Render Web Service for the Express proxy with:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `LTA_ACCOUNT_KEY`

Render provides `PORT` automatically. The proxy listens on `0.0.0.0` and exposes `GET /health`, which returns `{ "status": "ok" }`.
