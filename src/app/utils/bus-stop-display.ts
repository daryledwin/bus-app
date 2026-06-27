interface BusStopDisplaySource {
  Description?: string;
  RoadName?: string;
}

const trailingEmojiPattern = /[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]\ufe0f?$/u;

function includesAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function hasWord(value: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`(^|\\s)${word}(\\s|$)`).test(value));
}

export function getBusStopEmoji(stop: BusStopDisplaySource | null | undefined): string {
  const description = String(stop?.Description || '').toLowerCase();
  const roadName = String(stop?.RoadName || '').toLowerCase();
  const combined = `${description} ${roadName}`;

  if (hasWord(description, ['int']) || description.includes('interchange')) {
    return '🚉';
  }

  if (hasWord(description, ['stn', 'mrt']) || description.includes('station')) {
    return '🚇';
  }

  if (combined.includes('airport')) {
    return '✈️';
  }

  if (description.includes('hosp') || description.includes('hospital')) {
    return '🏥';
  }

  if (includesAny(description, ['school', 'poly', 'univ', 'nus', 'ntu', 'smu', 'ite']) || hasWord(description, ['sch', 'jc'])) {
    return '🎓';
  }

  if (includesAny(description, ['mall', 'plaza', 'centre', 'square', 'junction'])) {
    return '🛍️';
  }

  if (description.includes('hub')) {
    return '🏢';
  }

  if (includesAny(description, ['park', 'garden', 'gdns', 'botanic'])) {
    return '🌳';
  }

  if (includesAny(description, ['stadium', 'arena', 'sports hub'])) {
    return '🏟️';
  }

  if (includesAny(description, ['ferry', 'pier', 'harbour', 'cruise'])) {
    return '⛴️';
  }

  if (includesAny(combined, ['raffles', 'shenton', 'marina', 'orchard', 'bugis', 'city hall', 'cbd', 'downtown'])) {
    return '🌆';
  }

  return '';
}

export function formatBusStopName(stop: BusStopDisplaySource | null | undefined, displayName?: string): string {
  const name = String(displayName || stop?.Description || '').trim();
  const emoji = getBusStopEmoji(stop);

  if (!name) {
    return emoji ? `Bus stop ${emoji}` : 'Bus stop';
  }

  if (trailingEmojiPattern.test(name)) {
    return name;
  }

  return emoji ? `${name} ${emoji}` : name;
}
