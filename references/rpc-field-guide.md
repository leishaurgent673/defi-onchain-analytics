# RPC Field Guide

Complete reference for Ethereum JSON-RPC methods, block tags, log filtering, tracing, state overrides, and chain-specific configurations relevant to DeFi on-chain analytics.

## Contents
- [1. Analytics-Relevant RPC Methods](#1-analytics-relevant-rpc-methods)
- [2. Block Tags](#2-block-tags)
- [3. eth_getLogs Filter Object](#3-eth_getlogs-filter-object)
- [4. Log Response Fields](#4-log-response-fields)
- [5. Adaptive Chunking for eth_getLogs](#5-adaptive-chunking-for-eth_getlogs)
- [6. Tracing Methods](#6-tracing-methods)
- [7. State Overrides](#7-state-overrides)
- [8. Multicall3 Batching](#8-multicall3-batching)
- [9. Chain-Specific Configuration](#9-chain-specific-configuration)
- [10. RPC Endpoint Selection](#10-rpc-endpoint-selection)
- [11. Tier D Fallback: Block Explorer APIs](#11-tier-d-fallback-block-explorer-apis)

---

## 1. Analytics-Relevant RPC Methods

18 methods organized by tier. **Tier A** = universally available on all providers. **Tier B** = requires archive node for historical queries. **Tier C** = debug/trace namespace, requires archive node with tracing enabled.

| Method | Params | Returns | Tier | Analytics Use |
|--------|--------|---------|------|---------------|
| `eth_blockNumber` | none | hex block | A | Chain tip, range calc |
| `eth_chainId` | none | hex chain ID | A | Multi-chain routing |
| `eth_getBlockByNumber` | block tag, bool | block obj | A | Timestamps, gas, miner |
| `eth_getBalance` | addr, block | wei (hex) | A (current) / B (historical) | Balance snapshots |
| `eth_call` | tx obj, block | hex return | A (current) / B (historical) | Read any view function |
| `eth_getLogs` | filter obj | log array | A | **Primary event scanner** |
| `eth_getStorageAt` | addr, slot, block | 32-byte hex | A (current) / B (historical) | Raw storage reads |
| `eth_getTransactionReceipt` | tx hash | receipt | A | Tx outcome, gas, logs |
| `eth_getTransactionByHash` | tx hash | tx obj | A | Tx inspection, input decode |
| `eth_getCode` | addr, block | bytecode | A | EOA vs contract detection |
| `eth_getTransactionCount` | addr, block | nonce | A | Activity level |
| `eth_getProof` | addr, keys, block | proof obj | A | Merkle proof verification |
| `eth_getBlockReceipts` | block | receipts[] | A (varies) | Block-level log ingestion |
| `eth_createAccessList` | tx obj | access list | A | Predict storage slots touched |
| `debug_traceTransaction` | tx hash, tracer cfg | trace | C | Internal calls, fund flow |
| `debug_traceCall` | tx obj, block, tracer | trace | C | Simulate + trace |
| `trace_filter` | filter obj | traces[] | C (Erigon) | Address-range internal tx search |
| `trace_transaction` | tx hash | traces[] | C (Erigon) | Full call tree |

---

## 2. Block Tags

Six valid values for any block parameter:

| Value | Meaning |
|-------|---------|
| `"latest"` | Most recent mined block |
| `"safe"` | Lower reorg risk; ~4 min behind tip on Ethereum |
| `"finalized"` | No reorg possible; ~15 min behind tip on Ethereum |
| `"pending"` | Pending/proposed block (not all providers support) |
| `"earliest"` | Genesis block (block 0) |
| Hex number (e.g. `"0xF4240"`) | Specific block by number |

### L2 Differences (OP Stack: Base, Optimism, etc.)

- `latest` = **unsafe head** — sequencer can still reorg this block
- `safe` = **L1-derived** — block data has been posted to L1
- `finalized` = **L1-finalized** — the L1 block containing the batch is finalized

**Default recommendation:** Use `safe` for analytics queries on OP Stack chains. Only use `latest` when you need real-time data and can tolerate reorgs.

---

## 3. eth_getLogs Filter Object

### Structure

```json
{
  "fromBlock": "0x...",
  "toBlock": "0x...",
  "address": "0x..." | ["0x...", "0x..."],
  "topics": [
    "0x...",
    "0x..." | null | ["0x...", "0x..."],
    null,
    null
  ]
}
```

### Topic Encoding

- **`topics[0]`** = `keccak256(EventSignature)` — e.g., `keccak256("Transfer(address,address,uint256)")` = `0xddf252ad...`
- **`topics[1-3]`** = Indexed parameter values, 32-byte zero-padded
- **`data`** = Non-indexed parameters, ABI-encoded (not part of the filter, but present in response)

### Filter Logic

- **OR** within a position: use nested arrays — `topics: [[sigA, sigB], null]` matches events with signature sigA **OR** sigB
- **AND** across positions: multiple topic positions combine with AND — `topics: [sigA, addr1]` matches events with signature sigA **AND** indexed param addr1
- **`null`** at any position = wildcard (match anything)
- **`blockHash`** is mutually exclusive with `fromBlock`/`toBlock` — you cannot use both; the RPC call will error

---

## 4. Log Response Fields

| Field | Type | Analytics Significance |
|-------|------|----------------------|
| `address` | hex address | Contract that emitted the event |
| `topics[0]` | bytes32 | Event signature hash |
| `topics[1-3]` | bytes32 | Indexed parameter values (32-byte padded) |
| `data` | hex bytes | ABI-encoded non-indexed parameters |
| `blockNumber` | hex quantity | Block reference for time alignment |
| `transactionIndex` | hex quantity | Tx ordering within block |
| `logIndex` | hex quantity | Log ordering within block (critical for multi-hop swap tracing) |
| `blockHash` | bytes32 | Block identifier |
| `removed` | bool | `true` if log was removed due to chain reorg — **must handle** |

**Reorg handling:** When `removed` is `true`, the log was part of a block that has been replaced. Analytics pipelines must detect and reverse any state derived from removed logs.

---

## 5. Adaptive Chunking Strategy

Large `eth_getLogs` queries will fail if they return too many results. Use adaptive chunking to scan arbitrary block ranges reliably.

### Algorithm

1. **Start** with the provider's estimated max range, or **2,000 blocks** as a safe default
2. **Query** `eth_getLogs` for that window (`fromBlock` to `fromBlock + chunkSize`)
3. **If response exceeds cap** (provider returns error, or result exceeds 10,000 logs or ~150MB payload): **bisect** the range into two halves and retry each half independently
4. **Advance** `fromBlock` past the successfully scanned range and repeat until the target `toBlock` is reached
5. **Always handle** `removed: true` logs — after scanning, check for removed entries and reverse any derived state

### Implementation Notes

- Some providers return a specific error code (e.g., `-32005`) when the log result set is too large; use this as the bisect trigger
- Track the effective chunk size per provider and adapt dynamically — if a range succeeds, you can try a larger chunk next time
- For high-event contracts (e.g., USDT, Uniswap pools), chunk sizes may need to shrink to 100-500 blocks during peak activity
- Always use hex-encoded block numbers in the filter, not block tags, for precise range control

### Known Provider Block Range Limits

Actual `eth_getLogs` limits vary by provider, tier, and chain. **There is no standard RPC method to query a provider's limit** — always implement probing (start generous, bisect on failure).

| Provider | Free Tier Limit | Notes |
|----------|----------------|-------|
| Alchemy | ~10 blocks (Ethereum, L2s) | Extremely restrictive free tier; hard cap based on response size |
| Infura | 10,000 results / 10s timeout | Implicit limit — caps by data volume, not block count |
| QuickNode | 10,000 blocks | Explicitly documented hard cap |
| Chainstack | 100 blocks (Developer) | Increases to ~10K on paid tiers |
| dRPC | 1,000-10,000 (varies) | As a relay, limits depend on underlying node; free tier often ~10K |
| Tenderly | ~100,000 blocks | Very generous free tier for getLogs |
| PublicNode | ~2,000 blocks | Conservative but stable |
| BlockPI | ~1,000-5,000 | Varies by chain and load |
| Ankr | ~3,000-10,000 | Premium endpoints have higher limits |

> **These limits change frequently.** Hardcoding limits is fragile. Always probe at runtime.

*Sources: [Alchemy Docs](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs), [QuickNode Docs](https://www.quicknode.com/docs/ethereum/eth_getLogs), [Infura Docs](https://docs.infura.io/api/networks/ethereum/json-rpc-methods)*

### Error Codes for Range Exceedance

| Error Code | Common Providers | Meaning | Action |
|-----------|-----------------|---------|--------|
| `-32005` | Most providers (Infura, dRPC, PublicNode) | Block range or result count exceeded | Bisect the range and retry |
| `-32602` | Alchemy | Invalid params / range too large | Bisect the range and retry |
| `-32614` | QuickNode | Exceeds max block range | Bisect the range and retry |
| `-32000` | Chainstack, generic | Server error (often range-related) | Bisect the range and retry |
| `429` | All providers | Rate limit (requests/second exceeded) | Exponential backoff, then retry |

Also check error `message` strings for: `"range"`, `"limit"`, `"too many"`, `"exceed"`, `"query returned more than"`.

### Production Code Template (TypeScript + viem)

Self-contained adaptive chunking with bisection, suitable for full-chain event scanning:

```typescript
import { createPublicClient, http, type Log, type Address, type Hex } from 'viem';

interface ChunkingOptions {
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
  /** Starting chunk size in blocks. Default: 2000. */
  initialChunkSize?: number;
  /** Minimum chunk before giving up. Default: 10. */
  minChunkSize?: number;
}

async function getLogsAdaptive(
  client: ReturnType<typeof createPublicClient>,
  options: ChunkingOptions
): Promise<Log[]> {
  const {
    address, topics, fromBlock, toBlock,
    initialChunkSize = 2000,
    minChunkSize = 10,
  } = options;

  const allLogs: Log[] = [];
  let currentFrom = fromBlock;
  let chunkSize = BigInt(initialChunkSize);
  const maxChunk = BigInt(initialChunkSize) * 4n;

  while (currentFrom <= toBlock) {
    const currentTo = currentFrom + chunkSize - 1n > toBlock
      ? toBlock
      : currentFrom + chunkSize - 1n;

    try {
      const logs = await client.getLogs({
        address, topics,
        fromBlock: currentFrom,
        toBlock: currentTo,
      });
      allLogs.push(...logs);
      currentFrom = currentTo + 1n;
      // Grow on success (capped at 4x initial)
      if (chunkSize < maxChunk) chunkSize = chunkSize * 2n;
    } catch (error: any) {
      const msg = error?.message ?? '';
      const code = error?.code ?? 0;
      if (code === -32005 || code === -32602 || code === -32614 ||
          msg.includes('range') || msg.includes('limit') ||
          msg.includes('too many') || msg.includes('exceed')) {
        chunkSize = chunkSize / 2n;
        if (chunkSize < BigInt(minChunkSize)) {
          throw new Error(
            `getLogs failed at ${minChunkSize}-block chunk ` +
            `(block ${currentFrom}). Too many events per block — ` +
            `try filtering by address or topic to reduce results.`
          );
        }
        continue; // Retry with smaller chunk
      }
      throw error; // Unknown error — propagate
    }
  }
  return allLogs;
}
```

### Probing Strategy (Runtime Limit Discovery)

1. Start with a generous chunk (e.g., 50,000 blocks)
2. On success → this is the effective limit (use it going forward)
3. On `-32005` / similar → bisect repeatedly until success
4. Cache the effective chunk size per (provider, chain) pair — reuse across queries
5. Re-probe periodically; provider limits can change with updates

---

## 6. Geth Built-in Tracers

Used with `debug_traceTransaction` and `debug_traceCall`. Requires archive node with debug namespace enabled.

| Tracer | Config | Output | Use Case |
|--------|--------|--------|----------|
| `callTracer` | `{ onlyTopCall: bool, withLog: bool }` | Nested call tree with `type`/`from`/`to`/`value`/`gas`/`input`/`output`/`error` + logs if `withLog: true` | Fund flow tracing, internal call reconstruction |
| `prestateTracer` | `{ diffMode: bool, disableCode: bool, disableStorage: bool }` | Pre/post state per touched account (balance, nonce, code, storage). With `diffMode: true`, returns only changed values | State change audit, exploit analysis |
| `4byteTracer` | none | Map of `"selector-calldatasize": count` | Quick function call profiling, identifying which methods were invoked |
| `flatCallFrame` | none | Flattened list of calls in Parity-compatible format | Indexing / database insertion (flat structure easier to store) |

### Example: callTracer with logs

```json
{
  "method": "debug_traceTransaction",
  "params": [
    "0xTXHASH",
    { "tracer": "callTracer", "tracerConfig": { "onlyTopCall": false, "withLog": true } }
  ]
}
```

### Example: prestateTracer in diff mode

```json
{
  "method": "debug_traceTransaction",
  "params": [
    "0xTXHASH",
    { "tracer": "prestateTracer", "tracerConfig": { "diffMode": true } }
  ]
}
```

---

## 7. State Override (eth_call 3rd Parameter)

The 3rd parameter to `eth_call` allows overriding account state for the duration of the simulated call. This is a map of address to override object.

| Field | Type | Effect |
|-------|------|--------|
| `balance` | hex quantity | Set account balance for the simulation |
| `nonce` | hex quantity | Set account nonce |
| `code` | hex binary | Inject arbitrary bytecode at the address |
| `state` | slot -> value map | **REPLACE ALL storage** — unlisted slots become zero |
| `stateDiff` | slot -> value map | **PATCH specific slots** — unlisted slots are preserved |

**Critical distinction:** `state` wipes everything and only sets the slots you specify (all other slots read as zero). `stateDiff` merges your overrides with existing storage. **Never use both `state` and `stateDiff` on the same address** — behavior is undefined.

### Example: Simulate a call as if an address holds 1000 ETH

```json
{
  "method": "eth_call",
  "params": [
    { "to": "0xCONTRACT", "data": "0x..." },
    "latest",
    {
      "0xSIMULATED_CALLER": {
        "balance": "0x3635C9ADC5DEA00000"
      }
    }
  ]
}
```

### Example: Override a single storage slot without wiping others

```json
{
  "0xCONTRACT": {
    "stateDiff": {
      "0x0000000000000000000000000000000000000000000000000000000000000005": "0x00000000000000000000000000000000000000000000000000000000000003e8"
    }
  }
}
```

---

## 8. Block Override (eth_call 4th Parameter)

The 4th parameter to `eth_call` allows overriding block context for the simulation. Useful for testing time-dependent logic or simulating conditions at different block parameters.

| Field | Type | Effect |
|-------|------|--------|
| `number` | hex quantity | Override `block.number` |
| `time` | hex quantity | Override `block.timestamp` |
| `gasLimit` | hex quantity | Override block gas limit |
| `feeRecipient` | address | Override `block.coinbase` (fee recipient) |
| `prevRandao` | bytes32 | Override `block.prevrandao` (post-merge randomness) |
| `baseFeePerGas` | hex quantity | Override base fee |
| `blobBaseFee` | hex quantity | Override EIP-4844 blob base fee |

### Example: Simulate a call 1 hour in the future

```json
{
  "method": "eth_call",
  "params": [
    { "to": "0xCONTRACT", "data": "0x..." },
    "latest",
    {},
    { "time": "0x6614A3F0" }
  ]
}
```

---

## 9. Chain Configuration

Pre-configured chain parameters for analytics workflows.

| Chain | Chain ID | Finality Model | Block Time | Anchor Default | Notes |
|-------|----------|---------------|------------|---------------|-------|
| **Ethereum** | 1 | `safe` / `finalized` supported | ~12s | `safe` | Full trace support on Geth archive nodes |
| **Arbitrum** | 42161 | L2 fast finality, `safe` tag available | ~0.25s | `safe` | Nitro node supports `debug` namespace |
| **Base** | 8453 | OP Stack: unsafe / safe / finalized | ~2s | `safe` | Flashblocks endpoint for pre-confirmations |
| **BSC** | 56 | `finalized` supported | ~3s | `finalized` | Official dataseeds do **NOT** support `eth_getLogs` |
| **Polygon** | 137 | `finalized` supported | ~2s | `finalized` | Heimdall checkpoints for finality |
| **Katana** | 747474 | Fast finality (~1s blocks) | ~1s | `latest` (fast finality) | Only 5 public mainnet endpoints; gas ~0.001 Gwei |

### Chain-Specific Guidance

- **Ethereum**: Blocks are slow (~12s) but finality is strong. Use `safe` for most analytics; `finalized` when correctness is critical and ~15 min lag is acceptable.
- **Arbitrum**: Very fast block times (~0.25s) mean high volume. Chunking must use smaller block ranges but each block has fewer logs. Nitro debug namespace is available on archive nodes.
- **Base**: OP Stack semantics apply — `latest` from the sequencer is unsafe and can reorg. Always use `safe` or `finalized` for analytics. Flashblocks endpoint provides pre-confirmation data.
- **BSC**: The official dataseeds RPC endpoints do **NOT** support `eth_getLogs`. Use third-party providers (dRPC, BlockRazor, 48Club) for log queries.
- **Polygon**: Finality depends on Heimdall checkpoints posted to Ethereum. Use `finalized` tag for analytics that must survive reorgs.
- **Katana**: Newer chain with limited public infrastructure. Only 5 known public mainnet endpoints. Gas costs are negligible (~0.001 Gwei). Fast finality means `latest` is a safe default.

### L2 Operational Considerations for Analytics

L2 chains differ from Ethereum L1 in ways that directly affect analytics workflows. Failing to account for these differences leads to incorrect chunk sizes, stale anchors, or incomplete data.

#### Block Cadence Impact on Chunking

| Chain | Avg Block Time | Blocks/Day | Recommended getLogs Chunk Size |
|-------|---------------|------------|-------------------------------|
| Ethereum L1 | ~12s | ~7,200 | 2,000-5,000 blocks |
| Arbitrum One | ~0.25s | ~345,600 | 5,000-10,000 blocks (fast blocks, fewer events per block) |
| Base / Optimism | ~2s | ~43,200 | 1,000-2,000 blocks |
| Polygon PoS | ~2s | ~43,200 | 1,000-2,000 blocks |
| BSC | ~3s | ~28,800 | 500-1,000 blocks (high throughput per block) |
| Katana (Ronin) | ~1s | ~86,400 | 1,000-5,000 blocks |

> Fast-block L2s like Arbitrum accumulate blocks rapidly but each block typically contains fewer events. Adjust chunk sizes based on event density, not just block count. Always use adaptive chunking (Section 5) rather than hardcoded sizes.

#### Finality Semantics by Architecture

**OP Stack (Base, Optimism):**
- `latest` = **unsafe head** — sequencer-determined, can reorg if sequencer fails to post to L1
- `safe` = **L1-derived** — block data posted to L1; reorgs only if L1 reorgs (extremely rare)
- `finalized` = **L1-finalized** — corresponding L1 block is finalized (~13 min behind tip)
- **Recommendation:** Use `safe` for analytics. Only use `latest` for real-time monitoring where you accept reorg risk.

**Arbitrum (Nitro):**
- Sequencer provides soft finality within seconds; hard finality once batch is posted to L1
- `safe` and `finalized` tags reflect L1-derived finality
- **Recommendation:** Use `safe` for reproducible analytics.

**Sidechains (Ronin/Katana, BSC, Polygon PoS):**
- Finality via validator consensus (DPoS/BFT), not L1 proof-posting
- `finalized` tag supported but finality windows are shorter and model-dependent
- **Recommendation:** Use `finalized` where supported; otherwise `latest` with awareness of consensus-based finality (~6s for Ronin, ~3s for BSC with BFT).

#### Bridge Tracing

When an investigation reveals cross-chain activity, expand scope to the source/destination chain:

| Bridge Type | Key Events | Detection |
|------------|------------|-----------|
| **OP Stack Standard Bridge** | `DepositInitiated(address,address,address,uint256,uint256,bytes)` on L1; `WithdrawalInitiated` on L2 | Check L1StandardBridge / L2StandardBridge contracts |
| **Arbitrum Bridge** | `MessageDelivered` (Inbox), `OutboxTransactionExecuted` (Outbox) | Check Arbitrum Bridge contract |
| **Generic token bridge** | `Transfer` events to/from known bridge contract addresses | Maintain a per-chain bridge address registry |

**Strategy:** When a funding trace leads to a bridge contract, query the bridge's deposit events on the current chain, extract the source-chain sender address, and continue the investigation on the source chain.

#### Provider Coverage on L2s

- **Ethereum L1:** 20+ public providers, most support full API
- **Arbitrum, Base, Polygon:** 10-15 providers, good coverage
- **BSC:** Good coverage but official dataseeds do NOT support `eth_getLogs`
- **Katana:** Only 5 public mainnet endpoints — always configure all 5 as fallbacks
- **Newer L2s:** May have ≤3 providers — plan for limited redundancy

---

## 10. Public RPC Endpoint Registry

Full endpoint registry is in **`references/rpc-endpoints.ts`** — a typed, structured data file with all verified public RPC endpoints for every supported chain, including tier rankings, latency benchmarks, capability flags, and auto-selection logic.

**Quick reference (top 3 fallbacks per chain):**

```typescript
const RPC_FALLBACKS: Record<number, string[]> = {
  1:      ["https://ethereum-mainnet.gateway.tatum.io/", "https://1rpc.io/eth", "https://ethereum.publicnode.com/"],
  42161:  ["https://1rpc.io/arb", "https://arbitrum.gateway.tenderly.co/", "https://arbitrum-one.publicnode.com/"],
  8453:   ["https://base-mainnet.gateway.tatum.io", "https://1rpc.io/base", "https://base.gateway.tenderly.co"],
  56:     ["https://bsc.drpc.org", "https://bsc.blockrazor.xyz", "https://rpc-bsc.48.club"],
  137:    ["https://1rpc.io/matic", "https://polygon-bor.publicnode.com/", "https://polygon-mainnet.gateway.tatum.io/"],
  747474: ["https://katana.drpc.org", "https://katana.gateway.tenderly.co", "https://rpc.katanarpc.com"],
};
```

See the full file for per-endpoint tier, latency, getLogs support, and notes.

---

## 11. Tier D Fallback: Block Explorer APIs

When RPC `eth_getLogs` cannot complete full-history scans due to block range limits, block explorer APIs serve as a practical fallback. **Label all explorer-sourced data as `[ENRICH]` tier and cross-validate a sample against RPC.**

### Blockscout API

```
GET /api?module=logs&action=getLogs&address={addr}&fromBlock=0&toBlock=latest&topic0={hash}
```

- **Full history support:** Yes — `fromBlock=0&toBlock=latest` scans the entire chain
- **Max results per response:** 1,000 records
- **Pagination:** Use `page` and `offset` parameters for subsequent pages
- **Rate limit (free):** ~5 requests/second (varies by instance)
- **Chains:** Katana/Ronin, many L2s. Check `explorer.roninchain.com`, etc.

*Source: [Blockscout Logs API Docs](https://docs.blockscout.com/devs/apis/rpc/logs)*

### Etherscan-Compatible API (V2)

```
GET https://api.etherscan.io/v2/api?chainid={id}&module=logs&action=getLogs&address={addr}&fromBlock=0&toBlock=latest&topic0={hash}&page=1&offset=1000&apikey={key}
```

- **Full history support:** Yes — no hard block range limit (unlike RPC providers)
- **Max results per response:** 1,000 records (`offset` parameter)
- **Pagination:** Required for large result sets — use `page` parameter
- **Rate limit (free):** 3-5 requests/second depending on chain
- **Chains:** Ethereum (Etherscan), Base (Basescan), Arbitrum (Arbiscan), Polygon (Polygonscan), BSC (BscScan)

*Source: [Etherscan V2 Logs API](https://docs.etherscan.io/api-reference/endpoint/getlogs)*

### Key Differences vs RPC `eth_getLogs`

| Feature | RPC `eth_getLogs` | Explorer API `getLogs` |
|---------|-------------------|----------------------|
| **Protocol** | JSON-RPC (POST) | REST (GET) |
| **Block range** | Provider-limited (often 1K-10K blocks) | No hard range limit (paginated by results) |
| **Response format** | Standard log objects | Similar but may include extra fields (timestamps) |
| **Pagination** | Implicit (by block range chunking) | Explicit (`page`/`offset` parameters) |
| **Data freshness** | Immediate (from node state) | Seconds behind (indexer pipeline lag) |
| **Pending transactions** | Supported via `pending` tag | Not available (post-confirmation only) |
| **`removed` flag (reorgs)** | Included in response | Typically not exposed |
| **Rate limits** | Per-provider RPS quotas | Strict API-key-based limits |

### When to Use Explorer APIs

- **Full-history event scanning** where RPC range limits make chunking impractical (e.g., scanning 27M blocks on an L2 with a 10K-block RPC limit)
- **First-transaction discovery** for funding trace analysis (`txlist` endpoint with `sort=asc`)
- **Quick contract creation lookup** (`txlist` endpoint filtered to the earliest tx)

### Validation Protocol

Explorer data is only as reliable as the explorer's indexing pipeline. Always:
1. **Spot-check** 3-5 explorer results against direct RPC queries at the same block numbers
2. **Verify event counts** match between explorer pagination totals and RPC-based scanning of a sample range
3. **Label all findings** sourced from explorer APIs as `[ENRICH]` tier in the evidence register
4. **Do not mix** explorer-sourced timestamps with RPC-sourced timestamps without verifying they use the same block reference
