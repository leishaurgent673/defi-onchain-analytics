# Token Analytics

**Minimum tier:** A (`CORE`) for all analysis; D (`ENRICH`) for entity-level whale identification.

---

## 1. Holder Distribution Analysis `[CORE]`

Build a complete picture of who holds what by replaying every transfer from contract creation.

1. **Scan all Transfer events** for the token contract from its creation block. Filter: `address=<token_contract>`, `topics[0]=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` (the `Transfer(address,address,uint256)` event signature).
2. **Build balance map:** For each address, sum inflows (`topics[2]=address`, meaning the address appears as the `to` parameter) minus outflows (`topics[1]=address`, meaning the address appears as the `from` parameter). This yields a running balance for every address that has ever held the token.
3. **Sort by balance descending** to produce the top holder table. Include columns: rank, address, balance, percentage of total supply, first-seen block, last-activity block.
4. **Concentration metrics:**
   - **Top 10 holder %** — Sum of top 10 balances divided by circulating supply. Above 50% is a red flag for centralization risk.
   - **Gini coefficient** — 0 = perfectly equal distribution, 1 = single holder owns everything. Most tokens fall in 0.8-0.99 range; compare against peers in the same token category.
   - **Herfindahl-Hirschman Index (HHI)** — Sum of squared market share percentages across all holders. Higher values indicate greater concentration. Useful for comparing distribution across tokens with different holder counts.

---

## 2. Supply Metrics

| Metric | Calculation |
|--------|-------------|
| **Total supply** | `totalSupply()` — call directly on the token contract |
| **Circulating supply** | Total supply - locked - vesting - burned - treasury |
| **Locked supply** | Scan for known lock/vesting contract balances (e.g., Team Finance, Unicrypt, custom timelocks). Sum `balanceOf(lock_contract)` for each identified lock contract. |
| **Burned supply** | `balanceOf(0x0000000000000000000000000000000000000000)` + `balanceOf(0x000000000000000000000000000000000000dEaD)` + cumulative explicit burn events (Transfer events where `to` is the zero address or the dead address). Some tokens also have dedicated `Burn` events — check the contract ABI. |

**Circulating supply breakdown:** Always present the full decomposition so the reader can verify the arithmetic. If any component is unknown or unverifiable, flag it explicitly rather than silently omitting it.

---

## 3. Mint/Burn Accounting

Transfer events encode mints and burns as special-case transfers:

- **Mints:** `from = 0x0000000000000000000000000000000000000000`. The `value` field is newly created supply. Include these in total supply tracking.
- **Burns:** `to = 0x0000000000000000000000000000000000000000` or `to = 0x000000000000000000000000000000000000dEaD`. The `value` field is destroyed supply. Subtract from circulating supply.

Track the **mint/burn rate over time** by bucketing events into daily or weekly windows. Present as a time series:

- Net emission rate = mints - burns per period
- Cumulative inflation/deflation curve
- Sudden spikes in minting (potential exploit or unannounced emission schedule change) deserve explicit callout

Cross-check: `totalSupply()` at any block should equal genesis supply + cumulative mints - cumulative burns. If it does not, the token has non-standard supply mechanics that require deeper investigation.

---

## 4. Whale Behavior Patterns

Four core patterns to track for any address in the top holder tier:

1. **Accumulation:** Steady balance increases over multiple blocks or days. Look for recurring inflows from DEX routers or OTC addresses. Often precedes governance proposals or price catalysts the whale may have insight into.

2. **Distribution:** Systematic selling indicated by declining balance over time. Watch for transfers to DEX routers, aggregator contracts, or direct exchange deposits. Gradual distribution (many small sells) is harder to detect than a single large dump but often more impactful in aggregate.

3. **Exchange movements:**
   - Transfer **to** a known exchange deposit address = potential sell signal. The token is being staged for a market sell.
   - Transfer **to** a cold storage or multisig address = long-term hold signal. The holder is moving tokens off-exchange into custody.
   - Maintain a labeled address set of major exchange hot wallets and deposit addresses for accurate classification.

4. **Dormant activation:** A whale address that has been inactive for an extended period (no outbound transfers for 90+ days) suddenly resumes activity. This is a significant signal — dormant whales moving tokens often precedes large price action. Flag any dormant address reactivation with the dormancy duration and the size of the position being moved.

---

## 5. Rebasing Token Detection

**How to detect:** Query `balanceOf(address)` for a set of known holder addresses at block N and block N+K (where K is a reasonable interval, e.g., 100 blocks). If the balance changes without any corresponding `Transfer` events involving that address in blocks N through N+K, the token is a rebasing token.

**Implications:** Standard balance tracking via Transfer event replay breaks completely. The balance map built in Section 1 will drift from reality because rebases silently adjust all holder balances proportionally without emitting individual Transfer events.

**Mitigation:** Use the token's internal accounting unit (shares) instead of raw balances. For example:
- **stETH (Lido):** Use `sharesOf(address)` instead of `balanceOf(address)`. Shares remain constant; the ETH-denominated balance fluctuates with each oracle report.
- **aTokens (Aave):** Use `scaledBalanceOf(address)` for the underlying share amount. The displayed balance grows continuously as interest accrues.

When reporting balances for rebasing tokens, always present both the share amount (stable, comparable over time) and the current rebased balance (what the holder could actually transfer today).

---

## 6. Fee-on-Transfer Detection

**How to detect:** Compare the `value` field in a Transfer event with the actual `balanceOf` delta on the receiving address. Execute these steps:
1. Record `balanceOf(receiver)` at the block before the transfer.
2. Observe the Transfer event `value` field.
3. Record `balanceOf(receiver)` at the block of (or after) the transfer.
4. If `actual_received = balanceOf_after - balanceOf_before < event_value`, the token has a transfer tax.

Typical fee-on-transfer rates range from 1% to 15%. Some tokens have variable fees (different buy vs. sell tax, or time-decaying fees).

**Implications:** PnL calculations must use the **actual received amount**, not the Transfer event amount. Using the event amount will systematically overstate inflows and understate the effective cost basis. This compounds across multiple trades and can produce materially wrong PnL figures.

When a fee-on-transfer token is detected, annotate all subsequent analysis with the observed fee rate and note that all balance/PnL figures use actual received amounts.

---

## 7. Vesting Schedule Tracking

**Scan for known vesting contract patterns:**
- **Linear vesting:** Tokens release at a constant rate per block or per second from start time to end time. The vesting contract's claimable balance decreases linearly.
- **Cliff + linear:** No tokens release until the cliff date, then linear vesting begins. Monitor for the cliff date approaching — this is when the first large unlock becomes claimable.

**Monitoring approach:**
1. Identify vesting contracts by scanning for known factory deployments (Sablier, LlamaPay, custom vesting contracts referenced in project documentation or governance proposals).
2. Track `balanceOf(vesting_contract)` over time. Step-function drops indicate claims; steady decline indicates streaming vesting.
3. Calculate the remaining locked amount and the unlock schedule going forward.

**Sell pressure estimation:** Track upcoming unlock events and estimate potential sell pressure by considering:
- Size of the unlock relative to daily trading volume
- Historical behavior of the beneficiary (did they sell previous unlocks immediately or hold?)
- Whether the beneficiary is a team wallet, investor wallet, or ecosystem fund (different behavioral profiles)

---

## 8. Sybil-Aware Active Address Metrics

A sudden spike in unique addresses interacting with a token can mean genuine adoption — or it can be entirely artificial.

**Detection approach:**
1. Track the count of unique addresses with non-zero balances over time. Flag any period where the growth rate exceeds 3x the trailing 30-day average.
2. Cross-reference flagged addresses with clustering heuristics from `wallet-analytics.md`. Look for:
   - Addresses funded by the same source within a short time window
   - Identical transaction patterns (same amounts, same timing intervals)
   - Addresses that all interact with the same set of contracts in the same order
3. Common causes of artificial spikes:
   - **Airdrop farming:** Many wallets performing minimum qualifying actions. Look for addresses that do exactly the minimum interaction and nothing more.
   - **Wash trading:** Tokens cycling between a cluster of addresses to inflate volume and holder count. The net flow within the cluster is zero.
   - **Sybil attacks on governance:** Many wallets accumulating just enough tokens to meet a voting threshold.

When reporting active address metrics, always present both the raw count and the sybil-adjusted estimate (after removing suspected artificial addresses).

---

## 9. Pitfall Pack

Before finalizing any token analytics report, verify each item:

- [ ] **Supply metrics account for locked/vesting/burned tokens?** Circulating supply must exclude locked, vesting, burned, and treasury-held tokens. Raw `totalSupply()` alone is insufficient and misleading.
- [ ] **Fee-on-transfer tax deducted from actual received amounts?** If the token charges a transfer fee, all PnL and balance calculations must use the post-fee amount, not the Transfer event value.
- [ ] **Sybil check — sudden active address spike legitimate or artifacted?** Any unusual growth in holder count or active addresses must be cross-referenced against clustering heuristics before reporting as genuine adoption.
- [ ] **Token contract upgrade history checked (supply manipulation risk)?** If the token uses a proxy pattern (TransparentProxy, UUPS, Beacon), review the implementation history. A past upgrade could have introduced unauthorized minting, changed fee logic, or altered supply mechanics. Check the proxy's implementation slot history and diff prior implementations.
