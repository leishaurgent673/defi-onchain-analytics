# Contract Inspection

> **Minimum tier requirements:**
> - **Tier A (CORE)** — Event log decoding, storage reads, proxy detection, bytecode analysis, access list prediction
> - **Tier C (TRACE)** — Trace-based fund flow analysis, state diff analysis, state override hypothesis testing

---

## Event Log Decoding Workflow `[CORE]`

Five-step process to extract structured data from raw Ethereum event logs:

### Step 1 — Retrieve Raw Logs

Query `eth_getLogs` with bounded block range and appropriate filters:

```json
{
  "fromBlock": "0x...",
  "toBlock": "0x...",
  "address": "0xContractAddress",
  "topics": ["0xEventSignatureHash", null, null, null]
}
```

Always constrain the block range. Unbounded queries risk timeout or truncation. Use adaptive chunking if the range spans more than the provider's limit (typically 2,000-10,000 blocks).

### Step 2 — Match Event Signature

Compare `topics[0]` against known event signature hashes. The signature hash is `keccak256` of the canonical event signature string:

| Event | Signature Hash (`topics[0]`) |
|-------|------------------------------|
| `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| `Approval(address,address,uint256)` | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |
| `Swap(...)` (Uniswap V2) | `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822` |
| `Swap(...)` (Uniswap V3) | `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67` |

Reference `references/common-abis.md` for the full signature catalog.

### Step 3 — Extract Indexed Parameters

Indexed parameters occupy `topics[1]` through `topics[3]` (maximum 3 indexed params per event, or 4 for anonymous events). Each topic is a 32-byte value, left-padded with zeros:

- **Fixed types** (`address`, `uint256`, `bool`, `bytesN`): decode directly from the 32-byte topic slot. For `address`, strip the leading 12 zero bytes.
- **Dynamic types** (`string`, `bytes`, arrays): the topic contains only the `keccak256` hash of the original value. **The original value is irrecoverably lost from the log.** You can verify equality by hashing a candidate value and comparing, but you cannot reconstruct the content from the topic alone.

### Step 4 — Decode Non-Indexed Parameters

Non-indexed parameters are ABI-encoded in the `data` field of the log entry. Decode using standard ABI encoding rules:

- Each parameter occupies 32 bytes (or a pointer + length for dynamic types)
- Parameters appear in declaration order from the event definition
- The ABI used for decoding **must** have correct `indexed: true/false` annotations on each parameter. If the indexed flags are wrong, the topic/data boundary is misaligned and decoding silently produces garbage.

### Step 5 — Defensive Decoding with viem

Use `decodeEventLog` with `strict: false` for scanning across unknown or upgradeable contracts:

```typescript
import { decodeEventLog } from 'viem'

const decoded = decodeEventLog({
  abi: contractAbi,
  data: log.data,
  topics: log.topics,
  strict: false   // returns partial results on mismatch instead of throwing
})
// => { eventName: 'Transfer', args: { from, to, value } }
```

- `strict: false` — returns whatever fields could be parsed even when parameter count or types mismatch. Essential for defensive scanning where the ABI may not exactly match the deployed contract (upgrades, forks, unverified source).
- `strict: true` (default) — throws `DecodeLogDataMismatch` on size mismatch. Use when you have a verified ABI and want to catch data integrity issues immediately.

### Anonymous Events

Anonymous events have **no** `topics[0]` signature hash. All 4 topic slots are available for indexed parameters. This means:

- You cannot identify anonymous events by their signature hash — you must already know which contract emitted the log and what anonymous events that contract defines.
- Without prior knowledge of the contract, anonymous event logs are opaque: 4 topic slots of data with no self-describing metadata.
- Anonymous events are rare in production DeFi contracts but appear in privacy-oriented or gas-optimized contracts.

---

## Storage Inspection Workflow `[CORE]`

Four-step process to read and decode raw contract storage:

### Step 1 — Determine Storage Layout

Obtain the storage layout from one of:

- **Verified source code** — compile with `--storage-layout` flag or read from Etherscan/Sourcify metadata
- **Solidity layout rules** — reconstruct from the contract's variable declarations following standard rules (see `references/abi-fetching.md` for the complete layout table)
- **Storage layout JSON** — some verified contracts on Etherscan include the storage layout in compilation metadata

Key rule: **inheritance affects layout.** Solidity uses C3-linearized order (most base-ward first). If contract `C` inherits `B` inherits `A`, storage starts with `A`'s variables, then `B`'s, then `C`'s own. Reordering the inheritance list changes the entire layout.

### Step 2 — Compute Target Slot

| Variable Type | Slot Computation | Formula |
|--------------|-----------------|---------|
| Simple variable | Sequential slot number | Slot `N` directly (e.g., first variable = slot 0) |
| Mapping value | Hash of key and map slot | `keccak256(pad32(key) ++ pad32(mapSlot))` |
| Dynamic array element | Hash of array slot + index | `keccak256(arraySlot) + index` |
| Dynamic array length | Array's declared slot | Slot `N` directly — stores the array length |
| Nested mapping | Recursive application | `keccak256(pad32(key2) ++ keccak256(pad32(key1) ++ pad32(mapSlot)))` — inner key first, then outer |
| Struct member | Base slot + member offset | Compute the struct's starting slot, then add the member's offset within the struct |
| Short `bytes`/`string` (<=31 bytes) | Declared slot | Data left-aligned; lowest byte = `length * 2` |
| Long `bytes`/`string` (>=32 bytes) | Data at `keccak256(slot)` | Slot stores `length * 2 + 1`; check lowest bit: `0` = short, `1` = long |

**Constants and immutables are NOT in storage.** They are inlined into bytecode. `eth_getStorageAt` will not find them.

### Step 3 — Read Storage

```
eth_getStorageAt(address, slot, blockTag)
```

Returns a 32-byte hex value. Always pin to a specific block number for reproducibility — avoid `latest` in analytical workflows.

For reading multiple slots, batch requests via JSON-RPC batching or Multicall3 to minimize round-trips.

### Step 4 — Decode the Result

The raw 32-byte result must be decoded according to the variable type:

- `uint256`: interpret as big-endian unsigned integer
- `address`: rightmost 20 bytes (strip leading 12 zero bytes)
- `bool`: rightmost byte, `0x01` = true, `0x00` = false
- `int256`: two's complement big-endian signed integer

### Packing Rules

Multiple small variables can share a single 32-byte storage slot. Solidity packs variables **right-aligned** within the slot, in declaration order:

- Variables smaller than 32 bytes (`bool` = 1 byte, `uint8` = 1 byte, `address` = 20 bytes, `uint96` = 12 bytes, etc.) are packed into the same slot if they fit.
- Each variable is right-aligned within its allocated portion of the slot.
- The first declared variable occupies the **lowest** bytes of the slot.

You must know the exact layout to decode packed slots correctly. Reading a packed slot without knowing which variables share it will produce incorrect values.

**Example:** If slot 5 contains `bool isActive` (1 byte) + `uint8 decimals` (1 byte) + `address token` (20 bytes), the 32-byte value encodes all three right-to-left: `token` in bytes 0-19, `decimals` in byte 20, `isActive` in byte 21 (counting from the right).

---

## Proxy Inspection `[CORE]`

### EIP-1967 Slot Reads

Read standardized storage slots via `eth_getStorageAt` to identify proxy patterns:

| Slot | Purpose | Derivation |
|------|---------|------------|
| `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` | Implementation address | `keccak256("eip1967.proxy.implementation") - 1` |
| `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` | Beacon address | `keccak256("eip1967.proxy.beacon") - 1` |
| `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103` | Admin address | `keccak256("eip1967.proxy.admin") - 1` |

A non-zero value in any of these slots confirms the contract is a proxy.

### Follow the Implementation Chain

1. Read the implementation slot. Non-zero = Transparent or UUPS proxy. The value is the implementation contract address.
2. Read the beacon slot. Non-zero = Beacon proxy. Call `implementation()` on the beacon address via `eth_call` to get the current implementation.
3. **Check if the implementation is itself a proxy.** Read EIP-1967 slots on the implementation address. If non-zero, follow the chain again. Repeat until you reach a non-proxy contract. This chain-following is essential — some architectures use proxy-to-proxy delegation.
4. If all EIP-1967 slots are zero, proceed to bytecode-level checks (EIP-1167 minimal proxy pattern, Diamond proxy loupe functions).

### Upgrade History Reconstruction

Two methods to reconstruct the history of proxy upgrades:

- **`Upgraded(address indexed implementation)` events** — query `eth_getLogs` on the proxy address for topic `0xbc7cd75a20ee27fd9adebab32041f755214dbc6568d3fec6d15a2eaa6e8d69e1` (`keccak256("Upgraded(address)")`). Each event records an implementation change with block timestamp.
- **Admin contract logs** — for proxies managed by a ProxyAdmin contract, query `AdminChanged` and `BeaconUpgraded` events on the proxy, and any governance execution events on the admin contract.

Sort events chronologically to reconstruct the full upgrade timeline. Cross-reference with storage layout changes — an upgrade that changes the storage layout without proper migration is a critical finding.

### Diamond Pattern (EIP-2535)

Diamond proxies route different function selectors to different implementation contracts (facets). Full enumeration requires:

1. **Loupe functions** — call via `eth_call`:
   - `facets()` — returns all facet addresses and their selectors
   - `facetAddresses()` — returns all facet addresses
   - `facetFunctionSelectors(address facet)` — returns selectors routed to a specific facet
   - `facetAddress(bytes4 selector)` — returns which facet handles a specific selector

2. **DiamondCut event history** — query `eth_getLogs` for:
   ```
   event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata)
   ```
   Each event records additions, replacements, or removals of facet/selector mappings. Reconstruct the full history of selector routing changes.

3. **Selector mapping reconstruction** — combine current loupe state with historical DiamondCut events to build a complete picture: which selectors are routed where now, and how that routing has changed over time.

For Diamond proxies, you need the ABI of **each individual facet**, not just one implementation contract. Enumerate all facets and resolve ABIs for each separately.

---

## Trace Analysis: Fund Flow `[TRACE]`

Use `debug_traceTransaction` with the `callTracer` and `withLog: true` to capture the complete call tree of a transaction:

```json
{
  "method": "debug_traceTransaction",
  "params": [
    "0xTransactionHash",
    {
      "tracer": "callTracer",
      "tracerConfig": { "withLog": true }
    }
  ]
}
```

### Call Tree Structure

The tracer returns a nested tree of call frames. Each frame contains:

| Field | Description |
|-------|-------------|
| `type` | Call type: `CALL`, `STATICCALL`, `DELEGATECALL`, `CREATE`, `CREATE2`, `SELFDESTRUCT` |
| `from` | Caller address |
| `to` | Callee address (or created contract address for CREATE/CREATE2) |
| `value` | ETH value transferred (hex) — `0x0` for non-value calls |
| `gas` | Gas provided to this frame |
| `gasUsed` | Gas actually consumed |
| `input` | Calldata (function selector + encoded arguments) |
| `output` | Return data |
| `error` | Error string if the frame reverted |
| `revertReason` | Decoded revert reason (if available) |
| `calls` | Array of nested child call frames (recursive) |
| `logs` | Event logs emitted within this specific frame (when `withLog: true`) |

### Key Analysis Principles

- **Reverted frames are visible** and often more revealing than successful ones. A reverted internal call shows what the contract *tried* to do — failed liquidity checks, insufficient balances, access control rejections. Always examine reverted frames.
- **`DELEGATECALL` frames** execute the callee's code in the caller's storage context. The `from` address is the proxy, `to` is the implementation, but all storage reads/writes affect the proxy's state. Follow the full delegatecall chain to identify the actual logic being executed.
- **`STATICCALL` frames** are read-only calls that cannot modify state. They indicate view/pure function calls used for price lookups, balance checks, or permission verification.
- **`CREATE`/`CREATE2` frames** show new contract deployments within the transaction. The `to` field contains the newly deployed contract address.
- **`withLog: true`** attaches event logs to the specific call frame that emitted them, rather than flattening all logs into a single list. This is critical for attributing events to the correct contract in a multi-contract call chain.

---

## Trace Analysis: State Diff `[TRACE]`

Use `debug_traceTransaction` with the `prestateTracer` and `diffMode: true` to see exactly what changed in a transaction:

```json
{
  "method": "debug_traceTransaction",
  "params": [
    "0xTransactionHash",
    {
      "tracer": "prestateTracer",
      "tracerConfig": { "diffMode": true }
    }
  ]
}
```

### Response Structure

Returns `{ pre, post }` objects:

| Object | Contents |
|--------|----------|
| `pre` | All touched accounts **before** the transaction executed. Fields: `balance`, `nonce`, `code`, `storage` (map of slot → value). Includes every account that was read or written during execution. |
| `post` | Only **modified** fields after the transaction. Accounts and fields that were read but not changed are omitted from `post`. |

### Interpreting Diffs

| Pattern | Meaning |
|---------|---------|
| Key in `pre` but not in `post` | **Deletion** — value was zeroed or account was removed |
| Key in `post` but not in `pre` | **Insertion** — new value created (new storage slot written, new account touched) |
| Key in both with different values | **Modification** — value changed |
| Key in `pre` only (same as post) | **Read-only access** — touched but not modified |

### Analytical Applications

- **Exploit analysis** — see exactly which storage slots the attacker read and modified, across all contracts involved. The diff reveals the precise mechanism of the exploit without needing to trace the execution step-by-step.
- **Upgrade impact assessment** — trace a transaction before and after a proxy upgrade to compare state diffs. Identify any storage slots that are accessed differently under the new implementation.
- **"What exactly changed?"** — the definitive answer. When a complex transaction touches dozens of contracts, the state diff cuts through the noise and shows only the net effect.
- **Gas optimization analysis** — storage slots that appear in `pre` but not `post` (read but not written) reveal unnecessary `SLOAD` operations or redundant state checks.

---

## State Override Hypothesis Testing `[TRACE]`

`eth_call` accepts optional third and fourth parameters for overriding state and block context during simulation:

```
eth_call(txObject, blockTag, stateOverride, blockOverride)
```

### State Override (3rd Parameter)

The state override is a map of address to override object. Each override can modify:

| Field | Type | Effect |
|-------|------|--------|
| `balance` | hex wei | Set the account's ETH balance |
| `nonce` | hex | Set the account's nonce |
| `code` | hex bytecode | Inject arbitrary bytecode at the address |
| `state` | `{slot: value}` | **REPLACE ALL storage.** Unlisted slots become zero. |
| `stateDiff` | `{slot: value}` | **PATCH specific slots.** Unlisted slots are preserved. |

**CRITICAL DISTINCTION:**

- `state` **wipes everything** — every storage slot not explicitly listed in the override is set to zero. This is a full storage replacement. Use only when you want a clean-slate simulation.
- `stateDiff` **merges** — only the listed slots are overwritten; all other slots retain their on-chain values. This is what you want for "what-if" scenarios where you change one variable and observe the effect.
- **Never use both `state` and `stateDiff` on the same address.** The behavior is undefined or provider-dependent. Pick one.

### Block Override (4th Parameter)

Override block context variables for the simulated call:

| Field | Type | Effect |
|-------|------|--------|
| `number` | hex | Override `block.number` |
| `time` | hex | Override `block.timestamp` |
| `gasLimit` | hex | Override `block.gaslimit` |
| `feeRecipient` | address | Override `block.coinbase` |
| `prevRandao` | hex | Override `block.prevrandao` |
| `baseFeePerGas` | hex | Override `block.basefee` |
| `blobBaseFee` | hex | Override blob base fee (EIP-4844) |

Block overrides are useful for simulating time-dependent logic (vesting unlocks, timelock expirations, oracle staleness checks) without waiting for the actual block.

### Example: "What if this address had 10M USDT?"

To simulate a protocol call as if a target address held 10M USDT, override the USDT contract's storage at the `balanceOf` mapping slot for that address:

```json
{
  "method": "eth_call",
  "params": [
    {"to": "0xProtocol", "data": "0x..."},
    "latest",
    {
      "0xdAC17F958D2ee523a2206206994597C13D831ec7": {
        "stateDiff": {
          "<keccak256(pad32(targetAddress) ++ pad32(balanceOfSlot))>": "0x00000000000000000000000000000000000000000000000000000009502F9000"
        }
      }
    }
  ]
}
```

Steps to construct:
1. Determine the `balanceOf` mapping slot number in the USDT contract's storage layout (slot 2 for USDT).
2. Compute the storage key: `keccak256(pad32(targetAddress) ++ pad32(0x02))`.
3. Encode 10,000,000 * 10^6 (USDT has 6 decimals) = `0x9502F9000` as a 32-byte hex value.
4. Place in `stateDiff` to patch only this slot, preserving all other USDT state.

### Practical Applications

- **Liquidation simulation** — override a borrower's collateral balance or an oracle price feed slot to test whether a position becomes liquidatable under hypothetical conditions.
- **Governance simulation** — override a voting token's balance to simulate whether a proposal would pass with different vote distributions.
- **Access control testing** — override `msg.sender`-derived storage (owner slot, role mapping) to simulate calls from privileged addresses.
- **Time-dependent logic** — use block override to advance `block.timestamp` past a timelock or vesting cliff without waiting.

---

## Bytecode Analysis `[CORE]`

### EOA vs Contract Detection

```
eth_getCode(address, blockTag)
```

- Returns `0x` (empty) — the address is an Externally Owned Account (EOA) or a self-destructed contract.
- Returns non-empty hex — the address holds deployed bytecode (is a contract).

This is the first check in any address classification workflow. Many analytics queries only make sense for contracts (storage reads, proxy detection) or only for EOAs (nonce-based activity tracking).

### EIP-1167 Minimal Proxy Detection

Minimal proxies (clones) have a fixed bytecode pattern:

```
363d3d373d3d3d363d73<20-byte-implementation-address>5af43d82803e903d91602b57fd5bf3
```

Match the prefix `363d3d373d3d3d363d73` in the bytecode returned by `eth_getCode`. If matched, extract the 20-byte implementation address directly from the bytecode at the fixed offset (bytes 10-29). No storage reads needed — the implementation is hardcoded into the bytecode.

This pattern is extremely common in DeFi: Uniswap V2 pairs, Gnosis Safe proxies, and many factory-deployed contracts use EIP-1167 clones.

### Function Selector Extraction

When no ABI is available (unverified contract), extract function selectors from deployed bytecode:

1. Fetch bytecode via `eth_getCode(address, blockTag)`.
2. Scan for `PUSH4` opcodes (`0x63`). In the dispatcher section of compiled Solidity contracts, each external function's 4-byte selector appears as a `PUSH4` argument compared against `msg.sig`.
3. Extract the 4 bytes following each `0x63` opcode as candidate selectors.
4. Match candidates against signature databases (4byte.directory, OpenChain) to recover function names and parameter types.

This yields a partial ABI: function names and parameter types, but not return types, state mutability, or documentation. Sufficient for identifying contract capabilities and constructing basic `eth_call` requests.

**Limitations:** Non-Solidity contracts (Vyper, Huff, hand-written assembly) may not follow the standard dispatcher pattern. Proxy contracts show only the proxy's own selectors (typically just `fallback`), not the implementation's.

---

## Access List Prediction `[CORE]`

```
eth_createAccessList(txObject, blockTag)
```

Returns an access list predicting which addresses and storage slots a call will read or write during execution. The response includes:

```json
{
  "accessList": [
    {
      "address": "0xContractA",
      "storageKeys": ["0xSlot1", "0xSlot2"]
    },
    {
      "address": "0xContractB",
      "storageKeys": ["0xSlot3"]
    }
  ],
  "gasUsed": "0x..."
}
```

### Analytical Applications

- **Dependency mapping** — before diving into traces or storage reads, use access list prediction to understand which contracts and storage slots a transaction touches. This provides a quick overview of the transaction's scope.
- **Storage slot discovery** — when you don't know a contract's storage layout, the access list reveals which slots are actually read during a specific operation. Combine with known layout patterns to identify what data the contract accesses.
- **Gas estimation refinement** — EIP-2930 access lists reduce cold storage access costs. Comparing gas with and without the predicted access list shows how much a transaction benefits from pre-warming.
- **Pre-analysis scoping** — run `eth_createAccessList` before committing to a full trace. If the access list is small, the transaction is straightforward. If it touches dozens of contracts and hundreds of slots, prepare for complex multi-contract analysis.

---

## Pitfall Pack

*Run through this checklist before presenting contract inspection results.*

- [ ] **Proxy `upgradeTo` history fully traced?** Reconstruct the complete timeline of implementation changes via `Upgraded` events. Current implementation alone is insufficient — past implementations reveal what logic was active at historical block heights.
- [ ] **Storage slot layout matches current implementation version (not stale)?** After a proxy upgrade, the storage layout may change. Verify that you are using the layout from the **current** implementation, not a cached or previously fetched layout. A layout mismatch produces silently incorrect decoded values.
- [ ] **`delegatecall` chain fully unwound to final logic?** Follow every `delegatecall` hop from proxy through any intermediate proxies to the final implementation. A proxy delegating to another proxy is common in modular architectures (e.g., a beacon proxy pointing to an upgradeable beacon implementation).
- [ ] **If Diamond: all facets enumerated via loupe + DiamondCut history?** A Diamond's current loupe state shows the live selector-to-facet mapping, but DiamondCut event history reveals removed facets, replaced selectors, and the evolution of the contract's capabilities over time. Both are needed for a complete picture.
- [ ] **Anonymous events accounted for?** If the contract emits anonymous events, standard topic-based filtering will miss them or misidentify them. Verify against the contract source whether anonymous events exist.
- [ ] **Packed storage slots correctly decomposed?** When multiple variables share a slot, extracting a single value requires bitmasking at the correct offset. Verify the packing layout against the exact variable declarations and inheritance order.
- [ ] **Constants and immutables not searched in storage?** These values are embedded in bytecode, not storage. `eth_getStorageAt` will return zero or unrelated data for the slot where you might expect them. Read them via `eth_call` to the getter function or extract from bytecode.
- [ ] **State override using `stateDiff` not `state` unless full wipe intended?** Accidental use of `state` instead of `stateDiff` zeros out all unlisted storage slots, producing simulation results that bear no resemblance to reality.
