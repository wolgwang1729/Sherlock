import { TransactionAnalysis, BlockContext, HeuristicResult, HeuristicId } from '../../types';

export interface DetectorContext {
  tx: TransactionAnalysis;
  blockContext?: BlockContext;
  dependencies?: Record<HeuristicId, HeuristicResult>;
}

export interface IDetector {
  id: HeuristicId;
  detect(context: DetectorContext): HeuristicResult;
}
