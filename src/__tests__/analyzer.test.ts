import * as analyzer from '../analyzer';
import { HEURISTIC_IDS } from '../types';
import { formatUnixTimestamp } from '../utils';

describe('analyzer barrel', () => {
  it('re-exports public analysis helpers', () => {
    expect(analyzer.formatUnixTimestamp).toBe(formatUnixTimestamp);
    expect(analyzer.HEURISTIC_IDS).toBe(HEURISTIC_IDS);
  });
});