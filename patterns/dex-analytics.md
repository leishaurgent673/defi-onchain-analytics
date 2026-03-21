# DEX Analytics

**Minimum tier:** A (CORE) for all analysis.

---

## Uniswap V3 Math

### Price from sqrtPriceX96

```
sqrtPrice = sqrtPriceX96 / 2^96
price     = sqrtPrice^2 = sqrtPriceX96^2 / 2^192
```

### Human-readable price (with decimal adjustment)

```
price_human = price_raw / 10^(decimals_token1 - decimals_token0)
```

### Tick-price relationship

```
price = 1.0001^tick
tick  = floor(log(price) / log(1.0001))
```

> **NOTE:** Always prefer `sqrtPriceX96` over ticks for precision — ticks lose information due to `floor()`.

### Tick spacing by fee tier

| Fee   | Tick Spacing | bps   |
|-------|-------------|-------|
| 1%    | 200         | 10000 |
| 0.3%  | 60          | 3000  |
| 0.05% | 10          | 500   |
| 0.01% | 1           | 100   |

### Liquidity formula

```
L = amount0 / (1/sqrt(P_lower) - 1/sqrt(P_upper))
L = amount1 / (sqrt(P_upper) - sqrt(P_lower))
```

### Impermanent loss

```
IL = 2*sqrt(r)/(1+r) - 1   where r = new_price / old_price
```

### Q-notation (fixed-point representations)

- `X96` = divide by 2^96
- `X128` = divide by 2^128

---

## Swap Volume Analytics `[CORE]`

**Primary data source:** `Swap` events emitted by Uniswap V3 pool contracts.

- `amount0` / `amount1` are **signed** integers (negative = outflow from pool to swapper).
- Post-swap state is included in each event: `sqrtPriceX96`, `liquidity`, `tick`.
- Volume = absolute value of token amounts. Convert to USD using the pool's price or an external oracle at the block timestamp.

---

## MEV Noise Filtering

Flag swaps matching any of these criteria and consider excluding them from organic volume metrics:

- **Atomic arbitrage:** Same address executes buy and sell of the same pair within the same block.
- **Sandwich attack:** Transaction index is adjacent to a large swap (the tx immediately before and after a victim swap from the same sender).
- **Known builder/relayer:** `tx.from` matches a known MEV builder or relay address (e.g., Flashbots Builder, bloXroute).
- **JIT liquidity:** `Mint` + `Burn` events in the same block, bracketing a `Swap` event in the same pool. The liquidity provider adds concentrated liquidity just before the swap and removes it immediately after, capturing fees without sustained exposure.

---

## LP Position Analytics `[CORE]`

### 3-step position enumeration via NonfungiblePositionManager

1. **`balanceOf(address)`** — Returns the count of LP NFTs owned by the address.
2. **`tokenOfOwnerByIndex(address, i)`** — Returns the token ID for the i-th NFT (0-indexed, iterate from 0 to count-1).
3. **`positions(tokenId)`** — Returns 12 fields describing the full position:

| Field | Type | Description |
|-------|------|-------------|
| nonce | uint96 | Position nonce for permit |
| operator | address | Approved operator for this NFT |
| token0 | address | Token0 of the pool |
| token1 | address | Token1 of the pool |
| fee | uint24 | Fee tier (500, 3000, 10000, 100) |
| tickLower | int24 | Lower tick boundary |
| tickUpper | int24 | Upper tick boundary |
| liquidity | uint128 | Active liquidity in the position |
| feeGrowthInside0LastX128 | uint256 | Fee growth of token0 inside the tick range as of last action |
| feeGrowthInside1LastX128 | uint256 | Fee growth of token1 inside the tick range as of last action |
| tokensOwed0 | uint128 | Uncollected token0 fees owed |
| tokensOwed1 | uint128 | Uncollected token1 fees owed |

### Uncollected fee formula

```
uncollectedFees = (feeGrowthGlobal - feeGrowthOutside_above - feeGrowthOutside_below - feeGrowthInsideLast) * liquidity / 2^128
```

Where:
- `feeGrowthGlobal` is read from the pool contract (`feeGrowthGlobal0X128` or `feeGrowthGlobal1X128`).
- `feeGrowthOutside_above` comes from `ticks(tickUpper).feeGrowthOutside0X128`.
- `feeGrowthOutside_below` comes from `ticks(tickLower).feeGrowthOutside0X128`.
- `feeGrowthInsideLast` is the position's `feeGrowthInside0LastX128` (or the token1 variant).
- The "outside" values must be flipped depending on whether the current tick is above or below the tick boundary (the pool contract handles this internally, but when reconstructing off-chain you must apply the same logic).

---

## Position Owner Resolution `[CORE]`

When liquidity is added via a NonfungiblePositionManager (NPM), the pool's `Mint` event shows `owner = NPM contract address`, NOT the actual LP wallet. Resolving the real LP requires tracing through the NPM layer.

### Resolution hierarchy

| Method | Data Source | Resolves To | Accuracy |
|--------|-----------|-------------|----------|
| `NPM.ownerOf(tokenId)` | `eth_call` at current block | Current NFT holder | High — but may be a staking contract, not an EOA |
| ERC-721 `Transfer(address(0), to, tokenId)` | `eth_getLogs` on NPM contract | Original minter / first owner | High — captures creation-time owner |
| `tx.from` of the mint transaction | `eth_getTransactionByHash` | Initiating wallet (EOA) | Moderate — may be a router or aggregator |

### Step-by-step resolution flow

**Step 1 — From pool `Mint` event, extract `tokenId`:**

In the same transaction as the pool `Mint` event, the NPM emits:
- `IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)` — gives the `tokenId`
- For new positions: also emits ERC-721 `Transfer(address(0), to, tokenId)` — the `to` field is the initial owner

Match events by transaction hash to link pool `Mint` → NPM `IncreaseLiquidity` → ERC-721 `Transfer`.

**Step 2 — Resolve current owner:**

Call `NPM.ownerOf(tokenId)` via `eth_call`. Then classify the result:
- If `eth_getCode(owner)` returns `0x` → **EOA**, this is the LP wallet. Done.
- If `eth_getCode(owner)` returns bytecode → **contract owner**, proceed to Step 3.

**Step 3 — Handle contract owners:**

| Owner Type | Detection | Resolution Path |
|-----------|-----------|-----------------|
| **Staking / farming contract** | Known protocol addresses (Uniswap V3 Staker `0x1f98407aaB862CdDeF78Ed252D6f557aA5b0f00d`, Algebra FarmingCenter) | Query staking events: `DepositTransferred(tokenId, oldOwner, newOwner)` or contract-specific `deposits(tokenId)` mapping |
| **Smart wallet (Gnosis Safe)** | Bytecode matches Safe proxy pattern (EIP-1167 clone of Safe singleton) | The Safe's owners are the real controllers — query `getOwners()` on the Safe |
| **Vault / aggregator** (Arrakis, Gamma, Mellow) | Known manager contract addresses per chain | Vault manages positions on behalf of depositors — LP attribution requires vault-specific share tracking via `Deposit`/`Withdraw` events |
| **DEX aggregator** (1inch, Paraswap) | Known router addresses | Usually transfers NFT to user in the same tx — check subsequent ERC-721 `Transfer` events within the same transaction |

**Step 4 — Historical owner tracking (for lifecycle analysis):**

Index ALL `Transfer(from, to, tokenId)` events on the NPM contract to build a complete ownership chain:
```
mint (from=0x0) → owner1 → staking_contract → owner1 → owner2 → burn (to=0x0)
```
Each transfer changes who can collect fees and withdraw liquidity. When reconstructing historical LP behavior, use the owner at the time of each action, not the current owner.

### Batch resolution for pool-level LP analysis

When enumerating all LPs in a pool:
1. Scan all `Mint` events for the pool address to get all position-creating transactions
2. Extract `tokenId` from corresponding `IncreaseLiquidity` events (same tx hash)
3. Batch `ownerOf(tokenId)` calls via Multicall3
4. Filter: only positions with `liquidity > 0` (skip burned/empty positions)
5. Classify contract owners per the hierarchy above
6. Aggregate: group positions by resolved owner to compute per-entity liquidity totals

> **Edge case — dead positions:** Positions with `liquidity = 0` but non-zero `tokensOwed0/1` still have uncollected fees. Include these if analyzing total economic exposure, exclude if analyzing active liquidity only.

---

## Quoting / Price Impact `[CORE]`

### Quoter contract via eth_call

The Quoter contract is designed to be called via `eth_call` (the callStatic pattern). It intentionally reverts after computing the quote, so it must never be called as an on-chain transaction.

```
quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96=0) → amountOut
```

### Price impact calculation

```
price_impact = 1 - (amountOut / amountIn * market_price)
```

Where `market_price` is the current spot price of tokenOut denominated in tokenIn.

**NEVER call Quoter on-chain** — it is extremely gas-expensive and will revert. Always simulate via `eth_call`.

### Multi-hop path encoding

Tokens and fees are packed as a contiguous byte sequence:

```
[tokenA, fee_AB, tokenB, fee_BC, tokenC]
```

Each token address is 20 bytes, each fee is 3 bytes (uint24). The Quoter's `quoteExactInput(path, amountIn)` decodes this to route through each hop sequentially.

---

## Tick Discovery via Bitmap

To find all initialized ticks for a given pool (required for liquidity depth analysis):

1. **Compute word range:**
   ```
   word = floor(tick / tickSpacing) >> 8
   ```
   Determine `minWord` and `maxWord` covering the price range of interest (or the full int24 range for a complete scan).

2. **Iterate bitmap words** from `minWord` to `maxWord`:
   Call `tickBitmap(wordPosition)` for each word. Each word is a `uint256` where each bit represents whether a tick at that relative index is initialized.

3. **Decode set bits:** For each set bit in a bitmap word:
   ```
   tickIndex = (wordPosition * 256 + bitIndex) * tickSpacing
   ```

4. **Batch reads via Multicall3:** Aggregate all `tickBitmap()` calls and subsequent `ticks(tickIndex)` calls into Multicall3 batches to minimize RPC round-trips. A full scan of a 0.3% fee pool (tickSpacing=60) requires at most ~140 bitmap words.

---

## Liquidity Depth Analysis

After discovering all initialized ticks via the bitmap:

1. **Scan all initialized ticks** in ascending order. Each initialized tick stores `liquidityNet` (the net change in active liquidity when the tick is crossed left-to-right).
2. **Compute cumulative liquidity** by starting from the lowest initialized tick and adding `liquidityNet` at each tick crossing. This yields the active liquidity at every price level.
3. **Distinguish liquidity types:**
   - **Active liquidity** — Liquidity currently within the pool's tick range (between `tickLower` and `tickUpper` of positions that bracket the current tick). This liquidity is earning fees and participating in swaps.
   - **Virtual liquidity** — In V3, all liquidity is concentrated. Unlike V2's uniform distribution, V3 positions only provide liquidity within their specified tick range. Liquidity outside the current tick is "virtual" in the sense that it is not active until the price moves into range.
4. **Price impact estimation:** Use the cumulative liquidity profile to estimate how much liquidity is available at each price level. Large trades consume liquidity across multiple ticks; summing the available amounts at each tick gives the depth available before reaching a target price.

---

## Uniswap V2 Comparison

Uniswap V2 uses a simpler constant-product model without concentrated liquidity.

### Core mechanics

- **`getReserves()`** returns `(uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)`.
- **Constant product invariant:** `x * y = k` where `x` = reserve0, `y` = reserve1, `k` is constant (excluding fees).
- **Price:** `price = reserve1 / reserve0` (adjusted for decimal differences: `price_human = (reserve1 / reserve0) * 10^(decimals0 - decimals1)`).
- No ticks, no concentrated liquidity, no tick spacing. Liquidity is distributed uniformly across the entire price curve from 0 to infinity.

### Swap event signature

```
event Swap(
    address indexed sender,
    uint amount0In,
    uint amount1In,
    uint amount0Out,
    uint amount1Out,
    address indexed to
);
```

All amounts are **unsigned** (unlike V3's signed amounts). The swap direction is inferred from which `amountIn` is nonzero.

---

## Pitfall Pack

- [ ] Route splitting / multi-hop within a single transaction properly attributed? A single user tx may execute multiple swaps across different pools via the Router. Each `Swap` event must be traced back to the originating tx and attributed as a single logical trade, not multiple independent volumes.
- [ ] Router proxy + implementation events not double-counted? Universal Router and SwapRouter02 emit events at the implementation level. If indexing by contract address, verify you are not counting the same swap from both the proxy address and the implementation address.
- [ ] Active liquidity vs virtual liquidity distinguished (V3)? When computing TVL or available depth, only count liquidity within the current tick range as "active." Out-of-range positions still exist but do not participate in swaps until the price moves into their range.
- [ ] MEV volume (sandwich, JIT) excluded from organic volume? Sandwich attacks inflate volume by 2-3x per victim swap. JIT liquidity does not inflate volume but skews fee distribution. Both should be flagged and optionally excluded depending on the analysis goal.
- [ ] IL formula uses correct r = new_price/old_price? The impermanent loss formula `IL = 2*sqrt(r)/(1+r) - 1` requires `r` to be the ratio of the new price to the old price. Using the inverse (old/new) produces incorrect results. The formula yields a negative number representing the percentage loss relative to holding.

---

## Automated LP / Market Maker Behavioral Signals

Heuristic signals for identifying automated liquidity provision bots vs passive LPs. **These are signals, not conclusions** — any single signal is weak evidence. Require 3+ corroborating signals before classifying an address as an automated LP.

### Signal comparison

| Feature | Passive LP | Automated LP / Market Maker |
|---------|-----------|----------------------------|
| **Position lifecycle** | Long-lived: Mint → Hold → Collect (weeks/months) | Short-lived: frequent Mint → Burn → Mint cycles (hours/days) |
| **Rebalancing frequency** | Rarely or never adjusts position | High frequency: triggered by price drift or volatility thresholds |
| **Transaction pattern** | Simple single-action txs (Mint, Collect) | Complex multicall txs: atomic Burn + Collect + Mint in one tx |
| **Position width** | Static, often wide tick ranges | Dynamic, narrow ranges concentrated around current price |
| **NFT footprint** | Few positions, long-lived tokenIds | Many tokenIds, most burned to zero liquidity ("dead NFTs") |
| **Nonce progression** | Low to moderate nonce, diverse interactions | High nonce (>1,000) with concentrated DEX-only interactions |
| **Gas strategy** | Default gas, price-insensitive | Optimized: private mempool, precise gas pricing |

### Quantitative thresholds (heuristic, calibrate per protocol)

| Signal | Threshold | Confidence |
|--------|----------|------------|
| Rebalancing events per day (Burn + Mint for same pool) | > 2 per day | High — passive LPs almost never rebalance daily |
| Position width (`tickUpper - tickLower`) | < 2× tickSpacing | Moderate — very narrow ranges suggest active management |
| Dead NFT ratio (positions with liquidity = 0) | > 50% of all positions ever held | High — indicates frequent position turnover |
| Multicall usage ratio | > 80% of txs use multicall | High — signature of programmatic interaction |
| Nonce with concentrated contract interactions | > 1,000 nonce with > 80% to DEX contracts | Moderate — consistent with bot operation |

### Known automated LP protocol footprints

| Protocol | On-Chain Signature |
|----------|--------------------|
| **Arrakis Finance** | Manager contracts interact with NPM via multicall; positions managed by vault contracts. Look for `Arrakis` in verified contract names or known factory addresses. |
| **Gamma Strategies** | Heavy NPM multicall usage with frequent rebalancing. `Hypervisor` proxy contracts manage positions. |
| **Bunni (V4)** | Uses Uniswap V4 hooks for on-chain rebalancing. Footprint is hook contract interactions rather than legacy NPM. |
| **Mellow Protocol** | Permissionless vaults with `Strategy` contracts. Complex multi-step rebalancing through external DEX interactions. |

### Verification workflow

1. **Identify candidate addresses:** Filter by high rebalancing frequency (> 2 Burn+Mint cycles/day in the same pool)
2. **Check nonce and interaction pattern:** High nonce + concentrated DEX interactions = bot candidate
3. **Examine transaction internals:** Multicall usage, atomic position adjustments, gas optimization patterns
4. **Confirm via funding trace:** Use `patterns/wallet-analytics.md` Entity Clustering — if multiple bot candidates share a common funder, confidence increases significantly
5. **Cross-reference known protocols:** Check if the address matches known Arrakis/Gamma/Mellow manager contracts

> **Confidence label convention:** Tag each identification as `[BOT: high/moderate/low confidence]` with the supporting signals listed. Never present bot classification as definitive without 3+ corroborating signals.

*References: [Milionis et al., "Automated Market Making and Loss-Versus-Rebalancing" (2023)](https://arxiv.org/abs/2305.14604); [Willetts & Harrington, "RVR: Rebalancing-versus-Rebalancing" (2024)](https://arxiv.org/abs/2410.23404)*
