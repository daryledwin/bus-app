'use strict';

const maximumLimit = 50;

function parseNearbyBusStopQuery(query) {
  const hasNearbyParameter = ['latitude', 'longitude', 'limit']
    .some((key) => query[key] !== undefined);
  if (!hasNearbyParameter) {
    return null;
  }

  const latitude = Number(query.latitude);
  const longitude = Number(query.longitude);
  const requestedLimit = query.limit === undefined ? 40 : Number(query.limit);
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || !Number.isInteger(requestedLimit)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
    || requestedLimit < 1
  ) {
    throw new Error('Please provide a valid latitude, longitude, and limit.');
  }

  return {
    latitude,
    longitude,
    limit: Math.min(requestedLimit, maximumLimit)
  };
}

function nearestBusStops(stops, nearbyQuery) {
  if (!nearbyQuery) {
    return stops;
  }

  const longitudeScale = Math.cos(nearbyQuery.latitude * Math.PI / 180);
  return stops
    .map((stop) => {
      const latitudeDelta = Number(stop.Latitude) - nearbyQuery.latitude;
      const longitudeDelta = (Number(stop.Longitude) - nearbyQuery.longitude) * longitudeScale;
      return {
        stop,
        distanceSquared: (latitudeDelta * latitudeDelta) + (longitudeDelta * longitudeDelta)
      };
    })
    .filter(({ distanceSquared }) => Number.isFinite(distanceSquared))
    .sort((left, right) => left.distanceSquared - right.distanceSquared)
    .slice(0, nearbyQuery.limit)
    .map(({ stop }) => stop);
}

module.exports = {
  nearestBusStops,
  parseNearbyBusStopQuery
};
