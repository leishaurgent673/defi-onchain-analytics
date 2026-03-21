# RPC Field Guide

Complete reference for Ethereum JSON-RPC methods, block tags, log filtering, tracing, state overrides, and chain-specific configurations relevant to DeFi on-chain analytics.

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

---

## 10. Recommended Public RPC Endpoints

Ranked by median latency from Asia-Pacific benchmarks. Use multiple endpoints for redundancy.

### BSC (Chain ID: 56)

> **Warning:** Official BNB Chain dataseeds do **NOT** support `eth_getLogs`. Use the providers below.

| Provider | Endpoint | Median Latency |
|----------|----------|---------------|
| dRPC | `https://bsc.drpc.org` | 150ms |
| BlockRazor | `https://bsc.blockrazor.xyz` | 153ms |
| 48Club | `https://rpc-bsc.48.club` | 123ms |

### Base (Chain ID: 8453)

| Provider | Endpoint | Median Latency |
|----------|----------|---------------|
| 1RPC | `https://1rpc.io/base` | 190ms |
| Tatum | `https://base-mainnet.gateway.tatum.io` | 183ms |
| Tenderly | `https://base.gateway.tenderly.co` | 229ms |

### Katana (Chain ID: 747474)

| Provider | Endpoint | Median Latency |
|----------|----------|---------------|
| dRPC | `https://katana.drpc.org` | 75ms |
| Tenderly | `https://katana.gateway.tenderly.co` | 158ms |
| katanarpc.com | `https://rpc.katanarpc.com` | 165ms |

### Ethereum (Chain ID: 1)

| Provider | Endpoint |
|----------|----------|
| PublicNode | `https://ethereum-rpc.publicnode.com` |
| 1RPC | `https://1rpc.io/eth` |

### Arbitrum (Chain ID: 42161)

| Provider | Endpoint |
|----------|----------|
| PublicNode | `https://arbitrum-one-rpc.publicnode.com` |
| 1RPC | `https://1rpc.io/arb` |

### Polygon (Chain ID: 137)

| Provider | Endpoint |
|----------|----------|
| PublicNode | `https://polygon-bor-rpc.publicnode.com` |
| 1RPC | `https://1rpc.io/matic` |
