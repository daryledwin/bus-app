import {
  compareBusServiceNumbers,
  normalizeBusServiceNumber,
  uniqueSortedBusServiceNumbers
} from './bus-service-number';

describe('bus service number utilities', () => {
  it('normalizes service numbers while preserving suffixes', () => {
    expect(normalizeBusServiceNumber(' 265m ')).toBe('265M');
    expect(normalizeBusServiceNumber('972X')).toBe('972X');
  });

  it('sorts service numbers naturally', () => {
    const services = ['100', '10A', '2', '10', '10M', '9'];
    expect(services.sort(compareBusServiceNumbers)).toEqual(['2', '9', '10', '10A', '10M', '100']);
  });

  it('deduplicates route records without dropping suffixes', () => {
    expect(uniqueSortedBusServiceNumbers([
      { ServiceNo: '265' },
      { ServiceNo: '265' },
      { ServiceNo: ' 265M ' },
      { ServiceNo: '10' },
      { ServiceNo: '10A' },
      { ServiceNo: '' }
    ])).toEqual(['10', '10A', '265', '265M']);
  });
});
