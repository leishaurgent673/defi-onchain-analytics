# Common DeFi ABIs — Event Signatures, Function Selectors, and Interfaces

Quick reference for on-chain analytics. All topic0 hashes are keccak256 of the canonical event signature (no spaces, no parameter names, no `indexed` keyword).

## Contents
- [ERC-20 Token Standard](#erc-20-token-standard)
- [ERC-721 Non-Fungible Token](#erc-721-non-fungible-token)
- [ERC-1155 Multi Token](#erc-1155-multi-token)
- [ERC-4626 Tokenized Vault](#erc-4626-tokenized-vault)
- [Uniswap V3 Pool Events](#uniswap-v3-pool-events)
- [Uniswap V3 Pool State Interface](#uniswap-v3-pool-state-interface)
- [Uniswap V4 Pool State (via StateLibrary)](#uniswap-v4-pool-state-via-statelibrary)
- [Uniswap V3 NonfungiblePositionManager](#uniswap-v3-nonfungiblepositionmanager)
- [Uniswap V3 Quoter](#uniswap-v3-quoter)
- [Algebra CLAMM — Delta vs Uniswap V3](#algebra-clamm--delta-vs-uniswap-v3)
- [EIP-1967 Proxy Storage Slots](#eip-1967-proxy-storage-slots)
- [Multicall3](#multicall3)

---

## ERC-20 Token Standard

### Events

| Event | Signature | topic0 |
|-------|-----------|--------|
| Transfer | `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| Approval | `Approval(address,address,uint256)` | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |

**Transfer** full Solidity signature:
```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
```
- `topics[0]` = topic0 hash
- `topics[1]` = `from` (left-padded to 32 bytes)
- `topics[2]` = `to` (left-padded to 32 bytes)
- `data` = `value` (uint256, 32 bytes)

**Approval** full Solidity signature:
```solidity
event Approval(address indexed owner, address indexed spender, uint256 value);
```
- `topics[0]` = topic0 hash
- `topics[1]` = `owner`
- `topics[2]` = `spender`
- `data` = `value` (uint256, 32 bytes)

### Functions

| Function | Selector | Returns |
|----------|----------|---------|
| `totalSupply()` | `0x18160ddd` | `uint256` |
| `balanceOf(address)` | `0x70a08231` | `uint256` |
| `transfer(address,uint256)` | `0xa9059cbb` | `bool` |
| `approve(address,uint256)` | `0x095ea7b3` | `bool` |
| `allowance(address,address)` | `0xdd62ed3e` | `uint256` |
| `transferFrom(address,address,uint256)` | `0x23b872dd` | `bool` |

### Extensions (ERC-20 Metadata)

| Function | Selector | Returns |
|----------|----------|---------|
| `name()` | `0x06fdde03` | `string` |
| `symbol()` | `0x95d89b41` | `string` |
| `decimals()` | `0x313ce567` | `uint8` |

### Allowance Race Condition

The standard `approve` function is vulnerable to a race condition: if an owner changes an allowance from N to M, a spender can front-run and spend both N and M. Many tokens implement safer alternatives:

| Function | Selector |
|----------|----------|
| `increaseAllowance(address,uint256)` | `0x39509351` |
| `decreaseAllowance(address,uint256)` | `0xa457c2d7` |

These are NOT part of the ERC-20 standard but are widely adopted (OpenZeppelin). Use `increaseAllowance`/`decreaseAllowance` when available.

---

## ERC-721 Non-Fungible Token Standard

### Events

| Event | Signature | topic0 |
|-------|-----------|--------|
| Transfer | `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| Approval | `Approval(address,address,uint256)` | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |
| ApprovalForAll | `ApprovalForAll(address,address,bool)` | `0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31` |

**Transfer** full Solidity signature:
```solidity
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
```

**Approval** full Solidity signature:
```solidity
event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
```

**ApprovalForAll** full Solidity signature:
```solidity
event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
```

### Distinguishing ERC-20 vs ERC-721 Transfer Events

ERC-20 and ERC-721 `Transfer` events share the **same topic0** (`0xddf252...`). They are distinguished by topic count:

| Standard | topics[0] | topics[1] | topics[2] | topics[3] | data |
|----------|-----------|-----------|-----------|-----------|------|
| ERC-20 | topic0 hash | `from` | `to` | *(absent)* | `value` (uint256) |
| ERC-721 | topic0 hash | `from` | `to` | `tokenId` | *(empty)* |

**Rule:** If `topics[3]` exists, it is ERC-721. If `topics[3]` is absent and `data` contains a uint256, it is ERC-20. The same logic applies to `Approval` events.

---

## ERC-1155 Multi Token Standard

### Events

| Event | Signature | topic0 |
|-------|-----------|--------|
| TransferSingle | `TransferSingle(address,address,address,uint256,uint256)` | `0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62` |
| TransferBatch | `TransferBatch(address,address,address,uint256[],uint256[])` | `0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb` |
| URI | `URI(string,uint256)` | `0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b` |
| ApprovalForAll | `ApprovalForAll(address,address,bool)` | `0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31` |

**TransferSingle** full Solidity signature:
```solidity
event TransferSingle(
    address indexed operator,
    address indexed from,
    address indexed to,
    uint256 id,
    uint256 value
);
```
- `topics[1]` = `operator` (msg.sender who initiated)
- `topics[2]` = `from`
- `topics[3]` = `to`
- `data` = abi.encode(id, value)

**TransferBatch** full Solidity signature:
```solidity
event TransferBatch(
    address indexed operator,
    address indexed from,
    address indexed to,
    uint256[] ids,
    uint256[] values
);
```
- `data` = abi.encode(ids, values) — ABI-encoded dynamic arrays

**URI** full Solidity signature:
```solidity
event URI(string value, uint256 indexed id);
```
- `topics[1]` = `id`
- `data` = ABI-encoded string

---

## ERC-4626 Tokenized Vault Standard

ERC-4626 is critical for DeFi protocol analytics. Every yield vault, lending market receipt token, and liquid staking wrapper increasingly adopts this interface.

### Events

| Event | Signature | topic0 |
|-------|-----------|--------|
| Deposit | `Deposit(address,address,uint256,uint256)` | `0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7` |
| Withdraw | `Withdraw(address,address,address,uint256,uint256)` | `0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db` |

**Deposit** full Solidity signature:
```solidity
event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
```
- `sender` = address that provided the assets
- `owner` = address that received the vault shares
- `data` = abi.encode(assets, shares)

**Withdraw** full Solidity signature:
```solidity
event Withdraw(
    address indexed sender,
    address indexed receiver,
    address indexed owner,
    uint256 assets,
    uint256 shares
);
```
- `sender` = address that initiated the withdrawal
- `receiver` = address that received the assets
- `owner` = address whose shares were burned
- `data` = abi.encode(assets, shares)

### View Functions

| Function | Selector | Returns | Description |
|----------|----------|---------|-------------|
| `asset()` | `0x38d52e0f` | `address` | Underlying asset address |
| `totalAssets()` | `0x01e1d114` | `uint256` | Total assets managed by vault |
| `convertToShares(uint256 assets)` | `0xc6e6f592` | `uint256` | Assets to shares (no fees) |
| `convertToAssets(uint256 shares)` | `0x07a2d13a` | `uint256` | Shares to assets (no fees) |
| `previewDeposit(uint256 assets)` | `0xef8b30f7` | `uint256` | Shares received for deposit (with fees) |
| `previewMint(uint256 shares)` | `0xb3d7f6b9` | `uint256` | Assets needed to mint shares (with fees) |
| `previewWithdraw(uint256 assets)` | `0x0a28a477` | `uint256` | Shares burned to withdraw assets (with fees) |
| `previewRedeem(uint256 shares)` | `0x4cdad506` | `uint256` | Assets received for redeeming shares (with fees) |
| `maxDeposit(address receiver)` | `0x402d267d` | `uint256` | Max assets depositable |
| `maxMint(address receiver)` | `0xc63d75b6` | `uint256` | Max shares mintable |
| `maxWithdraw(address owner)` | `0xce96cb77` | `uint256` | Max assets withdrawable |
| `maxRedeem(address owner)` | `0xd905777e` | `uint256` | Max shares redeemable |

### Rounding Rules (Security-Critical)

ERC-4626 mandates rounding **against the user, in favor of the vault** to prevent rounding exploits:

| Operation | Converts | Rounds | Direction | Rationale |
|-----------|----------|--------|-----------|-----------|
| Deposit | assets -> shares | **DOWN** | User gets fewer shares | Vault retains fractional value |
| Mint | shares -> assets | **UP** | User pays more assets | Vault never undercollateralised |
| Withdraw | assets -> shares | **UP** | User burns more shares | Vault retains fractional value |
| Redeem | shares -> assets | **DOWN** | User gets fewer assets | Vault never undercollateralised |

### `convertTo*` vs `preview*` Distinction

| Function Family | Includes Fees/Slippage | Use Case |
|----------------|----------------------|----------|
| `convertToShares` / `convertToAssets` | **No** — ideal exchange rate only | Display, share price calculation, analytics dashboards |
| `previewDeposit` / `previewMint` / `previewWithdraw` / `previewRedeem` | **Yes** — reflects actual execution cost | Transaction planning, building calldata, MEV analysis |

The difference between `convertTo*` and the corresponding `preview*` function reveals the vault's fee structure and current slippage.

---

## Uniswap V3 Pool Events

### All Events

| Event | Signature | topic0 |
|-------|-----------|--------|
| Initialize | `Initialize(uint160,int24)` | `0x98636036cb66a9c19a37435efc1e90142190214e8abeb821bdba3f2990dd4c95` |
| Swap | `Swap(address,address,int256,int256,uint160,uint128,int24)` | `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67` |
| Mint | `Mint(address,address,int24,int24,uint128,uint256,uint256)` | `0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde` |
| Burn | `Burn(address,int24,int24,uint128,uint256,uint256)` | `0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c` |
| Collect | `Collect(address,address,int24,int24,uint128,uint128)` | `0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0` |
| Flash | `Flash(address,address,uint256,uint256,uint256,uint256)` | `0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633` |
| IncreaseObservationCardinalityNext | `IncreaseObservationCardinalityNext(uint16,uint16)` | `0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3ba9f9b2d236282` |
| SetFeeProtocol | `SetFeeProtocol(uint8,uint8,uint8,uint8)` | `0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133` |
| CollectProtocol | `CollectProtocol(address,address,uint128,uint128)` | `0x596b573906218d3411850b26a6b437d6c4522fdb43d2d2386263f86d50b8b151` |

### Full Solidity Signatures

```solidity
event Initialize(uint160 sqrtPriceX96, int24 tick);
```
Emitted exactly once when the pool is first initialized via `initialize()`. Sets the starting price.

```solidity
event Swap(
    address indexed sender,
    address indexed recipient,
    int256 amount0,
    int256 amount1,
    uint160 sqrtPriceX96,
    uint128 liquidity,
    int24 tick
);
```
- `amount0` and `amount1` are **signed**: negative = tokens leaving the pool (sent to recipient), positive = tokens entering the pool.
- `sqrtPriceX96`, `liquidity`, `tick` = pool state **after** the swap.

```solidity
event Mint(
    address sender,
    address indexed owner,
    int24 indexed tickLower,
    int24 indexed tickUpper,
    uint128 amount,
    uint256 amount0,
    uint256 amount1
);
```
- `sender` (NOT indexed) = address that called `mint()` (usually a router/position manager).
- `owner` (indexed) = address that owns the liquidity position.
- `amount` = liquidity units added.
- `amount0`, `amount1` = actual tokens deposited.

```solidity
event Burn(
    address indexed owner,
    int24 indexed tickLower,
    int24 indexed tickUpper,
    uint128 amount,
    uint256 amount0,
    uint256 amount1
);
```
- Removes liquidity. Tokens are NOT transferred here — they accumulate as `tokensOwed` and must be collected via `collect()`.

```solidity
event Collect(
    address indexed owner,
    address recipient,
    int24 indexed tickLower,
    int24 indexed tickUpper,
    uint128 amount0,
    uint128 amount1
);
```
- Collects accumulated fees + tokens from a burned position.

```solidity
event Flash(
    address indexed sender,
    address indexed recipient,
    uint256 amount0,
    uint256 amount1,
    uint256 paid0,
    uint256 paid1
);
```
- `amount0/1` = borrowed amounts, `paid0/1` = amounts repaid (must be >= borrowed + fee).

```solidity
event IncreaseObservationCardinalityNext(
    uint16 observationCardinalityNextOld,
    uint16 observationCardinalityNextNew
);
```

```solidity
event SetFeeProtocol(
    uint8 feeProtocol0Old,
    uint8 feeProtocol1Old,
    uint8 feeProtocol0New,
    uint8 feeProtocol1New
);
```

```solidity
event CollectProtocol(
    address indexed sender,
    address indexed recipient,
    uint128 amount0,
    uint128 amount1
);
```

---

## Uniswap V3 Pool State Interface

### `slot0()`

```solidity
function slot0() external view returns (
    uint160 sqrtPriceX96,
    int24 tick,
    uint16 observationIndex,
    uint16 observationCardinality,
    uint16 observationCardinalityNext,
    uint8 feeProtocol,
    bool unlocked
);
```
Selector: `0x3850c7bd`

Returns 7 fields packed into the first storage slot. This is the most frequently read function on any V3 pool.

- `sqrtPriceX96` = sqrt(token1/token0) * 2^96. To get the human-readable price: `price = (sqrtPriceX96 / 2^96)^2`, then adjust for decimals.
- `tick` = current tick index corresponding to sqrtPriceX96.
- `feeProtocol` = packed protocol fee (lower 4 bits = token0, upper 4 bits = token1).
- `unlocked` = reentrancy guard (true = unlocked, false = currently executing).

### `liquidity()`

```solidity
function liquidity() external view returns (uint128);
```
Selector: `0x1a686502`

Returns **in-range liquidity only** — the sum of liquidity from positions whose range includes the current tick. This is NOT the total liquidity in the pool. Positions out of range do not contribute.

### `ticks(int24)`

```solidity
function ticks(int24 tick) external view returns (
    uint128 liquidityGross,
    int128 liquidityNet,
    uint256 feeGrowthOutside0X128,
    uint256 feeGrowthOutside1X128,
    int56 tickCumulativeOutside,
    uint160 secondsPerLiquidityOutsideX128,
    uint32 secondsOutside,
    bool initialized
);
```
Selector: `0xf30dba93`

- `liquidityGross` = total liquidity referencing this tick (for garbage collection — if 0, tick can be cleared).
- `liquidityNet` = net liquidity change when crossing this tick (positive = entering, negative = leaving).
- `feeGrowthOutside*` = fee accumulator values on the "other side" of the tick, used for fee calculations.

### `tickBitmap(int16)`

```solidity
function tickBitmap(int16 wordPosition) external view returns (uint256);
```
Selector: `0x5339c296`

Each word stores 256 boolean flags indicating which ticks in that range are initialized. Used for efficient next-initialized-tick lookup during swaps.

### `positions(bytes32)`

```solidity
function positions(bytes32 key) external view returns (
    uint128 liquidity,
    uint256 feeGrowthInside0LastX128,
    uint256 feeGrowthInside1LastX128,
    uint128 tokensOwed0,
    uint128 tokensOwed1
);
```
Selector: `0x514ea4bf`

Position key = `keccak256(abi.encodePacked(owner, tickLower, tickUpper))`

- `liquidity` = liquidity units in this position.
- `feeGrowthInside*LastX128` = snapshot of fee growth at last interaction (used to compute uncollected fees).
- `tokensOwed*` = accumulated tokens from burns and fee collections not yet claimed.

### Global Fee Accumulators

```solidity
function feeGrowthGlobal0X128() external view returns (uint256);
function feeGrowthGlobal1X128() external view returns (uint256);
```
Selectors: `0xf3058399` / `0x46141319`

Cumulative per-unit-of-liquidity fee counters in Q128.128 fixed-point format. These only increase. To compute fees earned by a position, subtract the position's `feeGrowthInside*LastX128` from the current inside growth (computed from global and outside values).

### `observations(uint256)`

```solidity
function observations(uint256 index) external view returns (
    uint32 blockTimestamp,
    int56 tickCumulative,
    uint160 secondsPerLiquidityCumulativeX128,
    bool initialized
);
```
Selector: `0x252c09d7`

Oracle observation array. Stores cumulative tick and seconds-per-liquidity values for TWAP calculations.

---

## Uniswap V4 Pool State

Uniswap V4 uses a **singleton PoolManager** architecture — all pools live in one contract, eliminating per-pool deployment costs.

### `slot0` — 4 Fields Only

Unlike V3's 7-field slot0, V4 stores only 4 fields:

| Field | Type | Description |
|-------|------|-------------|
| `sqrtPriceX96` | `uint160` | Same encoding as V3 |
| `tick` | `int24` | Current tick |
| `protocolFee` | `uint24` | Protocol fee (replaces V3's uint8 packed format) |
| `lpFee` | `uint24` | LP fee (dynamic fees possible via hooks) |

Oracle-related fields (`observationIndex`, `observationCardinality`, `observationCardinalityNext`) and `unlocked` have been removed from slot0. Oracles are implemented via hooks in V4.

### Singleton PoolManager

All V4 pools are managed by a single `PoolManager` contract. Pool identity is determined by a `PoolKey`:

```solidity
struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    IHooks hooks;
}
```

PoolId = `keccak256(abi.encode(PoolKey))`

### StateLibrary Pattern

V4 exposes pool state through the `StateLibrary` which provides external view functions that read directly from the PoolManager's storage:

```solidity
// Reading V4 pool state via StateLibrary
StateLibrary.getSlot0(poolManager, poolId);
StateLibrary.getLiquidity(poolManager, poolId);
StateLibrary.getTickInfo(poolManager, poolId, tick);
StateLibrary.getPosition(poolManager, poolId, owner, tickLower, tickUpper, salt);
```

### `extsload` for Direct Storage

V4's PoolManager exposes `extsload(bytes32 slot)` for gas-efficient direct storage reads. This allows reading arbitrary storage slots without going through view functions — useful for MEV searchers and advanced analytics:

```solidity
function extsload(bytes32 slot) external view returns (bytes32);
function extsload(bytes32 startSlot, uint256 nSlots) external view returns (bytes32[] memory);
```

---

## Uniswap V3 NonfungiblePositionManager

Address (Ethereum mainnet): `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`

The NonfungiblePositionManager wraps V3 pool positions as ERC-721 NFTs. Each NFT represents a unique liquidity position.

### `positions(uint256 tokenId)`

```solidity
function positions(uint256 tokenId) external view returns (
    uint96 nonce,
    address operator,
    address token0,
    address token1,
    uint24 fee,
    int24 tickLower,
    int24 tickUpper,
    uint128 liquidity,
    uint256 feeGrowthInside0LastX128,
    uint256 feeGrowthInside1LastX128,
    uint128 tokensOwed0,
    uint128 tokensOwed1
);
```
Selector: `0x99fbab88`

Returns 12 fields describing the full position state:

| Field | Type | Description |
|-------|------|-------------|
| `nonce` | `uint96` | Permit nonce (for gasless approvals) |
| `operator` | `address` | Approved operator for this specific NFT |
| `token0` | `address` | Pool's token0 |
| `token1` | `address` | Pool's token1 |
| `fee` | `uint24` | Pool fee tier (500, 3000, 10000) |
| `tickLower` | `int24` | Lower tick boundary |
| `tickUpper` | `int24` | Upper tick boundary |
| `liquidity` | `uint128` | Liquidity units in position |
| `feeGrowthInside0LastX128` | `uint256` | Fee growth snapshot for token0 |
| `feeGrowthInside1LastX128` | `uint256` | Fee growth snapshot for token1 |
| `tokensOwed0` | `uint128` | Uncollected token0 (from fees + burns) |
| `tokensOwed1` | `uint128` | Uncollected token1 (from fees + burns) |

### Enumerating Positions by Owner

Since the NonfungiblePositionManager is an ERC-721:

```solidity
function balanceOf(address owner) external view returns (uint256);
function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256 tokenId);
```

To enumerate all positions for an address:
1. Call `balanceOf(owner)` to get total count.
2. Loop `tokenOfOwnerByIndex(owner, i)` for `i` in `[0, count)` to get each tokenId.
3. Call `positions(tokenId)` for each to get position details.

---

## Uniswap V3 Quoter (V2)

Address (Ethereum mainnet): `0x61fFE014bA17989E743c5F6cB21bF9697530B21` (QuoterV2)

The Quoter simulates swaps off-chain to return expected amounts. It **intentionally reverts** — you must use `eth_call` (or `callStatic` in ethers.js). Never send a transaction to the Quoter.

### `quoteExactInputSingle`

```solidity
function quoteExactInputSingle(
    QuoteExactInputSingleParams memory params
) external returns (
    uint256 amountOut,
    uint160 sqrtPriceX96After,
    uint32 initializedTicksCrossed,
    uint256 gasEstimate
);

struct QuoteExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint24 fee;
    uint160 sqrtPriceLimitX96;  // 0 = no limit
}
```

### `quoteExactInput`

```solidity
function quoteExactInput(
    bytes memory path,
    uint256 amountIn
) external returns (
    uint256 amountOut,
    uint160[] memory sqrtPriceX96AfterList,
    uint32[] memory initializedTicksCrossedList,
    uint256 gasEstimate
);
```

### `quoteExactOutputSingle`

```solidity
function quoteExactOutputSingle(
    QuoteExactOutputSingleParams memory params
) external returns (
    uint256 amountIn,
    uint160 sqrtPriceX96After,
    uint32 initializedTicksCrossed,
    uint256 gasEstimate
);

struct QuoteExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    uint256 amount;
    uint24 fee;
    uint160 sqrtPriceLimitX96;  // 0 = no limit
}
```

### `quoteExactOutput`

```solidity
function quoteExactOutput(
    bytes memory path,
    uint256 amountOut
) external returns (
    uint256 amountIn,
    uint160[] memory sqrtPriceX96AfterList,
    uint32[] memory initializedTicksCrossedList,
    uint256 gasEstimate
);
```

### Multi-hop Path Encoding

Paths are tightly packed bytes: `[tokenA (20 bytes), fee_AB (3 bytes), tokenB (20 bytes), fee_BC (3 bytes), tokenC (20 bytes)]`

Example — USDC -> WETH -> DAI:
```
0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48  // USDC
0x000bb8                                        // fee 3000 (0.3%)
0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2    // WETH
0x0001f4                                        // fee 500 (0.05%)
0x6B175474E89094C44Da98b954EedeAC495271d0F    // DAI
```

For `quoteExactOutput`, the path is **reversed**: `[tokenOut, fee, ..., tokenIn]`.

### Critical Usage Note

The Quoter intentionally reverts after computing results. You **must** call it via `eth_call` (static call):

```javascript
// ethers.js
const result = await quoter.callStatic.quoteExactInputSingle(params);

// viem
const result = await publicClient.simulateContract({
    address: quoterAddress,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [params],
});
```

Sending an actual transaction to the Quoter will waste gas and revert.

---

## Algebra CLAMM — Delta vs Uniswap V3

Algebra is a modular concentrated liquidity AMM used by Camelot (Arbitrum), QuickSwap (Polygon), and Katana (Ronin). It shares Uniswap V3's concentrated liquidity math (`price = 1.0001^tick`) but differs in architecture and some ABIs.

### Architecture Difference

- **Uniswap V3:** Monolithic pool — all logic (swapping, liquidity, fees) in one contract.
- **Algebra Integral:** Modular — immutable Core + tailored Plugins (dynamic fees, limit orders, farming). Pool contract is lighter; extensions via external plugin calls.

### Event Compatibility — topic0 Hashes

**Pool events share identical topic0 hashes with Uniswap V3.** The canonical event signatures use the same parameter types in the same order. Parameter names (`bottomTick` vs `tickLower`) do not affect the keccak256 hash — only the event name and parameter types matter.

| Event | Canonical Signature | topic0 | V3 Compatible? |
|-------|-------------------|--------|----------------|
| Mint | `Mint(address,address,int24,int24,uint128,uint256,uint256)` | `0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde` | ✅ Same |
| Burn | `Burn(address,int24,int24,uint128,uint256,uint256)` | `0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c` | ✅ Same |
| Swap | `Swap(address,address,int256,int256,uint160,uint128,int24)` | `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67` | ✅ Same |

> **Field naming differs in the ABI:** Algebra uses `bottomTick`/`topTick` where V3 uses `tickLower`/`tickUpper`, and `price` where V3 uses `sqrtPriceX96`. When decoding with a typed ABI, use the protocol-specific field names. When filtering by topic0, V3 and Algebra events are interchangeable.

*Source: `IAlgebraPoolEvents.sol` in `cryptoalgebra/Algebra` (integral-v1.2.2)*

### Pool State: `globalState()` Replaces `slot0()`

Algebra does NOT have `slot0()`. Pool state is exposed via `globalState()`:

```solidity
function globalState() external view returns (
    uint160 price,          // equivalent to sqrtPriceX96
    int24 tick,             // current tick
    uint16 lastFee,         // last applied fee (1e-6 units, dynamic)
    uint8 pluginConfig,     // bitmask for active plugins
    uint16 communityFee,    // protocol fee
    bool unlocked           // reentrancy lock
);
```
Selector: `0xe76c01e4`

| V3 `slot0()` Field | Algebra `globalState()` Equivalent |
|--------------------|------------------------------------|
| `sqrtPriceX96` | `price` |
| `tick` | `tick` |
| `observationIndex` | _(removed — oracles handled via plugins)_ |
| `observationCardinality` | _(removed)_ |
| `observationCardinalityNext` | _(removed)_ |
| `feeProtocol` | `communityFee` |
| `unlocked` | `unlocked` |
| _(N/A)_ | `lastFee` (dynamic, plugin-managed) |
| _(N/A)_ | `pluginConfig` (plugin activation bitmask) |

### NonfungiblePositionManager: `positions()` Differences

Algebra's NPM `positions(uint256)` returns a **different struct** than V3:

| Field | V3 Type | Algebra Type | Note |
|-------|---------|-------------|------|
| nonce | `uint96` | `uint88` | Different width |
| operator | `address` | `address` | Same |
| token0 | `address` | `address` | Same |
| token1 | `address` | `address` | Same |
| fee | `uint24` | _(absent)_ | Algebra uses dynamic fees, no fixed tier |
| deployer | _(absent)_ | `address` | Algebra-specific: pool factory identifier |
| tickLower | `int24` | `int24` | Same (NPM uses `tickLower`, not `bottomTick`) |
| tickUpper | `int24` | `int24` | Same |
| liquidity | `uint128` | `uint128` | Same |
| feeGrowthInside0LastX128 | `uint256` | `uint256` | Same |
| feeGrowthInside1LastX128 | `uint256` | `uint256` | Same |
| tokensOwed0 | `uint128` | `uint128` | Same |
| tokensOwed1 | `uint128` | `uint128` | Same |

> **Selector differs from V3.** Do not assume `0x99fbab88` works for Algebra NPM. The struct layout change means a different ABI encoding and different selector. Verify from the deployed contract.

*Source: `INonfungiblePositionManager.sol` in `cryptoalgebra/Algebra`*

### Tick Spacing

V3 fixes tick spacing per fee tier (e.g., 0.3% = 60). Algebra allows **configurable tick spacing per pool**, set at creation via `AlgebraFactory`. Query `tickSpacing()` on the pool contract to get the value.

### Detection: V3 vs Algebra Pool

1. Call `globalState()` (selector `0xe76c01e4`) — success = Algebra pool
2. Call `slot0()` (selector `0x3850c7bd`) — success = Uniswap V3 pool
3. Alternatively, check the factory address against known factories per chain

---

## EIP-1967 Proxy Storage Slots

Standard storage slots for transparent/UUPS proxies. Read these via `eth_getStorageAt` to find implementation addresses behind proxies.

| Slot | Value | Derivation |
|------|-------|------------|
| Implementation | `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` | `keccak256("eip1967.proxy.implementation") - 1` |
| Beacon | `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` | `keccak256("eip1967.proxy.beacon") - 1` |
| Admin | `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103` | `keccak256("eip1967.proxy.admin") - 1` |

### Usage

```javascript
// Read implementation address behind a proxy
const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const implAddress = await provider.getStorageAt(proxyAddress, implSlot);
// Result is 32 bytes, address is in the last 20 bytes:
// 0x000000000000000000000000{20-byte-address}
```

### Common Proxy Patterns

- **Transparent Proxy (OpenZeppelin):** Admin calls go to proxy logic; all other calls delegatecall to implementation.
- **UUPS (ERC-1822):** Upgrade logic lives in the implementation itself.
- **Beacon Proxy:** Multiple proxies point to a single beacon contract that returns the implementation address. Upgrading the beacon upgrades all proxies simultaneously.

Always check the implementation slot first. If zero, check the beacon slot.

---

## Multicall3

**Address:** `0xcA11bde05977b3631167028862bE2a173976CA11`

Deployed at the same address on all EVM chains (via CREATE2). Batch multiple read calls into a single RPC request.

### `aggregate3`

```solidity
struct Call3 {
    address target;
    bool allowFailure;
    bytes callData;
}

struct Result {
    bool success;
    bytes returnData;
}

function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData);
```
Selector: `0x82ad56cb`

### Usage Pattern

```javascript
// Batch multiple calls in a single RPC request
const multicall = new Contract('0xcA11bde05977b3631167028862bE2a173976CA11', multicall3Abi, provider);

const calls = [
    {
        target: poolAddress,
        allowFailure: false,
        callData: poolInterface.encodeFunctionData('slot0'),
    },
    {
        target: poolAddress,
        allowFailure: false,
        callData: poolInterface.encodeFunctionData('liquidity'),
    },
    {
        target: tokenAddress,
        allowFailure: true,  // allow failure for optional calls
        callData: erc20Interface.encodeFunctionData('symbol'),
    },
];

const results = await multicall.callStatic.aggregate3(calls);
// results[0].returnData -> decode with poolInterface.decodeFunctionResult('slot0', ...)
// results[1].returnData -> decode with poolInterface.decodeFunctionResult('liquidity', ...)
// results[2].success -> check before decoding
```

### Other Useful Functions

| Function | Selector | Description |
|----------|----------|-------------|
| `aggregate3Value(Call3Value[])` | `0x174dea71` | Same as aggregate3 but with per-call ETH value |
| `getBlockNumber()` | `0x42cbb15c` | Returns current block number |
| `getBlockHash(uint256)` | `0xee82ac5e` | Returns block hash |
| `getCurrentBlockTimestamp()` | `0x0f28c97d` | Returns block.timestamp |
| `getEthBalance(address)` | `0x4d2301cc` | Returns ETH balance |
| `getChainId()` | `0x3408e470` | Returns chain ID |
| `getBasefee()` | `0x3e64a696` | Returns block.basefee |

### Best Practices

- Set `allowFailure: true` for calls that might revert (e.g., tokens that don't implement `symbol()`).
- Set `allowFailure: false` for calls that must succeed (reverts the entire batch if any fail).
- Batch size limit is practical, not protocol-imposed — stay under gas limits (~500-1000 calls per batch depending on complexity).
- Multicall3 is a view-compatible function — use `eth_call` for read batches.
