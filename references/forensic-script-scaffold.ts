#!/usr/bin/env bun
// Forensic Script Scaffold — canonical template for incident forensics.
// Run:  bun run references/forensic-script-scaffold.ts
// Env:  RPC_URL=https://your-endpoint (defaults to publicnode)
// Covers ERC-20 flow only; native ETH tracing needs debug_traceTransaction (Tier C).
import {
  createPublicClient, http, formatUnits, decodeAbiParameters, parseAbiParameters,
  type Log, type Address, type Hex, type Hash, type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const pad32 = (a: Address): Hex => `0x${a.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
const unpad = (h: Hex): Address => `0x${h.slice(26)}` as Address;
const short = (h: string) => `${h.slice(0, 6)}..${h.slice(-4)}`;

// ─── Section 1: Setup & Configuration ──────────────────────────────────────
const CONFIG = {
  rpcUrl: process.env.RPC_URL || 'https://ethereum.publicnode.com',
  targetTxHash: '0x_REPLACE_TX_HASH' as Hash,
  targetAddress: '0x_REPLACE_ADDRESS' as Address,
  tokenAddress: '0x_REPLACE_TOKEN' as Address,
  fromBlock: 0n, toBlock: 0n, maxHops: 3,
  tokenDecimals: 18, tokenSymbol: 'TOKEN',
};
const TOPICS = {
  Transfer:     '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex,
  SwapV2:       '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822' as Hex,
  SwapV3:       '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' as Hex,
  Deposit4626:  '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7' as Hex,
  Withdraw4626: '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db' as Hex,
} as const;

const client = createPublicClient({ chain: mainnet, transport: http(CONFIG.rpcUrl) });

async function probeCapabilities(c: PublicClient) {
  const chainId = await c.getChainId();
  let safeBlock: bigint;
  try {
    safeBlock = (await c.getBlock({ blockTag: 'safe' })).number!;
  } catch {
    safeBlock = await c.getBlockNumber();
    console.warn('safe tag unsupported — falling back to latest');
  }
  console.log(`Chain: ${chainId} | Anchor block: ${safeBlock}`);
  try {
    await c.getLogs({ fromBlock: safeBlock, toBlock: safeBlock });
    console.log('getLogs: supported');
  } catch {
    console.warn('getLogs: restricted — adaptive chunking will start with small chunks');
  }
  return { chainId, safeBlock };
}

// ─── Section 2: Transaction Receipt + Log Decoder ──────────────────────────
interface DecodedEvent {
  logIndex: number; address: Address; event: string; fields: Record<string, string>;
}

function decodeLog(log: { topics: Hex[]; data: Hex; address: Address; logIndex: number }): DecodedEvent | null {
  const t0 = log.topics[0];
  if (!t0) return null;
  const base = { logIndex: log.logIndex, address: log.address };
  if (t0 === TOPICS.Transfer) {
    // ERC-721: 4 topics (tokenId indexed); ERC-20: 3 topics (value in data)
    if (log.topics.length === 4) {
      return { ...base, event: 'Transfer (ERC-721)', fields: {
        from: unpad(log.topics[1]), to: unpad(log.topics[2]),
        tokenId: BigInt(log.topics[3]).toString(),
      }};
    }
    const [value] = decodeAbiParameters(parseAbiParameters('uint256'), log.data);
    return { ...base, event: 'Transfer', fields: {
      from: unpad(log.topics[1]), to: unpad(log.topics[2]), value: value.toString(),
    }};
  }
  if (t0 === TOPICS.SwapV2) {
    // Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
    const [a0In, a1In, a0Out, a1Out] = decodeAbiParameters(
      parseAbiParameters('uint256, uint256, uint256, uint256'), log.data);
    return { ...base, event: 'Swap (V2)', fields: {
      sender: unpad(log.topics[1]), to: unpad(log.topics[2]),
      amount0In: a0In.toString(), amount1In: a1In.toString(),
      amount0Out: a0Out.toString(), amount1Out: a1Out.toString(),
    }};
  }
  if (t0 === TOPICS.SwapV3) {
    // Swap(address indexed, address indexed, int256, int256, uint160, uint128, int24)
    const [a0, a1, sqrtPrice, liq, tick] = decodeAbiParameters(
      parseAbiParameters('int256, int256, uint160, uint128, int24'), log.data);
    return { ...base, event: 'Swap (V3)', fields: {
      sender: unpad(log.topics[1]), recipient: unpad(log.topics[2]),
      amount0: a0.toString(), amount1: a1.toString(),
      sqrtPriceX96: sqrtPrice.toString(), liquidity: liq.toString(), tick: tick.toString(),
    }};
  }
  if (t0 === TOPICS.Deposit4626) {
    // Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)
    const [assets, shares] = decodeAbiParameters(parseAbiParameters('uint256, uint256'), log.data);
    return { ...base, event: 'Deposit (ERC-4626)', fields: {
      sender: unpad(log.topics[1]), owner: unpad(log.topics[2]),
      assets: assets.toString(), shares: shares.toString(),
    }};
  }
  if (t0 === TOPICS.Withdraw4626) {
    // Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256, uint256)
    const [assets, shares] = decodeAbiParameters(parseAbiParameters('uint256, uint256'), log.data);
    return { ...base, event: 'Withdraw (ERC-4626)', fields: {
      sender: unpad(log.topics[1]), receiver: unpad(log.topics[2]),
      owner: unpad(log.topics[3]), assets: assets.toString(), shares: shares.toString(),
    }};
  }
  return null;
}

async function decodeTxReceipt(c: PublicClient, txHash: Hash): Promise<DecodedEvent[]> {
  const receipt = await c.getTransactionReceipt({ hash: txHash });
  console.log(`Tx ${short(txHash)} | status: ${receipt.status} | gas: ${receipt.gasUsed} | logs: ${receipt.logs.length}`);
  return receipt.logs
    .map(log => decodeLog({ topics: [...log.topics] as Hex[], data: log.data,
      address: log.address, logIndex: Number(log.logIndex) }))
    .filter((d): d is DecodedEvent => d !== null);
}

// ─── Section 3: Adaptive Log Scanner ───────────────────────────────────────
// Algorithm from references/rpc-field-guide.md Section 5 + 429 backoff + removed-log filtering.
interface ScanOptions {
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock: bigint; toBlock: bigint;
  initialChunkSize?: number; minChunkSize?: number;
}

const RANGE_ERRORS = new Set([-32005, -32602, -32614, -32000]);
function isRangeError(err: any): boolean {
  if (RANGE_ERRORS.has(err?.code)) return true;
  const m = (err?.message ?? '').toLowerCase();
  return ['range', 'limit', 'too many', 'exceed'].some(w => m.includes(w));
}

async function getLogsAdaptive(c: PublicClient, opts: ScanOptions): Promise<Log[]> {
  const { address, topics, fromBlock, toBlock, initialChunkSize = 2000, minChunkSize = 10 } = opts;
  const allLogs: Log[] = [];
  let cursor = fromBlock;
  let chunk = BigInt(initialChunkSize);
  const maxChunk = chunk * 4n;
  while (cursor <= toBlock) {
    const end = cursor + chunk - 1n > toBlock ? toBlock : cursor + chunk - 1n;
    try {
      const logs = await c.getLogs({ address, topics, fromBlock: cursor, toBlock: end });
      allLogs.push(...logs.filter(l => !l.removed));
      cursor = end + 1n;
      if (chunk < maxChunk) chunk *= 2n;
    } catch (err: any) {
      if (err?.status === 429 || String(err?.code) === '429') {
        await sleep(2000 + Math.random() * 3000);
        continue;
      }
      if (isRangeError(err)) {
        chunk /= 2n;
        if (chunk < BigInt(minChunkSize))
          throw new Error(`Stuck at ${minChunkSize}-block chunk (block ${cursor}). Narrow your filter.`);
        continue;
      }
      throw err;
    }
  }
  return allLogs;
}

// ─── Section 4: Multi-hop Fund Flow Tracer ─────────────────────────────────
// BFS outgoing ERC-20 transfers: start address → counterparties → their counterparties.
interface Hop {
  from: Address; to: Address; value: bigint; token: Address;
  txHash: Hash; blockNumber: bigint; logIndex: number;
}

async function traceFundFlow(
  c: PublicClient, start: Address, token: Address,
  fromBlock: bigint, toBlock: bigint, maxHops: number,
): Promise<Hop[]> {
  const hops: Hop[] = [];
  const visited = new Set([start.toLowerCase()]);
  let frontier: Address[] = [start];
  for (let depth = 0; depth < maxHops && frontier.length > 0; depth++) {
    const next: Address[] = [];
    let transferCount = 0;
    for (const addr of frontier) {
      const logs = await getLogsAdaptive(c, {
        address: token, topics: [TOPICS.Transfer, pad32(addr), null], fromBlock, toBlock,
      });
      transferCount += logs.length;
      for (const log of logs) {
        if (log.topics.length < 3) continue;
        const to = unpad(log.topics[2] as Hex);
        hops.push({
          from: addr, to, value: BigInt(log.data), token,
          txHash: log.transactionHash!, blockNumber: log.blockNumber!, logIndex: Number(log.logIndex),
        });
        if (!visited.has(to.toLowerCase())) { visited.add(to.toLowerCase()); next.push(to); }
      }
    }
    frontier = next;
    console.log(`  Hop ${depth + 1}: ${transferCount} transfers, ${next.length} new counterparties`);
  }
  return hops.sort((a, b) =>
    a.blockNumber !== b.blockNumber ? Number(a.blockNumber - b.blockNumber) : a.logIndex - b.logIndex);
}

function toMermaid(hops: Hop[], decimals: number, symbol: string): string {
  const lines = ['graph LR'];
  const seen = new Set<string>();
  for (const h of hops) {
    const key = `${h.from}-${h.to}-${h.txHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const amt = formatUnits(h.value, decimals);
    const fId = `A${h.from.slice(2, 10)}`, tId = `A${h.to.slice(2, 10)}`;
    lines.push(`  ${fId}["${short(h.from)}"] -->|"${amt} ${symbol}"| ${tId}["${short(h.to)}"]`);
  }
  return lines.join('\n');
}

// ─── Section 5: Evidence Register ──────────────────────────────────────────
type ClaimType = 'FACT_ONCHAIN' | 'INFERENCE_ONCHAIN' | 'EXTERNAL_ASSERTION';
interface Claim {
  id: string; text: string; type: ClaimType;
  evidence: { method: string; params: string; blockRef: bigint }[];
  falsifier?: string;
}
const register: Claim[] = [];

function addClaim(id: string, text: string, type: ClaimType,
  evidence: Claim['evidence'], falsifier?: string) {
  register.push({ id, text, type, evidence, falsifier });
}

function printRegister() {
  console.log('\n═══ EVIDENCE REGISTER ═══');
  for (const c of register) {
    console.log(`\n[${c.id}] (${c.type})\n  ${c.text}`);
    for (const e of c.evidence) console.log(`  :: ${e.method}(${e.params}) @ block ${e.blockRef}`);
    if (c.falsifier) console.log(`  !! Falsifier: ${c.falsifier}`);
  }
  console.log('\n═════════════════════════');
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const { safeBlock } = await probeCapabilities(client);
  const toBlock = CONFIG.toBlock || safeBlock;
  const isSet = (v: string) => !v.startsWith('0x_REPLACE');

  if (isSet(CONFIG.targetTxHash)) {
    console.log('\n── Tx Receipt Decode ──');
    const events = await decodeTxReceipt(client, CONFIG.targetTxHash);
    console.table(events.map(e => ({ idx: e.logIndex, contract: short(e.address), event: e.event, ...e.fields })));
    addClaim('TX-001', `Tx ${short(CONFIG.targetTxHash)} emitted ${events.length} recognized events`,
      'FACT_ONCHAIN', [{ method: 'eth_getTransactionReceipt', params: CONFIG.targetTxHash, blockRef: toBlock }]);
  }

  if (isSet(CONFIG.targetAddress) && CONFIG.fromBlock > 0n) {
    console.log('\n── Incoming Transfer Scan ──');
    const logs = await getLogsAdaptive(client, {
      topics: [TOPICS.Transfer, null, pad32(CONFIG.targetAddress)], fromBlock: CONFIG.fromBlock, toBlock,
    });
    console.log(`Found ${logs.length} incoming transfers to ${short(CONFIG.targetAddress)}`);
    for (const log of logs.slice(0, 20)) {
      const d = decodeLog({ topics: [...log.topics] as Hex[], data: log.data,
        address: log.address, logIndex: Number(log.logIndex) });
      if (d) console.log(`  [blk ${log.blockNumber}] ${d.event}: ${JSON.stringify(d.fields)}`);
    }
    if (logs.length > 20) console.log(`  ... and ${logs.length - 20} more`);
  }

  if (isSet(CONFIG.targetAddress) && isSet(CONFIG.tokenAddress) && CONFIG.fromBlock > 0n) {
    console.log('\n── Multi-hop Fund Flow ──');
    const hops = await traceFundFlow(
      client, CONFIG.targetAddress, CONFIG.tokenAddress, CONFIG.fromBlock, toBlock, CONFIG.maxHops);
    console.log(`Total: ${hops.length} hops traced`);
    console.table(hops.map(h => ({
      from: short(h.from), to: short(h.to), value: formatUnits(h.value, CONFIG.tokenDecimals),
      tx: short(h.txHash), block: h.blockNumber.toString(),
    })));
    console.log('\n── Mermaid Diagram ──');
    console.log(toMermaid(hops, CONFIG.tokenDecimals, CONFIG.tokenSymbol));
    addClaim('FLOW-001',
      `${hops.length} outgoing Transfer hops from ${short(CONFIG.targetAddress)} (max ${CONFIG.maxHops} depth)`,
      'FACT_ONCHAIN',
      [{ method: 'eth_getLogs', params: `Transfer topic1=${short(CONFIG.targetAddress)}`, blockRef: toBlock }],
      'Incoming transfers and native ETH flows not captured (requires separate scan / Tier C traces)');
  }

  printRegister();
}

main().catch(console.error);
