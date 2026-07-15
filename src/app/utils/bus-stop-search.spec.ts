import {
  normalizeBusStopSearchAliases,
  normalizeBusStopSearchText,
  rankBusStopSearchResults
} from './bus-stop-search';

describe('bus-stop search', () => {
  const stops = [
    { BusStopCode: '59009', Description: 'Yishun Int', RoadName: 'Yishun Ave 2' },
    { BusStopCode: '59079', Description: 'Yishun Stn', RoadName: 'Yishun Ave 2' },
    { BusStopCode: '01012', Description: "St. Joseph's Ch", RoadName: 'Victoria St' },
    { BusStopCode: '10000', Description: 'International Plaza', RoadName: 'Anson Rd' },
    { BusStopCode: '20000', Description: 'Queenstown Pr Sch', RoadName: 'Margaret Dr' }
  ];

  it('matches full and abbreviated LTA forms bidirectionally', () => {
    expect(rankBusStopSearchResults(stops, 'Yishun Interchange')[0].BusStopCode).toBe('59009');
    expect(rankBusStopSearchResults(stops, 'Yishun Int')[0].BusStopCode).toBe('59009');
    expect(rankBusStopSearchResults(stops, 'Yishun Station')[0].BusStopCode).toBe('59079');
    expect(rankBusStopSearchResults([
      { BusStopCode: '30000', Description: 'Full name', RoadName: 'Bukit Batok West Avenue' }
    ], 'Bt Batok West Ave')[0].BusStopCode).toBe('30000');
  });

  it('preserves partial matching after alias normalization', () => {
    expect(rankBusStopSearchResults(stops, 'yishun inter')[0].BusStopCode).toBe('59009');
    expect(rankBusStopSearchResults(stops, 'yishun st')[0].BusStopCode).toBe('59079');
  });

  it('normalizes punctuation, apostrophes, whitespace, and case', () => {
    expect(normalizeBusStopSearchText("  ST.  JOSEPH'S---CH ")).toBe('st josephs ch');
    expect(rankBusStopSearchResults(stops, "st joseph's church")[0].BusStopCode).toBe('01012');
  });

  it('applies aliases to complete tokens instead of substrings', () => {
    expect(normalizeBusStopSearchAliases('International')).toBe('international');
    expect(rankBusStopSearchResults(stops, 'international')[0].BusStopCode).toBe('10000');
  });

  it('supports both the observed Pr Sch and user-entered Pri Sch forms', () => {
    expect(rankBusStopSearchResults(stops, 'Queenstown Primary School')[0].BusStopCode).toBe('20000');
    expect(rankBusStopSearchResults(stops, 'Queenstown Pri Sch')[0].BusStopCode).toBe('20000');
  });

  it('ranks code, original name, alias exact, prefix, then partial matches', () => {
    const nameRanked = rankBusStopSearchResults([
      { BusStopCode: '10001', Description: 'Opp Yishun Int', RoadName: 'Example Rd' },
      { BusStopCode: '10002', Description: 'Yishun Int Temporary', RoadName: 'Example Rd' },
      { BusStopCode: '10003', Description: 'Yishun Int', RoadName: 'Example Rd' },
      { BusStopCode: '10004', Description: 'Yishun Interchange', RoadName: 'Example Road' }
    ], 'Yishun Interchange');
    expect(nameRanked.map((stop) => stop.BusStopCode)).toEqual(['10004', '10003', '10002', '10001']);

    expect(rankBusStopSearchResults(stops, '59009')[0].BusStopCode).toBe('59009');
  });

  it('deduplicates stops by bus-stop code', () => {
    expect(rankBusStopSearchResults([stops[0], { ...stops[0] }], 'Yishun').length).toBe(1);
  });
});
