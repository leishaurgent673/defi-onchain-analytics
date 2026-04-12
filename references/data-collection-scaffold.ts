#!/usr/bin/env bun
// Data Collection Scaffold — bulk RPC with rate limiting, endpoint rotation, checkpoint/resume, CSV output.
// Run:  bun run references/data-collection-scaffold.ts
// Env:  RPC_URLS=url1,url2,url3 (comma-separated, for rotation)
//       CHECKPOINT_FILE=checkpoint.json (optional, for resume)
//
// This scaffold handles the operational plumbing so you can focus on the analytical logic.
// Customize Section 4 (your collection logic) and the CONFIG block.

import {
  createPublicClient, http, formatUnits,
  type Log, type Address, type Hex, type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';
import * as fs from 'fs';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Section 1: Configuration ──────────────────────────────────────────────
const CONFIG = {
  // RPC endpoints — rotate on failure or rate limit
  rpcUrls: (process.env.RPC_URLS || 'https://ethereum.publicnode.com').split(',').map(s => s.trim()),

  // Rate limiting
  requestsPerSecond: 5,        // max RPC calls per second (per endpoint)
  batchSize: 20,               // calls per Multicall3 batch
  retryAttempts: 3,            // retries before rotating endpoint
  retryBackoffMs: 2000,        // initial backoff (doubles each retry)

  // Checkpoint / resume
  checkpointFile: process.env.CHECKPOINT_FILE || 'checkpoint.json',
  checkpointInterval: 50,      // save checkpoint every N successful operations

  // Output
  outputFile: 'output.csv',
  outputDelimiter: ',',

  // Scanning parameters (customize per investigation)
  fromBlock: 0n,
  toBlock: 0n,                 // 0 = auto-detect safe block
  targetAddress: '0x_REPLACE' as Address,
};

// ─── Section 2: Endpoint Rotation & Rate Limiting ──────────────────────────

class EndpointManager {
  private endpoints: string[];
  private currentIndex = 0;
  private lastCallTime = 0;
  private minInterval: number;

  constructor(urls: string[], requestsPerSecond: number) {
    this.endpoints = urls;
    this.minInterval = 1000 / requestsPerSecond;
  }

  get current(): string {
    return this.endpoints[this.currentIndex];
  }

  rotate(): string {
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    console.log(`  ↻ Rotated to endpoint ${this.currentIndex + 1}/${this.endpoints.length}: ${this.current.slice(0, 40)}...`);
    return this.current;
  }

  async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minInterval) {
      await sleep(this.minInterval - elapsed);
    }
    this.lastCallTime = Date.now();
  }

  createClient(chain = mainnet): PublicClient {
    return createPublicClient({ chain, transport: http(this.current) }) as PublicClient;
  }
}

// ─── Section 3: Retry with Backoff & Rotation ──────────────────────────────

async function withRetry<T>(
  manager: EndpointManager,
  operation: (client: PublicClient) => Promise<T>,
  context: string,
): Promise<T> {
  let lastError: Error | null = null;
  const totalAttempts = CONFIG.retryAttempts * manager['endpoints'].length;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    await manager.rateLimit();
    const client = manager.createClient();

    try {
      return await operation(client);
    } catch (err: any) {
      lastError = err;
      const code = err?.code ?? 0;
      const status = err?.status ?? 0;
      const msg = (err?.message ?? '').toLowerCase();

      // Rate limited — back off longer
      if (status === 429 || code === 429 || msg.includes('rate limit')) {
        const backoff = CONFIG.retryBackoffMs * Math.pow(2, attempt % CONFIG.retryAttempts);
        console.warn(`  ⏳ Rate limited on ${context}. Backing off ${backoff}ms...`);
        await sleep(backoff + Math.random() * 1000);
        if ((attempt + 1) % CONFIG.retryAttempts === 0) manager.rotate();
        continue;
      }

      // Range error — not a retry issue, propagate
      if (code === -32005 || code === -32602 || code === -32614 ||
          msg.includes('range') || msg.includes('too many') || msg.includes('exceed')) {
        throw err;
      }

      // Empty response (some providers return nothing for historical blocks)
      if (msg.includes('empty') || msg.includes('null') || msg.includes('not found')) {
        console.warn(`  ⚠️ Empty response for ${context} — rotating endpoint`);
        manager.rotate();
        continue;
      }

      // Generic error — retry with backoff
      const backoff = CONFIG.retryBackoffMs * Math.pow(2, attempt % CONFIG.retryAttempts);
      console.warn(`  ⚠️ Error on ${context}: ${msg.slice(0, 80)}. Retry in ${backoff}ms...`);
      await sleep(backoff);
      if ((attempt + 1) % CONFIG.retryAttempts === 0) manager.rotate();
    }
  }

  throw new Error(`All retries exhausted for ${context}: ${lastError?.message}`);
}

// ─── Section 4: Checkpoint / Resume ────────────────────────────────────────

interface Checkpoint {
  lastProcessedBlock: bigint;
  lastProcessedIndex: number;
  rowsWritten: number;
  timestamp: string;
}

function loadCheckpoint(): Checkpoint | null {
  try {
    const raw = fs.readFileSync(CONFIG.checkpointFile, 'utf-8');
    const data = JSON.parse(raw);
    return {
      ...data,
      lastProcessedBlock: BigInt(data.lastProcessedBlock),
    };
  } catch {
    return null;
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  fs.writeFileSync(CONFIG.checkpointFile, JSON.stringify({
    ...cp,
    lastProcessedBlock: cp.lastProcessedBlock.toString(),
  }, null, 2));
}

// ─── Section 5: CSV Output ─────────────────────────────────────────────────

class CsvWriter {
  private fd: number;
  private headerWritten: boolean;
  rowCount = 0;

  constructor(filePath: string, private delimiter = ',') {
    const exists = fs.existsSync(filePath);
    this.fd = fs.openSync(filePath, 'a');
    this.headerWritten = exists && fs.statSync(filePath).size > 0;
  }

  writeHeader(columns: string[]): void {
    if (!this.headerWritten) {
      fs.writeSync(this.fd, columns.join(this.delimiter) + '\n');
      this.headerWritten = true;
    }
  }

  writeRow(values: (string | number | bigint)[]): void {
    const line = values.map(v => typeof v === 'bigint' ? v.toString() : String(v))
      .join(this.delimiter);
    fs.writeSync(this.fd, line + '\n');
    this.rowCount++;
  }

  close(): void {
    fs.closeSync(this.fd);
  }
}

// ─── Section 6: Adaptive Log Scanner (from rpc-field-guide.md Section 5) ──

const RANGE_ERRORS = new Set([-32005, -32602, -32614, -32000]);

async function getLogsAdaptive(
  manager: EndpointManager,
  opts: {
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
    initialChunkSize?: number;
    minChunkSize?: number;
  },
): Promise<Log[]> {
  const { address, topics, fromBlock, toBlock, initialChunkSize = 2000, minChunkSize = 10 } = opts;
  const allLogs: Log[] = [];
  let cursor = fromBlock;
  let chunk = BigInt(initialChunkSize);
  const maxChunk = chunk * 4n;
  let scannedChunks = 0;

  while (cursor <= toBlock) {
    const end = cursor + chunk - 1n > toBlock ? toBlock : cursor + chunk - 1n;

    try {
      const logs = await withRetry(
        manager,
        (client) => client.getLogs({ address, topics, fromBlock: cursor, toBlock: end }),
        `getLogs [${cursor}-${end}]`,
      );
      allLogs.push(...logs.filter((l: any) => !l.removed));
      cursor = end + 1n;
      if (chunk < maxChunk) chunk *= 2n;
      scannedChunks++;
      if (scannedChunks % 10 === 0) {
        const progress = Number(cursor - fromBlock) / Number(toBlock - fromBlock) * 100;
        console.log(`  📊 Scan progress: ${progress.toFixed(1)}% (${allLogs.length} logs found)`);
      }
    } catch (err: any) {
      const code = err?.code ?? 0;
      const msg = (err?.message ?? '').toLowerCase();
      if (RANGE_ERRORS.has(code) || msg.includes('range') || msg.includes('too many') || msg.includes('exceed')) {
        chunk /= 2n;
        if (chunk < BigInt(minChunkSize)) {
          throw new Error(`Stuck at ${minChunkSize}-block chunk (block ${cursor}). Narrow your filter.`);
        }
        continue;
      }
      throw err;
    }
  }
  return allLogs;
}

// ─── Section 7: Your Collection Logic (CUSTOMIZE THIS) ────────────────────

async function collectData(manager: EndpointManager): Promise<void> {
  const csv = new CsvWriter(CONFIG.outputFile, CONFIG.outputDelimiter);
  const checkpoint = loadCheckpoint();

  // Detect anchor block
  const safeBlock = await withRetry(manager, async (c) => {
    try { return (await c.getBlock({ blockTag: 'safe' })).number!; }
    catch { return await c.getBlockNumber(); }
  }, 'getAnchorBlock');

  const fromBlock = checkpoint?.lastProcessedBlock ?? CONFIG.fromBlock;
  const toBlock = CONFIG.toBlock || safeBlock;

  console.log(`\n═══ DATA COLLECTION ═══`);
  console.log(`Chain anchor: block ${toBlock}`);
  console.log(`Scanning: blocks ${fromBlock} → ${toBlock}`);
  console.log(`Endpoints: ${CONFIG.rpcUrls.length}`);
  if (checkpoint) console.log(`Resuming from checkpoint: ${checkpoint.rowsWritten} rows written`);
  console.log(`═══════════════════════\n`);

  // ── Example: Scan Transfer events for a token ──
  // Replace this section with your actual collection logic.

  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex;

  csv.writeHeader(['block', 'txHash', 'logIndex', 'from', 'to', 'value']);

  const logs = await getLogsAdaptive(manager, {
    address: CONFIG.targetAddress,
    topics: [TRANSFER_TOPIC],
    fromBlock,
    toBlock,
  });

  console.log(`\nFound ${logs.length} Transfer events. Writing CSV...`);

  let opsCount = 0;
  for (const log of logs) {
    if (log.topics.length < 3) continue;
    const from = `0x${log.topics[1]!.slice(26)}`;
    const to = `0x${log.topics[2]!.slice(26)}`;
    const value = BigInt(log.data);

    csv.writeRow([
      log.blockNumber!.toString(),
      log.transactionHash!,
      Number(log.logIndex),
      from,
      to,
      value,
    ]);

    opsCount++;
    if (opsCount % CONFIG.checkpointInterval === 0) {
      saveCheckpoint({
        lastProcessedBlock: log.blockNumber!,
        lastProcessedIndex: Number(log.logIndex),
        rowsWritten: csv.rowCount,
        timestamp: new Date().toISOString(),
      });
    }
  }

  csv.close();

  // Final checkpoint
  saveCheckpoint({
    lastProcessedBlock: toBlock,
    lastProcessedIndex: 0,
    rowsWritten: csv.rowCount,
    timestamp: new Date().toISOString(),
  });

  console.log(`\n✅ Done. ${csv.rowCount} rows written to ${CONFIG.outputFile}`);
  console.log(`   Checkpoint saved to ${CONFIG.checkpointFile}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const manager = new EndpointManager(CONFIG.rpcUrls, CONFIG.requestsPerSecond);
  await collectData(manager);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
