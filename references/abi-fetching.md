# ABI Resolution & Contract Introspection

Strategies for resolving ABIs, decoding events, reading raw storage, detecting proxy patterns, and extracting selectors from bytecode when no verified source is available.

## Contents
- [Event Decoding Flow (viem)](#event-decoding-flow-viem)
- [Indexed Parameter Gotcha](#indexed-parameter-gotcha)
- [Solidity Storage Layout](#solidity-storage-layout-for-eth_getstorageat)
- [Proxy Pattern Detection](#proxy-pattern-detection-core)
- [Bytecode Selector Extraction](#bytecode-selector-extraction-core)
- [External ABI Resolution](#external-abi-resolution-enrich)

---

## Event Decoding Flow (viem)

```typescript
import { decodeEventLog } from 'viem'

const decoded = decodeEventLog({
  abi: contractAbi,
  data: log.data,       // non-indexed params
  topics: log.topics,   // indexed params
  strict: false         // essential for scanning unknown contracts
})
// => { eventName: 'Transfer', args: { from, to, value } }
```

**Key rules:**

- ABI must have `indexed: true/false` on each event parameter. Without correct indexed flags, topic/data boundaries are misaligned and decoding silently produces garbage.
- `strict: false` returns partial results on mismatch — use for defensive scanning across unknown/upgradeable contracts. When the ABI's parameter count or types don't match the actual log data, you still get whatever fields could be parsed rather than a thrown error.
- `strict: true` (default) throws `DecodeLogDataMismatch` on size mismatch. Use this when you have a known, verified ABI and want to catch data integrity issues immediately.

---

## Indexed Parameter Gotcha

- **Fixed types** (`address`, `uint256`, `bool`, `bytesN`): stored directly in the topic slot, fully recoverable by decoding.
- **Dynamic types** (`string`, `bytes`, arrays): only the `keccak256` hash is stored in the topic. **The original value is IRRECOVERABLY LOST from the log.** You can verify equality (hash the candidate value and compare) but you cannot decode the original content from the log alone.

This means: if a contract emits `event Message(string indexed content)`, the actual string is not recoverable from on-chain log data. If you need the value, it must come from calldata (via transaction trace) or off-chain indexing.

---

## Solidity Storage Layout (for `eth_getStorageAt`)

| Variable Type | Slot Location | Notes |
|--------------|--------------|-------|
| Simple (`uint`, `address`, `bool`) | Sequential from slot 0 | Pack right-aligned; multiple variables per slot if they fit within 32 bytes |
| Struct | Starts new slot | Members pack normally within the struct's allocated slots |
| Static array `T[N]` | Starts new slot | Elements packed sequentially from the starting slot |
| Dynamic array `T[]` | Slot `p` stores length; data starts at `keccak256(p)` | Elements packed sequentially from the computed slot |
| Mapping `mapping(K=>V)` | Slot `p` unused (reads as zero); value at `keccak256(h(k) . p)` | `.` = byte concatenation; `h(k)` = `pad32` for value types (`uint`, `address`), raw bytes for `string`/`bytes` |
| Nested mapping `mapping(K1=>mapping(K2=>V))` | Apply formula recursively | `keccak256(h(k2) . keccak256(h(k1) . p))` — inner key first, then outer |
| `bytes`/`string` (short, <= 31 bytes) | Data left-aligned in slot; lowest byte = `length * 2` | Single slot storage |
| `bytes`/`string` (long, >= 32 bytes) | Slot stores `length * 2 + 1`; data at `keccak256(p)` | Check lowest bit of slot value: `0` = short encoding, `1` = long encoding |
| Constants / immutables | **NOT in storage** | Inlined directly in contract bytecode; `eth_getStorageAt` will not find them |

**Inheritance:** Slots follow C3-linearized order (most base-ward first). If contract `C` inherits `B` inherits `A`, storage starts with `A`'s variables, then `B`'s, then `C`'s own. This means the same variable name at different inheritance levels occupies different slots, and reordering the inheritance list changes the entire layout.

---

## Proxy Pattern Detection `[CORE]`

Proxy detection is essential before any ABI-dependent analysis. A proxy's own ABI is just `fallback()` — the meaningful ABI belongs to the implementation contract.

### EIP-1967 Slot Reads

Read these standardized storage slots via `eth_getStorageAt`. A non-zero value indicates a proxy:

| Slot | Purpose | Value |
|------|---------|-------|
| `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` | Implementation address | `keccak256("eip1967.proxy.implementation") - 1` |
| `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` | Beacon address | `keccak256("eip1967.proxy.beacon") - 1` |
| `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103` | Admin address | `keccak256("eip1967.proxy.admin") - 1` |

**Detection flow:**

1. Read the implementation slot. Non-zero = Transparent or UUPS proxy. The value is the implementation contract address.
2. Read the beacon slot. Non-zero = Beacon proxy. Call `implementation()` on the beacon address to get the current implementation.
3. If both are zero, proceed to bytecode-level checks.

### EIP-1167 Minimal Proxy (Clone)

Match the bytecode prefix: `363d3d373d3d3d363d73`

The full minimal proxy bytecode is:
```
363d3d373d3d3d363d73<20-byte-address>5af43d82803e903d91602b57fd5bf3
```

Extract the 20-byte implementation address directly from the bytecode at a fixed offset. No storage reads needed — the implementation is hardcoded.

### Diamond Pattern (EIP-2535)

Diamond proxies route different function selectors to different implementation contracts (facets). Detection and enumeration:

1. **Loupe functions** — call via `eth_call`:
   - `facets()` — returns all facet addresses and their selectors
   - `facetAddresses()` — returns all facet addresses
   - `facetFunctionSelectors(address facet)` — returns selectors routed to a specific facet

2. **DiamondCut events** — query via `eth_getLogs` to reconstruct the full history of facet/selector changes:
   ```
   event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata)
   ```

For Diamond proxies, you need the ABI of each individual facet, not just one implementation contract. Enumerate all facets and resolve ABIs for each.

### Non-Standard Proxies

Some proxies use custom storage slots or non-standard delegation patterns. These require `[TRACE]` tier: trace a known call with `callTracer` and inspect `delegatecall` targets and selector routing to identify the implementation.

---

## Bytecode Selector Extraction `[CORE]`

When no ABI is available (unverified contract, no Etherscan source), extract function selectors directly from the deployed bytecode:

1. **Fetch bytecode:** `eth_getCode(address, blockTag)` returns the deployed bytecode as hex.

2. **Scan for PUSH4 opcodes:** The EVM opcode `0x63` is `PUSH4`, which pushes a 4-byte value onto the stack. In the dispatcher section of compiled Solidity contracts, each external function's selector appears as a `PUSH4` argument used in comparison with `msg.sig`.

3. **Extract 4-byte selectors:** For each `0x63` opcode found in the bytecode, read the next 4 bytes as a candidate function selector. Filter out obvious false positives (e.g., selectors that appear in data sections rather than the dispatcher).

4. **Match against signature databases:**
   - **4byte.directory** (`https://www.4byte.directory/api/v1/signatures/?hex_signature=0x...`) — community-maintained database mapping 4-byte selectors to function signatures
   - **OpenChain** (`https://api.openchain.xyz/signature-database/v1/lookup?function=0x...`) — alternative signature database
   - Known protocol-specific selector lists (ERC-20, ERC-721, ERC-4626, etc.)

This approach gives a partial ABI: you get function names and parameter types but not return types, state mutability, or NatSpec documentation. It is sufficient for identifying what a contract can do and for constructing basic `eth_call` requests.

**Limitations:**
- Non-Solidity contracts (Vyper, Huff, hand-written assembly) may not follow the standard dispatcher pattern.
- Selectors from internal helper constants or data sections may produce false positives.
- Proxy contracts will show only the proxy's own selectors (typically just `fallback`), not the implementation's.

---

## External ABI Resolution `[ENRICH]`

These sources require external API access beyond raw RPC. Use only when data source policy permits enrichment.

### Etherscan `getsourcecode` API

```
GET /api?module=contract&action=getsourcecode&address=0x...&apikey=KEY
```

Returns (for verified contracts):
- **Verified Solidity/Vyper source code** — the actual source files
- **ABI** — full JSON ABI including function signatures, events, errors
- **Proxy metadata** — whether the contract is a proxy, and the implementation address
- **Compiler version and settings** — exact compiler version, optimization runs, EVM target version
- **Constructor arguments** — ABI-encoded constructor parameters

For proxy contracts, Etherscan often provides the implementation ABI automatically when the proxy relationship is verified.

**Chain coverage:** Etherscan operates separate instances for Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and other chains. Each requires its own API key and base URL.

### Sourcify (Decentralized Verification)

```
GET https://sourcify.dev/server/files/any/{chainId}/{address}
```

Sourcify provides decentralized contract verification. Returns source code and metadata JSON. Two match types:
- **Full match:** bytecode matches exactly (including metadata hash)
- **Partial match:** bytecode matches but metadata differs (different compiler settings, comments, etc.)

Sourcify does not require an API key and has no rate limits for reasonable usage.

### 4byte.directory (Signature Lookup)

```
GET https://www.4byte.directory/api/v1/signatures/?hex_signature=0xa9059cbb
GET https://www.4byte.directory/api/v1/event-signatures/?hex_signature=0xddf252ad...
```

Maps 4-byte function selectors and 32-byte event topic hashes to human-readable signatures. Multiple signatures can map to the same selector (hash collisions), so results may be ambiguous — pick the most contextually plausible match.

Covers:
- **Function signatures** — `transfer(address,uint256)` from selector `0xa9059cbb`
- **Event signatures** — `Transfer(address,address,uint256)` from topic0

### Bytecode Decompilation (Manual Follow-Up)

For unverified contracts where no verified source exists anywhere:

- **Dedaub** (`https://app.dedaub.com/`) — automated decompiler producing readable pseudo-Solidity. Handles complex patterns including proxy dispatch, storage access, and control flow.
- **Heimdall** (`https://github.com/Jon-Becker/heimdall-rs`) — open-source Rust-based decompiler. Can extract function signatures, decompile to pseudo-Solidity, and decode calldata/storage.

Decompilation output is approximate — variable names are synthetic, some logic may be misrepresented, and optimizer artifacts can obscure intent. Treat decompiled output as a starting point for manual analysis, not as authoritative source.
