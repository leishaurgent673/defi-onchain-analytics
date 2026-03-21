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
