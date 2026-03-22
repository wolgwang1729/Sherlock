"use client";

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { TransactionChainAnalysis, HeuristicResult, OutputScriptType } from '../types';

const HEURISTIC_DESCRIPTIONS: Record<string, string> = {
  cioh: 'Common Input Ownership Heuristic (CIOH): Assumes all inputs of a transaction belong to the same entity unless it is a CoinJoin.',
  change_detection: 'Analyzes outputs to determine which one is likely the change returning to the sender (based on script type or value).',
  address_reuse: 'Flags when the same address is reused across multiple transactions, violating privacy best practices.',
  coinjoin: 'A privacy-enhancing transaction pattern where multiple participants combine inputs and outputs with identical values.',
  consolidation: 'A transaction that sweeps multiple small UTXOs into a single or few outputs to reduce fee overhead in the future.',
  self_transfer: 'A transaction where a single user moves funds between their own wallets (determined when only one input/output type is involved, or matching addresses).',
  peeling_chain: 'A pattern where a large output is repeatedly spent, sending a specific amount to a new recipient and returning the change, forming a chain.',
  op_return: 'Detects the presence of OP_RETURN data (e.g. Omni protocol, OpenTimestamps) indicating embedded data rather than standard value transfer.',
  round_number_payment: 'An output value is a very clean round numbered amount in BTC or fiat equivalent, usually signifying the actual payment.',
  batch_payment: 'A transaction that sends funds to multiple recipients in a single operation, typically used by exchanges and services to save on fees.',
};

const SATS_PER_BTC = 100_000_000;

function formatSats(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatBtc(value: number) {
  return `${(value / SATS_PER_BTC).toFixed(8)} BTC`;
}

function shortenValue(value: string | null | undefined, head = 10, tail = 6) {
  if (!value) {
    return 'Unknown';
  }
  if (value.length <= head + tail + 3) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function getScriptTone(scriptType: OutputScriptType) {
  switch (scriptType) {
    case 'p2tr':
      return 'border-cyan-500/40 bg-cyan-500/8 text-cyan-300';
    case 'p2wpkh':
      return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-300';
    case 'p2wsh':
      return 'border-teal-500/40 bg-teal-500/8 text-teal-300';
    case 'p2sh':
      return 'border-violet-500/40 bg-violet-500/8 text-violet-300';
    case 'p2pkh':
      return 'border-fuchsia-500/40 bg-fuchsia-500/8 text-fuchsia-300';
    case 'op_return':
      return 'border-amber-500/40 bg-amber-500/8 text-amber-300';
    default:
      return 'border-zinc-700 bg-zinc-950/80 text-zinc-300';
  }
}

function getNodeY(index: number, count: number, height: number) {
  if (count <= 1) {
    return height / 2;
  }
  const usableHeight = height - 64;
  return 32 + (usableHeight * index) / (count - 1);
}

function getConnectorAnchorY(index: number, count: number, centerY: number) {
  if (count <= 1) {
    return centerY;
  }
  const spread = Math.min(84, 28 * (count - 1));
  return centerY - spread / 2 + (spread * index) / (count - 1);
}

function GraphNode({
  title,
  valueSats,
  tone,
}: {
  title: string;
  valueSats: number;
  tone: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm backdrop-blur-sm ${tone}`}>
      <p className="text-[10px] font-semibold text-white truncate">{title}</p>
      <p className="mt-1 text-sm font-bold text-white">{formatSats(valueSats)} sats</p>
    </div>
  );
}

function TransactionFlowGraph({ tx }: { tx: TransactionChainAnalysis }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => {
      setAvailableWidth(container.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  if (!tx.graph) {
    return null;
  }

  const { graph } = tx;
  const inputs = graph.inputs;
  const outputs = graph.outputs;
  const rowCount = Math.max(inputs.length, outputs.length, 1);
  const graphHeight = Math.max(300, rowCount * 108);
  const canvasWidth = 980;
  const leftColumnX = 32;
  const leftConnectorX = 272;
  const centerLeftX = 390;
  const centerRightX = 590;
  const rightConnectorX = 708;
  const rightColumnX = 724;
  const txCenterY = graphHeight / 2;
  const txFeeShare = graph.total_input_sats > 0 ? (graph.fee_sats / graph.total_input_sats) * 100 : 0;
  const horizontalGutter = 24;
  const scaledViewportWidth = Math.max(availableWidth - horizontalGutter * 2, 320);
  const graphScale = availableWidth > 0 ? Math.min(1, scaledViewportWidth / canvasWidth) : 1;
  const scaledHeight = Math.ceil(graphHeight * graphScale);
  const scaledWidth = Math.ceil(canvasWidth * graphScale);
  const canvasOffsetX = availableWidth > 0 ? Math.max(horizontalGutter, (availableWidth - scaledWidth) / 2) : 0;

  return (
    <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-3xl shadow-2xl relative p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-xl font-bold text-white">Visual Transaction Flow</h3>
          <p className="text-sm text-zinc-400 mt-1">Inputs converge into the transaction and fan out into spend targets.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm min-w-full sm:min-w-0 sm:w-auto">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Inputs</p>
            <p className="text-lg font-bold text-white mt-1">{inputs.length}</p>
            <p className="text-xs text-zinc-400">{formatSats(graph.total_input_sats)} sats in</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Outputs</p>
            <p className="text-lg font-bold text-white mt-1">{outputs.length}</p>
            <p className="text-xs text-zinc-400">{formatSats(graph.total_output_sats)} sats out</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Fee</p>
            <p className="text-lg font-bold text-white mt-1">{formatSats(graph.fee_sats)} sats</p>
            <p className="text-xs text-zinc-400">{txFeeShare.toFixed(2)}% of total input value</p>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="w-full overflow-hidden pb-2">
        <div className="relative w-full" style={{ height: `${scaledHeight}px` }}>
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: `${canvasWidth}px`,
              height: `${graphHeight}px`,
              left: `${canvasOffsetX}px`,
              transform: `scale(${graphScale})`,
            }}
          >
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${canvasWidth} ${graphHeight}`} fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="inputFlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(34,197,94,0.45)" />
                <stop offset="100%" stopColor="rgba(59,130,246,0.95)" />
              </linearGradient>
              <linearGradient id="outputFlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(59,130,246,0.9)" />
                <stop offset="100%" stopColor="rgba(249,115,22,0.85)" />
              </linearGradient>
              <marker id="inputArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(59,130,246,0.85)" />
              </marker>
              <marker id="outputArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(249,115,22,0.75)" />
              </marker>
            </defs>

            {inputs.map((input, index) => {
              const y = getNodeY(index, inputs.length, graphHeight);
              const anchorY = getConnectorAnchorY(index, inputs.length, txCenterY);
              const pathD = `M ${leftConnectorX} ${y} C 320 ${y}, 336 ${anchorY}, ${centerLeftX} ${anchorY}`;
              return (
                <g key={`${input.txid}:${input.vout}`}>
                  <path
                    d={pathD}
                    stroke="rgba(34,197,94,0.18)"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                  <path
                    d={pathD}
                    stroke="url(#inputFlow)"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    markerEnd="url(#inputArrow)"
                  />
                </g>
              );
            })}

            {outputs.map((output, index) => {
              const y = getNodeY(index, outputs.length, graphHeight);
              const anchorY = getConnectorAnchorY(index, outputs.length, txCenterY);
              const pathD = `M ${centerRightX} ${anchorY} C 644 ${anchorY}, 660 ${y}, ${rightConnectorX} ${y}`;
              return (
                <g key={`output-${output.n}`}>
                  <path
                    d={pathD}
                    stroke="rgba(249,115,22,0.16)"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                  <path
                    d={pathD}
                    stroke="url(#outputFlow)"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    markerEnd="url(#outputArrow)"
                  />
                </g>
              );
            })}

            {inputs.map((_, index) => {
              const anchorY = getConnectorAnchorY(index, inputs.length, txCenterY);
              return <circle key={`input-anchor-${index}`} cx={centerLeftX} cy={anchorY} r="4.5" fill="rgba(59,130,246,0.95)" />;
            })}
            {outputs.map((_, index) => {
              const anchorY = getConnectorAnchorY(index, outputs.length, txCenterY);
              return <circle key={`output-anchor-${index}`} cx={centerRightX} cy={anchorY} r="4.5" fill="rgba(59,130,246,0.95)" />;
            })}
          </svg>

          {inputs.map((input, index) => {
            const y = getNodeY(index, inputs.length, graphHeight);
            const title = input.coinbase ? 'Coinbase subsidy' : (input.address || shortenValue(input.txid));

            return (
              <div
                key={`${input.txid}:${input.vout}:card`}
                className="absolute w-44 -translate-y-1/2"
                style={{ left: `${leftColumnX}px`, top: `${y}px` }}
              >
                <GraphNode
                  title={title}
                  valueSats={input.value_sats}
                  tone={getScriptTone(input.script_type)}
                />
              </div>
            );
          })}

          <div
            className="absolute w-44 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-sky-500/20 bg-sky-500/6 px-3 py-2 shadow-sm"
            style={{ left: '50%', top: `${txCenterY}px` }}
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-sky-200">Transaction</p>
            <p className="mt-1 font-mono text-[11px] text-white truncate">{shortenValue(tx.txid, 12, 8)}</p>
          </div>

          {outputs.map((output, index) => {
            const y = getNodeY(index, outputs.length, graphHeight);
            const title = output.script_type === 'op_return'
              ? `OP_RETURN${output.op_return_protocol ? ` (${output.op_return_protocol})` : ''}`
              : (output.address || `Output ${output.n}`);
            return (
              <div
                key={`output-${output.n}-card`}
                className="absolute w-44 -translate-y-1/2"
                style={{ left: `${rightColumnX}px`, top: `${y}px` }}
              >
                <GraphNode
                  title={title}
                  valueSats={output.value_sats}
                  tone={getScriptTone(output.script_type)}
                />
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-zinc-700 transition-colors text-zinc-500 hover:text-zinc-200 shrink-0 cursor-pointer"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function Tooltip({ children, tip, className = "inline-flex items-center gap-0.5" }: { children: React.ReactNode; tip: string; className?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className={`relative cursor-default ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="absolute bottom-full left-0 mb-2 z-100 w-max max-w-64 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-[11px] leading-snug text-zinc-200 shadow-xl pointer-events-none whitespace-normal text-left">
          {tip}
          <span className="absolute top-full left-3 border-3 border-transparent border-t-zinc-800" />
        </span>
      )}
    </span>
  );
}

export default function TransactionVisualizer({ tx }: { tx: TransactionChainAnalysis }) {
  const [showRaw, setShowRaw] = useState(false);

  const heuristics = tx.heuristics || {};
  const heuristicEntries = (Object.entries(heuristics) as [string, HeuristicResult][])
    .sort((a, b) => {
      if (a[1].detected && !b[1].detected) return -1;
      if (!a[1].detected && b[1].detected) return 1;
      return 0;
    });

  return (
    <div className="space-y-1">

      <TransactionFlowGraph tx={tx} />

      {/* ── Overview head ── */}
      <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-3xl shadow-2xl relative p-5">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2 relative z-10">
          Heuristic Analysis Results
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {heuristicEntries.map(([id, result]) => {
            const detected = result.detected;
            const confidence = result.confidence || 'unknown';

            let bg = 'bg-zinc-950/50';
            let border = 'border-zinc-800';
            let icon = <CheckCircle2 className="w-5 h-5 text-zinc-600" />;
            let titleColor = 'text-zinc-500';

            if (detected) {
              bg = 'bg-orange-500/5';
              border = 'border-orange-500/30';
              icon = <AlertCircle className="w-5 h-5 text-orange-400" />;
              titleColor = 'text-orange-400';
            }

            return (
              <div key={id} className={`${bg} border ${border} rounded-2xl p-4 flex flex-col transition-all group relative`}>
                <div className="flex items-start justify-between mb-3 shrink-0">
                  <div className="flex items-center gap-2">
                    {icon}
                    <Tooltip tip={HEURISTIC_DESCRIPTIONS[id] || 'Various chain analysis heuristic flags.'}>
                      <span className={`font-semibold ${titleColor} capitalize cursor-default border-b border-dashed border-zinc-700 group-hover:border-zinc-500`}>
                        {id.replace(/_/g, ' ')}
                      </span>
                    </Tooltip>
                  </div>
                </div>

                {!detected && (
                  <div className="flex-1 relative overflow-hidden pointer-events-none min-h-0">
                    <div className="absolute inset-0 flex items-center justify-center opacity-[0.03]">
                      <ShieldCheck className="size-24" />
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1 mt-auto shrink-0">
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-zinc-500 text-[11px] uppercase tracking-wider font-semibold mb-0.5">Status:</dt>
                      <dd className="text-zinc-300 font-medium">{detected ? 'Detected' : 'Clean'}</dd>
                    </div>

                    {detected && (
                      <div>
                        <dt className="text-zinc-500 text-[11px] uppercase tracking-wider font-semibold mb-0.5 mt-1">Confidence:</dt>
                        <dd className="text-zinc-300 font-medium capitalize">{confidence}</dd>
                      </div>
                    )}

                    {/* compact mode: do not render extra heuristic fields */}
                  </dl>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Raw details toggle ── */}
      <div className="mt-8">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          {showRaw ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          <span className="font-semibold">Show Raw Technical Details</span>
        </button>

        {showRaw && (
          <div className="mt-4 bg-zinc-950 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
            <pre className="text-xs text-zinc-400 font-mono">{JSON.stringify(tx, null, 2)}</pre>
          </div>
        )}
      </div>

    </div>
  );
}
