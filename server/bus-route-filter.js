function parseBusRouteQuery(query = {}) {
  const serviceNo = String(query.serviceNo || '').trim().toUpperCase();
  const busStopCode = String(query.busStopCode || '').trim();

  if (!serviceNo && !busStopCode) {
    throw new Error('Please provide a bus service number or bus stop code.');
  }

  if (serviceNo && !/^[A-Z0-9]+$/.test(serviceNo)) {
    throw new Error('Please provide a valid bus service number.');
  }

  if (busStopCode && !/^\d{5}$/.test(busStopCode)) {
    throw new Error('Please provide a valid 5-digit bus stop code.');
  }

  return { serviceNo, busStopCode };
}

function filterBusRouteRecords(routes, query) {
  return routes.filter((route) =>
    (!query.serviceNo || String(route.ServiceNo || '').toUpperCase() === query.serviceNo)
    && (!query.busStopCode || String(route.BusStopCode || '') === query.busStopCode)
  );
}

module.exports = {
  filterBusRouteRecords,
  parseBusRouteQuery
};
