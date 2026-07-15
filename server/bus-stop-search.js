const SEARCH_INDEX_CACHE = new WeakMap();
const SEARCH_ALIASES = [
  alias('community centre', 'community center', 'community club', 'cc'),
  alias('primary school', 'primary sch', 'pri sch', 'pr sch'),
  alias('secondary school', 'secondary sch', 'sec sch'),
  alias('junior college', 'jc'),
  alias('interchange', 'int'), alias('station', 'stn'), alias('terminal', 'ter'),
  alias('opposite', 'opp'), alias('before', 'bef'), alias('after', 'aft'),
  alias('road', 'rd'), alias('street', 'st'), alias('avenue', 'ave'),
  alias('drive', 'dr'), alias('boulevard', 'blvd'), alias('jalan', 'jln'),
  alias('lorong', 'lor'), alias('bukit', 'bt'), alias('block', 'blk'),
  alias('centre', 'center', 'ctr'), alias('market', 'mkt'),
  alias('polytechnic', 'poly'), alias('hospital', 'hosp'), alias('church', 'ch'),
  alias('condominium', 'condo'), alias('industrial', 'ind'), alias('estate', 'est'),
  alias('national', 'natl')
].sort((left, right) => longestVariant(right) - longestVariant(left));

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeSearchAliases(value) {
  const tokens = tokenize(value);
  const normalized = [];

  for (let index = 0; index < tokens.length;) {
    const match = findAlias(tokens, index);
    if (match) {
      normalized.push(...match.searchAlias.canonical);
      index += match.variant.length;
    } else {
      normalized.push(tokens[index]);
      index += 1;
    }
  }

  return normalized.join(' ');
}

function filterBusStops(stops, search) {
  const originalQuery = normalizeSearchText(search);
  const aliasQuery = normalizeSearchAliases(search);

  if (!originalQuery || !aliasQuery) {
    return stops;
  }

  const uniqueStops = new Map();
  stops.forEach((stop) => {
    const key = String(stop.BusStopCode || '') || `${stop.Description}\u0000${stop.RoadName}`;
    if (!uniqueStops.has(key)) {
      uniqueStops.set(key, stop);
    }
  });

  return Array.from(uniqueStops.values())
    .map((stop) => ({ stop, score: scoreBusStop(stop, originalQuery, aliasQuery) }))
    .filter((result) => result.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || String(left.stop.Description || '').localeCompare(String(right.stop.Description || ''))
      || String(left.stop.BusStopCode || '').localeCompare(String(right.stop.BusStopCode || ''))
    )
    .map((result) => result.stop);
}

function scoreBusStop(stop, originalQuery, aliasQuery) {
  const {
    originalDescription, originalRoad, code, aliasDescription, aliasRoad,
    originalTokens, aliasTokens: searchableTokens
  } = indexBusStop(stop);
  const originalQueryTokens = originalQuery.split(' ').filter(Boolean);
  const queryTokens = aliasQuery.split(' ').filter(Boolean);

  const originalTokensMatch = originalQueryTokens.every((queryToken) =>
    originalTokens.some((searchToken) => searchToken.includes(queryToken)));
  const aliasTokensMatch = queryTokens.every((queryToken) =>
    searchableTokens.some((searchToken) => searchToken.includes(queryToken)));

  if (!originalTokensMatch && !aliasTokensMatch) {
    return 0;
  }
  if (code === originalQuery) return 500;
  if (originalDescription === originalQuery || originalRoad === originalQuery) {
    return 400 + (originalDescription === originalQuery ? 10 : 0);
  }
  if (aliasDescription === aliasQuery || aliasRoad === aliasQuery) {
    return 300 + (aliasDescription === aliasQuery ? 10 : 0);
  }
  if (
    originalDescription.startsWith(originalQuery)
    || originalRoad.startsWith(originalQuery)
    || aliasDescription.startsWith(aliasQuery)
    || aliasRoad.startsWith(aliasQuery)
    || code.startsWith(originalQuery)
  ) {
    return 200 + (aliasDescription.startsWith(aliasQuery) ? 10 : 0);
  }
  return 100 + queryTokens.length;
}

function indexBusStop(stop) {
  const cached = SEARCH_INDEX_CACHE.get(stop);
  if (cached) return cached;

  const originalDescription = normalizeSearchText(stop.Description);
  const originalRoad = normalizeSearchText(stop.RoadName);
  const code = normalizeSearchText(stop.BusStopCode);
  const aliasDescription = normalizeSearchAliases(stop.Description);
  const aliasRoad = normalizeSearchAliases(stop.RoadName);
  const index = {
    originalDescription, originalRoad, code, aliasDescription, aliasRoad,
    originalTokens: `${originalDescription} ${originalRoad} ${code}`.split(' ').filter(Boolean),
    aliasTokens: `${aliasDescription} ${aliasRoad} ${code}`.split(' ').filter(Boolean)
  };

  SEARCH_INDEX_CACHE.set(stop, index);
  return index;
}

function alias(canonical, ...variants) {
  return {
    canonical: tokenize(canonical),
    variants: [canonical, ...variants].map(tokenize).sort((left, right) => right.length - left.length)
  };
}

function tokenize(value) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function longestVariant(searchAlias) {
  return Math.max(...searchAlias.variants.map((variant) => variant.length));
}

function findAlias(tokens, index) {
  for (const searchAlias of SEARCH_ALIASES) {
    for (const variant of searchAlias.variants) {
      if (variant.every((token, offset) => tokens[index + offset] === token)) {
        return { searchAlias, variant };
      }
    }
  }
  return undefined;
}

module.exports = { filterBusStops, normalizeSearchAliases, normalizeSearchText };
