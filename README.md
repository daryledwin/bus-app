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

For desktop browser testing, keep:

```ts
apiBaseUrl: 'http://localhost:3000'
```

For phone testing on the same Wi-Fi network, change it to your Mac LAN IP before running Ionic externally:

```ts
apiBaseUrl: 'http://192.168.x.x:3000'
```

Then start Ionic with:

```sh
ionic serve --external
```

Use the IP address shown by Ionic or your Mac network settings in place of `192.168.x.x`. The proxy accepts Ionic dev origins on port `8100`, so the external Ionic page can call the Mac-hosted API on port `3000`.

The proxy provides:

- `GET /api/bus-arrival?busStopCode=XXXXX` for live arrivals at a validated 5-digit bus stop code.
- `GET /api/bus-stops` for the LTA Bus Stops dataset used by name and road search.

The Bus Stops proxy response is sanitized to `BusStopCode`, `Description`, `RoadName`, `Latitude`, and `Longitude`. It fetches the paged DataMall dataset once and keeps it in an in-memory cache before refreshing later.

## Render Deployment

Create a Render Web Service for the Express proxy with:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `LTA_ACCOUNT_KEY`

Render provides `PORT` automatically. The proxy listens on `0.0.0.0` and exposes `GET /health`, which returns `{ "status": "ok" }`.
