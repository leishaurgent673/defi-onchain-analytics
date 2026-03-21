# Protocol Analytics

**Minimum tier:** A (CORE) for current state reads. B (ARCHIVE) for historical TVL time series via `eth_getBalance`/`eth_call` at past block numbers.

---

## TVL Decomposition

Three levels of TVL measurement, from least to most accurate:

### Level 1: Naive TVL (double-counts)

Sum of `balanceOf(protocolAddress)` for all deposited tokens across all protocol contracts.

This number is inflated because it counts the same capital multiple times when it flows through wrapping, lending, and re-depositing loops. Every DeFi aggregator headline number uses this. Treat it as a marketing metric, not an analytical one.

### Level 2: De-duplicated TVL

Account for three sources of double-counting:

**Wrapping chains:** A single ETH deposit can appear as WETH, stETH, and wstETH simultaneously across different protocol contracts. When tracing TVL, identify wrapping relationships and count only the root asset.

Common wrapping chains:
- ETH -> WETH -> stETH -> wstETH
- USDC -> aUSDC (Aave receipt token)
- ETH -> rETH (Rocket Pool)

**Borrow-redeposit loops:** A user deposits ETH into a lending protocol, borrows USDC against it, then deposits that USDC into another protocol (or the same one). The naive sum counts both the ETH collateral and the borrowed USDC as TVL, but the USDC is a liability backed by the ETH. Detecting this requires tracing fund flows: if a borrow event from protocol A is followed by a deposit into protocol B within the same transaction or a short block window, flag it as a loop.

**Leveraged positions:** A user deposits 1 ETH, borrows 0.75 ETH equivalent, re-deposits, borrows again -- creating 2-3x the apparent TVL from a single unit of capital. These show up as repeated deposit/borrow cycles from the same address within the same protocol.

### Level 3: Redeemable TVL

What users could actually withdraw right now. This is the only number that matters for risk assessment.

For ERC-4626 vaults, read `totalAssets()` -- NOT `balanceOf(vault)`. The `totalAssets()` function returns the total amount of underlying tokens managed by the vault, accounting for deployed capital, accrued yield, and losses. The `balanceOf(vault)` only shows idle tokens sitting in the vault contract itself, missing everything deployed into strategies.

For lending protocols, redeemable TVL = total deposits minus total borrows (available liquidity). Read the pool's available liquidity directly rather than computing it, where the protocol exposes this.

---

## ERC-4626 Vault Analytics

### Key Read Pattern

```
totalAssets()          -> true underlying value held/managed by the vault
convertToAssets(1e18)  -> share price for display purposes (excludes fees)
previewRedeem(1e18)    -> actual redemption value a user would receive (includes fees)
```

The difference between `convertToAssets(1e18)` and `previewRedeem(1e18)` represents the combined impact of withdrawal fees, slippage, and any other deductions applied at redemption time. If these two values are equal, the vault charges no withdrawal fee. If `previewRedeem` is significantly lower, investigate the fee structure.

### Rounding Rules (EIP-4626 Specification)

The standard mandates specific rounding directions to protect existing depositors:

| Operation | Returns | Rounds | Reasoning |
|-----------|---------|--------|-----------|
| `deposit(assets)` | shares | DOWN | Depositor receives fewer shares, protecting existing holders |
| `mint(shares)` | assets | UP | Minter pays more assets, protecting existing holders |
| `withdraw(assets)` | shares | UP | Withdrawer burns more shares, protecting remaining holders |
| `redeem(shares)` | assets | DOWN | Redeemer receives fewer assets, protecting remaining holders |

Always round against the user making the request, in favor of the vault (existing depositors). Any vault that violates these rounding directions has a non-conformant implementation.

### Inflation Attack Awareness

The first depositor to an empty ERC-4626 vault can manipulate the share price by:
1. Depositing a minimal amount (e.g., 1 wei) to receive 1 share
2. Donating a large amount of the underlying token directly to the vault via `transfer()`
3. Now 1 share is worth (1 wei + donated amount), making it impossible for small depositors to receive any shares (their deposit rounds down to 0 shares)

**Detection:** Check if the vault uses virtual shares and virtual assets (the OpenZeppelin 4.x/5.x pattern). In this pattern, the vault adds a virtual offset (typically `1`) to both total shares and total assets, making the initial share price immune to manipulation. Read the vault's `_decimalsOffset()` or check if `totalSupply()` returns a non-zero value even when no real deposits exist.

If the vault has no virtual share protection and currently has very low totalSupply (< 1000 shares), flag it as vulnerable.

---

## Risk Scoring Framework

Five dimensions for protocol risk assessment, each populated entirely from on-chain data:

| Dimension | Key Metrics | RPC Data Source |
|-----------|-------------|-----------------|
| Smart contract | Audit status, timelock duration, upgrade history, code age | Proxy admin slot reads (EIP-1967: `0x360894...` for impl, `0xb531...` for admin), `upgradeTo`/`Upgraded` events via `eth_getLogs` |
| Financial | Liquidity depth, collateralization ratio, reserve health | Pool reserve reads (`getReserves()`), vault `totalAssets()`, lending pool `getReserveData()` |
| Oracle | Provider identity, staleness threshold, deviation bounds | Oracle contract reads: `latestRoundData()` returns (roundId, answer, startedAt, updatedAt, answeredInRound). Staleness = `block.timestamp - updatedAt` |
| Governance | Token holder concentration, timelock delay, proposal threshold | Top holder balances via Multicall3, timelock `getMinDelay()`, governor `proposalThreshold()` |
| Counterparty | Whale deposit %, validator set distribution, single-entity exposure | Top N depositor balances via Multicall3 batch `balanceOf` calls, validator registry reads for LSTs |

### Scoring Each Dimension

**Smart contract risk indicators:**
- Proxy with no timelock on upgrades = critical risk (admin can rug instantly)
- Recent implementation change (< 7 days) = elevated risk
- EOA as proxy admin = higher risk than multisig, which is higher risk than timelock-gated multisig
- Read the admin address: if it is an EOA (`eth_getCode` returns `0x`), flag immediately

**Financial risk indicators:**
- Available liquidity < 10% of total deposits = potential bank run risk
- Single-asset concentration > 80% in a multi-asset pool = imbalanced pool
- Collateralization ratio approaching liquidation threshold = systemic risk

**Oracle risk indicators:**
- `updatedAt` older than the oracle's stated heartbeat = stale price
- `answeredInRound < roundId` = oracle round was not answered, using carried-forward price
- Single oracle source with no fallback = single point of failure

**Governance risk indicators:**
- Top 5 token holders control > 50% of voting power = centralization risk
- Timelock delay < 24 hours = insufficient reaction time for users to exit
- No active governance proposals in 90+ days with pending parameter changes = governance apathy

**Counterparty risk indicators:**
- Single address holds > 25% of pool/vault deposits = whale concentration risk
- For LSTs: fewer than 5 node operators = validator centralization

---

## Yield Analysis

### APR to APY Conversion

```
APY = (1 + APR / n)^n - 1
```

Where `n` is the compounding frequency per year. For protocols that auto-compound per block (e.g., Aave):
- Ethereum: ~2,628,000 blocks/year (12s blocks)
- Arbitrum/Optimism: varies, use actual block time

For manual compounding, `n` depends on user behavior (typically daily = 365, weekly = 52).

### Net Yield Calculation

Raw APY alone is misleading. Compute net yield by subtracting all costs:

**Gas cost accounting:**
- Entry gas: deposit/approve transaction cost
- Exit gas: withdrawal transaction cost
- Periodic gas: claim + restake transactions if manual compounding
- Annualize: `annual_gas_cost = (entry_gas + exit_gas) / holding_period_years + periodic_gas * frequency`
- Express as drag on principal: `gas_drag_pct = annual_gas_cost / principal * 100`

**Slippage cost:**
- For entry: price impact of swapping into the deposit token
- For exit: price impact of redeeming and swapping out
- For rebalancing: any intermediate swaps during auto-compound

**Impermanent loss integration (for LP positions):**
- IL is path-dependent, but for reporting compute IL at current prices vs entry prices
- `IL = 2 * sqrt(price_ratio) / (1 + price_ratio) - 1` where `price_ratio = current_price / entry_price`
- Net LP yield = fee APY + reward APY + IL (IL is negative when prices diverge)

### Shares-Based vs Balance-Based Accounting

**Non-rebasing tokens (most ERC-4626 vaults, Aave aTokens V3 scaled balance):**
Track share count. Yield = change in `convertToAssets(shares)` over time. The share count stays constant; the asset-per-share ratio grows.

**Rebasing tokens (stETH, Aave aTokens V2, OHM):**
Balance changes without any Transfer events. Do NOT rely on Transfer event history to compute yield. Instead:
- Snapshot `balanceOf(address)` at two different block heights
- Yield = `(balance_t1 - balance_t0) / balance_t0`
- For stETH specifically: use wstETH (non-rebasing wrapper) for simpler accounting

---

## Uniswap V3/V4 Pool State Reading

### Uniswap V3: Direct Pool Contract

Each V3 pool is a standalone contract. Read `slot0()` for current state:

```
slot0() returns (
    uint160 sqrtPriceX96,          // current sqrt(price) in Q64.96 format
    int24   tick,                   // current tick (derived from sqrtPriceX96)
    uint16  observationIndex,       // index of last written oracle observation
    uint16  observationCardinality, // current max number of oracle observations
    uint16  observationCardinalityNext, // next max (grows when expanded)
    uint8   feeProtocol,           // protocol fee as % of LP fee (0 or 1/N)
    bool    unlocked               // reentrancy lock (true = not locked)
)
```

Additional key reads:
- `liquidity()` -> current in-range liquidity (uint128)
- `fee()` -> pool fee tier in hundredths of a bip (500 = 0.05%, 3000 = 0.30%, 10000 = 1.00%)
- `ticks(int24 tick)` -> per-tick state including `liquidityNet` (int128)
- `positions(bytes32 key)` -> per-position liquidity and fee accounting

### Uniswap V4: Singleton PoolManager via StateLibrary

V4 uses a single `PoolManager` contract for all pools. Pool state is internal storage accessed via the `StateLibrary` helper:

```
slot0 contains 4 fields only:
    uint160 sqrtPriceX96     // current price
    int24   tick              // current tick
    uint24  protocolFee       // protocol fee setting
    uint24  lpFee             // LP fee (can be dynamic in V4)
```

V4 removed the oracle observation fields (protocols use external oracles or hooks) and the reentrancy lock (replaced by transient storage lock). The `lpFee` field replaces the fixed fee tier -- V4 pools can have dynamic fees managed by hooks.

Read V4 pool state via `StateLibrary.getSlot0(poolManager, poolId)` where `poolId = keccak256(abi.encode(PoolKey))`.

### CRITICAL: In-Range vs Total Liquidity

`liquidity()` (V3) or `StateLibrary.getLiquidity()` (V4) returns ONLY the liquidity that is active at the current tick. This is NOT total pool liquidity.

Liquidity providers can set arbitrary tick ranges. Only positions whose range includes the current tick contribute to the reported `liquidity()` value. Positions out of range (current price outside their tick bounds) are not counted.

**To compute total pool liquidity:**
1. Query all `Mint` and `Burn` events for the pool
2. Build a tick-indexed liquidity map: for each initialized tick, sum `liquidityNet` values
3. Walk ticks from MIN_TICK to MAX_TICK, accumulating `liquidityNet` to reconstruct the full liquidity distribution
4. Total = sum of all position liquidity values (or equivalently, the area under the liquidity curve)

This is expensive. For a rough approximation, scan the ticks immediately surrounding the current tick (e.g., +/- 10 tick spacings) to estimate concentrated liquidity nearby.

---

## Lending Protocol State

### Generic Approach (Aave V3 / Compound V3 / Similar)

Lending protocols expose view functions for all critical state. No events or historical data needed for current state.

**Utilization rate:**
```
utilization = totalBorrows / totalSupply
```
- Aave V3: `getReserveData(asset)` returns `currentLiquidityRate`, `currentVariableBorrowRate`, plus the aToken/debtToken addresses. Read `totalSupply()` on the aToken for total deposits and `totalSupply()` on the variableDebtToken for total variable borrows.
- Compound V3 (Comet): `totalSupply()` for total base supply, `totalBorrow()` for total borrows, `getUtilization()` for utilization directly.

**Interest rate reading:**
- Aave V3: `currentLiquidityRate` and `currentVariableBorrowRate` are ray-denominated (1e27 = 100%). These are annualized rates. Convert: `APR = rate / 1e27 * 100`.
- Compound V3: `getSupplyRate(utilization)` and `getBorrowRate(utilization)` return per-second rates. Annualize: `APR = rate * seconds_per_year` where `seconds_per_year = 31_536_000`.

**Liquidation threshold configuration:**
- Aave V3: `getReserveConfigurationData(asset)` returns LTV, liquidation threshold, liquidation bonus, and other params packed into a bitmap. The `DataTypes.ReserveConfigurationMap` uses bit positions:
  - Bits 0-15: LTV (max borrow power in bps, e.g., 8000 = 80%)
  - Bits 16-31: liquidation threshold (bps, e.g., 8250 = 82.5%)
  - Bits 32-47: liquidation bonus (bps, e.g., 10500 = 105% meaning 5% bonus)
- Compound V3: `getAssetInfo(i)` returns per-asset `borrowCollateralFactor`, `liquidateCollateralFactor`, and `liquidationFactor`.

**User health factor (Aave V3):**
```
getUserAccountData(address) returns (
    totalCollateralBase,    // total collateral in base currency (USD, 8 decimals)
    totalDebtBase,          // total debt in base currency
    availableBorrowsBase,   // remaining borrow capacity
    currentLiquidationThreshold,  // weighted-average liquidation threshold
    ltv,                    // weighted-average LTV
    healthFactor            // 1e18 scale; < 1e18 = liquidatable
)
```

All of these are `view` functions callable via `eth_call` at any block height. No state modification. No gas cost. Batch with Multicall3 for efficiency when reading multiple reserves or users.

---

## Pitfall Pack

Pre-flight checklist before presenting any protocol analytics. Every unchecked item is a potential misrepresentation:

- [ ] TVL de-duplicated? Wrapping chains, borrow-redeposit loops, and leveraged positions all inflate the naive sum. If presenting a single TVL number, state which level (naive/de-duplicated/redeemable) and why.
- [ ] Using redeemable underlying not total deposited? For vaults, `totalAssets()` not `balanceOf(vault)`. For lending pools, available liquidity not gross deposits. The gap between deposited and redeemable is the protocol's deployment/utilization.
- [ ] Oracle dependencies identified and checked for staleness? Every protocol that uses price feeds has oracle risk. Read `latestRoundData()` and verify `updatedAt` is within the heartbeat window. Check `answeredInRound >= roundId`.
- [ ] Admin key risk assessed (EOA vs multisig vs timelock)? Read the proxy admin address. Check if it is an EOA (`eth_getCode` returns `0x`), a multisig (e.g., Gnosis Safe -- check `getOwners()`), or a timelock contract (check `getMinDelay()`). An EOA admin on a proxy = the protocol can be changed instantly by one person.
- [ ] Upgrade history checked for recent implementation changes? Scan for `Upgraded(address indexed implementation)` events (topic0: `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b`). Any implementation change in the last 7 days warrants deeper inspection of what changed.
