# Wallet Analytics

> **Minimum tier requirements:**
> - **Tier A (CORE)** — Basic wallet profiling: balance snapshots, ERC-20 transfer history, protocol interaction mapping, PnL estimation from logged events
> - **Tier C (TRACE)** — Complete native ETH fund flow via `debug_traceTransaction` with `callTracer(withLog:true)`, capturing internal transfers invisible to `eth_getLogs`
> - **Tier D (ENRICH)** — Entity labels from third-party providers (Chainalysis, Arkham, Nansen), heuristic-derived and subject to degradation

---

## Address Clustering Heuristics

*Reference: Friedhelm Victor, "Address Clustering Heuristics for Ethereum", Financial Cryptography (FC) 2020*

Three heuristics adapted for Ethereum's account model (unlike Bitcoin's common-input-ownership heuristic, Ethereum uses persistent EOA addresses, so clustering requires different approaches):

### Heuristic 1 — Deposit Address Detection (most effective)

1. **Identify known exchange hot wallets** — use seed labels from tagged address databases or manual verification of high-throughput addresses with known exchange interactions.
2. **Scan for EOAs that send funds exclusively to a hot wallet** but receive from diverse, unrelated sources. These are candidate deposit addresses: single-purpose forwarding accounts provisioned by the exchange for individual users.
3. **All deposit addresses forwarding to the same hot wallet belong to the same exchange entity.** The exchange controls the private keys of every deposit address; the user never does.
4. **Split into ETH deposit clustering and Token deposit clustering.** The forwarding patterns differ: ETH deposit addresses typically sweep balances in a single transaction, while token deposit addresses may require a separate gas-funding transaction before the token transfer. Treat these as parallel but distinct clustering passes.

### Heuristic 2 — Airdrop Multi-Participation

Addresses that (a) receive the same airdrop token and (b) forward the exact received amount to a single aggregation address are flagged as the same entity (Sybil attacker). The signature pattern is: N addresses each receive X tokens from the airdrop contract, then each sends exactly X tokens to address A within a short time window. Address A is the operator's collection point.

### Heuristic 3 — Token Transfer Authorization

Addresses granting `approve()` to the same spender address, especially in temporal proximity, are candidates for same-entity grouping. The reasoning: a single operator managing multiple wallets will often approve the same contract (e.g., a DEX router or custom aggregation contract) from all wallets in rapid succession. This heuristic produces higher false-positive rates than Heuristics 1 and 2, so treat results as candidates requiring corroboration.

### Results

17.9% of all active Ethereum EOAs were clustered into 340,000+ multi-address entities. Heuristic 1 (deposit address detection) contributed the largest share of clustered addresses. The remaining ~82% of EOAs could not be confidently linked using on-chain data alone.

---

## Sybil Detection Topologies

Three primary fund-flow patterns observed in production Sybil detection (Wormhole production system):

| Topology | Structure | Signature |
|----------|-----------|-----------|
| **Star** | Hub fans out to N spokes | Single funder sends ETH to many addresses in rapid succession; spokes act independently then return funds to hub or a collection address |
| **Chain** | Sequential forwarding A→B→C→...→Z | Funds pass through a linear sequence of addresses, each performing the target action before forwarding to the next; visible as a single-path graph |
| **Tree** | Hierarchical distribution | Root funds level-1 addresses, each level-1 funds multiple level-2 addresses, and so on; creates a branching structure with depth proportional to operational sophistication |

**Detection method:** Construct a similarity matrix across candidate addresses using features: transaction timing distributions, action cadence (time between protocol interactions), action pattern sequences (which contracts called in what order). Apply Louvain community detection on the resulting graph to identify tightly-connected clusters. Addresses within the same community that also share a funding source are flagged as Sybil entities.

---

## Wallet Profiling Methodology `[CORE]`

Five steps to build a comprehensive wallet profile from on-chain data:

### Step 1 — Balance Snapshot

Query current holdings at a pinned block number for reproducibility:
- **Native ETH:** `eth_getBalance(address, blockNumber)`
- **ERC-20 tokens:** Batch `balanceOf(address)` calls via **Multicall3** (`0xcA11bde05977b3631167028862bE2a173976CA11`) to minimize RPC round-trips. Pin the block in the Multicall3 call to ensure all balances reflect the same state.

Always pin to a specific block. Querying `latest` across multiple calls risks inconsistent snapshots if a new block arrives mid-query.

### Step 2 — Transaction History Reconstruction

Use `eth_getLogs` to retrieve all `Transfer(address,address,uint256)` events where the target address appears in either:
- `topics[1]` (sender — tokens leaving the wallet)
- `topics[2]` (receiver — tokens entering the wallet)

This produces a complete ERC-20 transfer history. For each event, decode the token contract address (from `log.address`), counterparty, amount, block number, and transaction hash. Sort chronologically by `(blockNumber, logIndex)` to establish ordering within the same block.

**Limitation:** This captures only ERC-20 transfers. Native ETH movements require Tier C (see Native ETH Tracking Limitation below).

### Step 3 — Protocol Interaction Mapping

Scan the address's transaction history for events emitted by known DeFi protocol contracts:
- **DEX activity:** `Swap` events from Uniswap, Curve, Balancer, etc.
- **Lending:** `Deposit`, `Borrow`, `Repay`, `Withdraw` events from Aave, Compound, etc.
- **Staking:** `Staked`, `Unstaked` events from liquid staking protocols
- **Governance:** `VoteCast` events from DAO governance contracts
- **Bridge usage:** `DepositInitiated`, `WithdrawalFinalized` from bridge contracts

Map each interaction to a protocol name, action type, and parameters. This builds the wallet's DeFi activity fingerprint.

### Step 4 — PnL Estimation

Reconstruct the wallet's trade history and compute profit/loss:

1. **Extract trade events:** Collect all `Swap` events from DEX interactions involving the wallet.
2. **Compute cost basis:** For each token position, track the weighted average entry price using swap event data (token amounts and counterpart token values at the time of the trade).
3. **Mark-to-market:** Compare current holdings (Step 1) at current prices against accumulated cost basis to compute unrealized PnL. Sum realized PnL from closed positions (full sell events).

There is no single data source that covers end-to-end PnL. You must combine:
- Transfer events for token inflows and outflows (Step 2)
- DEX swap events for trade execution prices (Step 3 protocol mapping)
- Current balances for unrealized position valuation (Step 1)
- Price feeds (on-chain oracle snapshots or off-chain APIs) for historical and current token prices

Handle edge cases: tokens received as yield (no swap event), tokens received via airdrop (zero cost basis), tokens lost to exploits (realized loss at full cost basis).

### Step 5 — Behavioral Fingerprinting

Extract behavioral patterns that characterize the wallet's operator:
- **Transaction timing patterns:** Distribution of transactions across hours of day and days of week (reveals timezone and activity schedule)
- **Gas price preferences:** Tendency to use priority fees above/below the median, willingness to pay for speed (reveals urgency profile and sophistication)
- **Contract interaction diversity:** Number of unique contracts interacted with, ratio of known-protocol vs unknown-contract interactions
- **Position sizing patterns:** Typical trade sizes relative to portfolio, concentration vs diversification tendencies
- **Reaction latency:** Time between an on-chain event (e.g., large pool deposit) and the wallet's response transaction

---

## Native ETH Tracking Limitation

**CRITICAL:** `eth_getLogs` **cannot** see native ETH internal transfers. When a smart contract calls `.transfer()`, `.send()`, or `.call{value: x}()` to move ETH to another address, **no event is emitted**. These transfers are executed at the EVM level as internal message calls, invisible to the log-based event system.

This creates a fundamental gap in wallet analytics:

| Tier | Capability | Gap |
|------|-----------|-----|
| **Tier A (CORE)** | Full ERC-20 flow tracking via `eth_getLogs`. Native ETH top-level transactions visible via `eth_getTransactionByHash`. | **Internal ETH transfers invisible.** A contract receiving ETH from a user and forwarding it internally to another address will show as ETH leaving the user but not arriving at the final destination. Fund flow analysis has blind spots. |
| **Tier C (TRACE)** | `debug_traceTransaction` with `callTracer(withLog:true)` replays every transaction and records every internal call, including value transfers. | **Required for complete fund tracing.** Every ETH movement — including multi-hop internal transfers through contract chains — is captured. This is the minimum tier for forensic-grade wallet analysis. |

When operating at Tier A, explicitly flag any native ETH flow analysis as incomplete. Do not present ERC-20-only flow data as a complete picture of a wallet's fund movements.

---

## Exchange Netflow Analysis

Monitor `Transfer` events to and from known exchange deposit/hot wallet addresses to gauge market sentiment:

- **Inflow to exchange** (tokens moving from external wallets to exchange addresses): Indicates the holder is positioning to sell. Sustained high inflow = bearish signal (selling pressure building).
- **Outflow from exchange** (tokens moving from exchange addresses to external wallets): Indicates accumulation or movement to self-custody. Sustained high outflow = bullish signal (supply leaving liquid markets).
- **Net flow** = Outflow - Inflow. Track net flow over rolling time windows (1h, 4h, 24h, 7d) to identify regime changes.

Cross-reference with:
- **Address age of inflow sources:** Long-dormant wallets suddenly depositing to exchange = potential large holder distribution.
- **Token-specific vs broad-based flows:** Single-token inflow spike = token-specific event. Broad inflow across many tokens = macro risk-off.
- **Whale vs retail decomposition:** Segment flows by transfer size to distinguish institutional moves from retail noise.

---

## Smart Money Signal Detection

Identify addresses with demonstrated information advantage by tracking who moves first when information hits the market:

- **Pre-listing accumulation:** Wallets that accumulate tokens on DEXes before CEX listing announcements. Retroactively identify by scanning for wallets that held tokens prior to the listing date and sold during the initial listing price spike.
- **Counter-cyclical buying:** Wallets that consistently buy during market-wide drawdowns (>20% decline in 7d) and realize positive returns within the subsequent 30 days. Filter for wallets with >60% hit rate across multiple cycles.
- **Beta testing participation:** Wallets that interact with new protocol contracts during testnet-to-mainnet migration windows. Early adopters of protocols that later achieve significant TVL suggest insider or highly-informed actors.
- **Strategic distribution before adverse events:** Wallets that reduce exposure to specific protocols within 72 hours before exploit, governance attack, or depeg. One instance is coincidence; repeated instances across multiple events indicate information advantage.

Track these wallets forward: their new positions and protocol interactions become leading indicators. Weight signals by the wallet's historical accuracy, not just activity volume.

---

## Entity Clustering via On-Chain Behavior

Upgrade individual wallet addresses to entity-level groupings by combining multiple behavioral signals:

### Shared Funding Source

Trace each address back to its first incoming ETH transaction (gas funding). Addresses that received their initial gas from the same funder address — especially if the funder sent similar amounts in rapid succession — are candidates for same-entity grouping. This is the strongest single signal because every new wallet needs gas before it can operate.

### Synchronized Behavior

Addresses that perform the same actions within short time windows (< 5 minutes apart) across multiple occasions. Single-instance synchronization is weak evidence; repeated synchronization across 3+ distinct action types is strong evidence. Measure synchronization via pairwise timestamp correlation across shared action types.

### Common Interactions with Uncommon Contracts

Addresses that interact with the same low-popularity contracts (< 100 unique interactors) are more likely to be related than addresses that share interactions with popular contracts (Uniswap, Aave). Weight shared contract interactions inversely by the contract's total unique user count (TF-IDF-like scoring).

### Combining Signals

No single signal is sufficient for confident entity attribution. Score each address pair across all three dimensions and apply a threshold: addresses must meet at least two of the three criteria, or meet one criterion with overwhelming strength (e.g., shared funder + identical action sequences across 10+ events). The resulting entity groupings replace individual wallet addresses in all downstream analytics (net flow, smart money tracking, profiling).

---

## Pitfall Pack

*Referenced from Phase 4 Sanity Check — run through this checklist before presenting wallet analytics results.*

- [ ] **Rebasing token balance drift accounted for?** Tokens like stETH rebase daily; a balance snapshot at block N will differ from the "expected" balance computed from transfer history alone. Reconcile by querying the token's shares-based balance or applying the rebase index.
- [ ] **ERC-4626 share vs underlying asset distinguished?** Vault share tokens (e.g., yvUSDC) represent a claim on underlying assets. Display both the share count and the computed underlying value (`convertToAssets(shares)`). Never present share count as if it were the underlying token amount.
- [ ] **Wrapped staking tokens converted to underlying value?** wstETH, rETH, cbETH, and similar tokens trade at a ratio to their underlying asset that changes over time. Always convert to underlying value using the on-chain exchange rate at the snapshot block, not a hardcoded ratio.
- [ ] **CEX hot wallet / omnibus address not mistaken for whale?** Exchange-controlled addresses hold aggregated user funds. A large balance on an exchange hot wallet does not indicate a single wealthy holder. Cross-reference against known exchange address databases before flagging any address as a whale.
- [ ] **Failed transactions checked?** Reverted transactions are sometimes more revealing than successful ones. A failed `withdraw()` call might indicate the wallet attempted to exit a position but was blocked by a timelock or insufficient liquidity. Include failed transactions in behavioral analysis and flag them explicitly.
- [ ] **Nonce gaps / anomalies inspected?** Gaps in an address's nonce sequence indicate transactions that were submitted but replaced (via higher gas price) or dropped from the mempool. Nonce gaps can reveal: cancelled transactions (the wallet tried to do something and changed its mind), MEV activity (speedup replacements), or operational issues (stuck transactions). Query the full nonce history and flag any gaps.
- [ ] **If Tier D labels used: marked as heuristic with degradation risk?** Third-party entity labels are heuristic classifications, not ground truth. Labels degrade over time as exchanges rotate hot wallets, protocols upgrade contracts, and entities restructure operations. Always display Tier D labels with a freshness timestamp and a disclaimer that the label is probabilistic. Never present a Tier D label as confirmed identity without independent verification.
