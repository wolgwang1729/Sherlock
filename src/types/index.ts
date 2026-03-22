export type OutputScriptType =
  | 'p2pkh'
  | 'p2sh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2tr'
  | 'p2pk'
  | 'multisig'
  | 'op_return'
  | 'unknown';
export type InputScriptType =
  | 'p2pkh'
  | 'p2sh-p2wpkh'
  | 'p2sh-p2wsh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2tr_keypath'
  | 'p2tr_scriptpath'
  | 'p2pk'
  | 'multisig'
  | 'unknown';
export type SummaryScriptType = 'p2wpkh' | 'p2tr' | 'p2sh' | 'p2pkh' | 'p2wsh' | 'op_return' | 'unknown';
export type OpReturnProtocol = 'omni' | 'opentimestamps' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';
export type Classification = 'simple_payment' | 'consolidation' | 'coinjoin' | 'self_transfer' | 'batch_payment' | 'unknown';
export type WarningCode = 'RBF_SIGNALING' | 'HIGH_FEE' | 'DUST_OUTPUT' | 'UNKNOWN_OUTPUT_SCRIPT' | (string & {});
export type WarningSeverity = 'info' | 'warn' | 'high';
export type HeuristicId =
  | 'cioh'
  | 'change_detection'
  | 'address_reuse'
  | 'coinjoin'
  | 'consolidation'
  | 'batch_payment'
  | 'self_transfer'
  | 'peeling_chain'
  | 'op_return'
  | 'round_number_payment';

export const HEURISTIC_IDS: HeuristicId[] = [
  'cioh',
  'change_detection',
  'address_reuse',
  'coinjoin',
  'consolidation',
  'batch_payment',
  'self_transfer',
  'peeling_chain',
  'op_return',
  'round_number_payment',
];

export const SUMMARY_SCRIPT_TYPES: SummaryScriptType[] = ['p2wpkh', 'p2tr', 'p2sh', 'p2pkh', 'p2wsh', 'op_return', 'unknown'];

export interface ScriptOpcodeToken {
  type: 'opcode';
  opcode: number;
  name: string;
}

export interface ScriptPushToken {
  type: 'data';
  pushType: string;
  data: Buffer;
}

export type ScriptInstruction = ScriptOpcodeToken | ScriptPushToken;

export interface Vin {
  txid: string;
  vout: number;
  sequence: number;
  script_sig_hex: string;
  script_asm: string;
  witness: string[];
  script_type: InputScriptType;
  prevout_script_type: OutputScriptType;
  address: string | null;
  prevout: {
    value_sats: number;
    script_pubkey_hex: string;
  };
  relative_timelock: {
    enabled: boolean;
    type?: 'blocks' | 'time';
    value?: number;
  };
  witness_script_asm?: string;
  coinbase?: boolean;
}

export interface Vout {
  n: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_asm: string;
  script_type: OutputScriptType;
  address: string | null;
  op_return_data_hex?: string;
  op_return_data_utf8?: string | null;
  op_return_protocol?: OpReturnProtocol;
}

export interface SegwitSavings {
  witness_bytes: number;
  non_witness_bytes: number;
  total_bytes: number;
  weight_actual: number;
  weight_if_legacy: number;
  savings_pct: number;
}

export interface Warning {
  code: WarningCode;
}

export interface UiWarning extends Warning {
  severity: WarningSeverity;
}

export interface TransactionAnalysis {
  ok: true;
  network: string;
  segwit: boolean;
  txid: string;
  wtxid: string | null;
  version: number;
  locktime: number;
  size_bytes: number;
  weight: number;
  vbytes: number;
  total_input_sats: number;
  total_output_sats: number;
  fee_sats: number;
  fee_rate_sat_vb: number;
  rbf_signaling: boolean;
  locktime_type: 'none' | 'block_height' | 'unix_timestamp';
  locktime_value: number;
  segwit_savings: SegwitSavings | null;
  vin: Vin[];
  vout: Vout[];
  warnings: Warning[];
  raw_tx?: string;
}

export interface PrevoutInput {
  txid: string;
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
}

export interface ResolvedPrevout {
  value_sats: number;
  script_pubkey_hex: string;
  script_type: OutputScriptType;
  address: string | null;
}

export interface HeuristicResult {
  detected: boolean;
  confidence?: Confidence;
  [key: string]: unknown;
}

export interface TransactionGraphInput {
  txid: string;
  vout: number;
  value_sats: number;
  script_type: OutputScriptType;
  address: string | null;
  coinbase?: boolean;
}

export interface TransactionGraphOutput {
  n: number;
  value_sats: number;
  script_type: OutputScriptType;
  address: string | null;
  op_return_protocol?: OpReturnProtocol;
}

export interface TransactionGraphData {
  total_input_sats: number;
  total_output_sats: number;
  fee_sats: number;
  inputs: TransactionGraphInput[];
  outputs: TransactionGraphOutput[];
}

export interface OpReturnDetail {
  n: number;
  protocol: OpReturnProtocol;
  data_utf8: string | null;
  data_hex: string;
}

export type ScriptTypeCountMap = Partial<Record<InputScriptType | OutputScriptType, number>>;

export interface TransactionChainAnalysis {
  txid: string;
  wtxid?: string | null;
  version?: number;
  weight?: number;
  vbytes?: number;
  fee_sats?: number;
  total_input_sats?: number;
  total_output_sats?: number;
  fee_pct_of_input?: number;
  rbf_signaling?: boolean;
  locktime_type?: TransactionAnalysis['locktime_type'];
  locktime_value?: number;
  segwit_savings?: SegwitSavings | null;
  warnings?: UiWarning[];
  witness_input_count?: number;
  input_script_counts?: ScriptTypeCountMap;
  output_script_counts?: ScriptTypeCountMap;
  has_op_return?: boolean;
  op_return_count?: number;
  op_return_details?: OpReturnDetail[];
  heuristics: Record<HeuristicId, HeuristicResult>;
  classification: Classification;
  fee_rate_sat_vb?: number;
  input_count?: number;
  output_count?: number;
  input_txids?: string[];
  output_addresses?: string[];
  graph?: TransactionGraphData;
}

export interface FeeRateStats {
  min_sat_vb: number;
  max_sat_vb: number;
  median_sat_vb: number;
  mean_sat_vb: number;
}

export interface AnalysisSummary {
  total_transactions_analyzed: number;
  heuristics_applied: HeuristicId[];
  flagged_transactions: number;
  warning_counts?: Partial<Record<WarningCode, number>>;
  warning_transactions?: number;
  script_type_distribution: Record<SummaryScriptType, number>;
  fee_rate_stats: FeeRateStats;
}

export interface BlockChainAnalysis {
  block_hash: string;
  block_height: number;
  tx_count: number;
  analysis_summary: AnalysisSummary;
  transactions: TransactionChainAnalysis[];
}

export interface ChainAnalysisFileReport {
  ok: true;
  mode: 'chain_analysis';
  file: string;
  block_count: number;
  analysis_summary: AnalysisSummary;
  blocks: BlockChainAnalysis[];
}

export interface AnalyzeBlockInput {
  blkFilePath: string;
  revFilePath: string;
  xorFilePath: string;
  network?: string;
}

export interface AnalyzeBlockOutput {
  report: ChainAnalysisFileReport;
}

export interface ParsedBlockRecord {
  block_hash: string;
  block_height: number;
  timestamp: number;
  tx_count: number;
  parsed_transactions: TransactionAnalysis[];
}

export interface BlockSummaryRecord {
  block_hash: string;
  block_height: number;
  timestamp: number;
  tx_count: number;
}

export interface AnalyzeSingleBlockOutput {
  file: string;
  block_count: number;
  block_index: number;
  block: BlockChainAnalysis;
}

export interface BlockContext {
  transactions: TransactionAnalysis[];
  txById: Map<string, TransactionAnalysis>;
  address_frequency: Map<string, number>;
  spendByOutpoint: Map<string, { spender_txid: string; input_index: number }>;
}
