# Investigation Discipline — 7-Layer Defense Against Analytical Shortcuts

> Referenced from SKILL.md. Detailed methodology for each defense layer.
> Inspired by adversarial verification architectures used in security audit agent systems.

## Contents
- [Why This Exists](#why-this-exists)
- [Layer 1: Anti-Rationalization](#layer-1-anti-rationalization--dismissal--investigation-signal)
- [Layer 2: Iterative Depth](#layer-2-iterative-depth--multi-pass-analysis)
- [Phase 3 → Phase 4 Exit Gate](#phase-3--phase-4-exit-gate--artifact-based)
- [Layer 3: Anti-Normalization](#layer-3-anti-normalization--sophistication-looks-normal)
- [Layer 4: Blind Spot Audit](#layer-4-blind-spot-audit--what-you-didnt-investigate)
- [Layer 5: Confidence-Triggered Deepening](#layer-5-confidence-triggered-deepening)
- [Layer 6: Adversarial Self-Review](#layer-6-adversarial-self-review--devils-advocate)
- [Layer 7: Gap Logging](#layer-7-gap-logging--no-silent-omissions)

---

## Why This Exists

LLM agents have systematic failure modes in analytical work:
- Accept surface-level explanations ("looks normal")
- Stop investigating when initial hypotheses seem confirmed
- Dismiss anomalies that don't fit the current narrative
- Rationalize incomplete coverage as sufficient

These 7 layers create structural resistance against each failure mode. They activate at different phases and different analysis modes.

---

## Layer 1: Anti-Rationalization — Dismissal = Investigation Signal

**The instinct to dismiss is often the instinct to miss.**

### Banned Dismissal Phrases

If any of these appear in your reasoning during Phase 3 or Phase 4, **STOP** — treat the dismissed item as a priority investigation target:

| Banned Phrase | Why It's Dangerous | Required Action |
|---|---|---|
| "probably just a whale" | Whales can be insiders, manipulators, or wash traders | Profile the wallet: nonce, funding source, counterparties |
| "likely normal behavior" | "Normal" without a quantified baseline is an assumption | Define the baseline with on-chain data. What's the mean, the distribution? |
| "this is expected for a DEX pool" | Assumptions mask anomalies in complex systems | Specify WHICH aspect is expected. Cite the on-chain evidence. |
| "no suspicious activity found" | Absence of evidence ≠ evidence of absence | List what you checked AND what you didn't check |
| "the amounts are not unusual" | "Unusual" requires a reference frame | Compare against: pool TVL, daily volume, historical distribution |
| "this appears to be a legitimate protocol" | Legitimacy requires verification | Check: verified source? Audit history? TVL trajectory? |
| "this is just MEV / arbitrage" | MEV can mask deliberate manipulation or insider activity | Trace the MEV actor: who profits? Related to protocol team? |
| "the timing is coincidental" | Temporal correlation is one of the strongest on-chain signals | Quantify: what's the probability of this timing by chance? |

### Methodological Rationalizations

If any of these appear in your workflow during Phase 1-4, **STOP** — treat it as a process failure that must be corrected before interpretation continues:

| Banned Phrase | Why It's Dangerous | Required Action |
|---|---|---|
| "Etherscan shows the same thing" | Tier D substituting Tier A creates unverifiable dependency and confidence drift | Query the equivalent RPC method; Tier D remains enrichment only |
| "The [security firm/report] already explains this" | External assertion displaces on-chain falsification and halts evidence building | Define what Tier A/B evidence would confirm or deny the claim, then query it |
| "I have enough to write the report" | Narrative completion bias terminates investigation before causal validation | Check every causal claim for Tier A/B backing before synthesis |
| "The fund flow is clear enough" | Partial-flow closure hides intermediate hops, bridges, or native ETH paths | Require hop-level evidence (tx hash + log index/trace path) and disclose missing legs |

### Self-Check Protocol

Before advancing from Phase 3 to Phase 4:
1. Review findings and note every instance where you dismissed or de-prioritized a data point
2. For each dismissal, ask: "Am I dismissing this because I have **evidence**, or because investigating further would be **effortful**?"
3. If the answer is "effort" → investigate it

---

## Layer 2: Iterative Depth — Multi-Pass Analysis

### Activation

| Mode | Passes Required |
|------|----------------|
| 🔍 Forensic | Pass 1 + Pass 2 (mandatory). Pass 3 if Pass 2 reveals new leads. |
| 🔴 Deep History | Pass 1 + Pass 2 (mandatory). |
| All other modes | Pass 1 + Adversarial Self-Review (Layer 6). |

### Pass 1: Standard Interpretation

Normal Phase 3 analysis per the domain pattern file. Produce initial findings with confidence tags.

### Pass 2: Adversarial Re-Examination

For each finding from Pass 1:
- **If "normal/benign"**: Assume it IS malicious. What evidence would you expect? Does any exist?
- **If "suspicious"**: Assume it IS innocent. What evidence would you expect? Does that exist?
- **For all findings**: What **adjacent pattern** does this analysis OBSCURE?

### Pass 3: Triggered Deepening

Only if Pass 2 produces new findings or substantially changes confidence. Hard cap: 3 passes.

### Anti-Dilution Rules

Between passes, carry forward ONLY:
- Finding ID, location, evidence references
- Confidence level
- A focused investigation question for the next pass

Do NOT carry forward: conclusions, narratives, or interpretive framing. Each pass reasons from evidence, not prior conclusions. This prevents confirmation bias from compounding across passes.

---

## Phase 3 → Phase 4 Exit Gate — Artifact-Based

Phase 3 cannot close on narrative confidence. It closes only when claims and dismissals are converted into auditable artifacts.

### Claim Typing (mandatory per significant finding)

| Claim Type | Definition | Rule |
|---|---|---|
| `FACT_ONCHAIN` | Directly proven by Tier A/B artifact (state read, receipt, log, proof) | Include artifact reference (method + block + tx/log pointer) |
| `INFERENCE_ONCHAIN` | Reasoned conclusion derived from Tier A/B artifacts | Include explicit supporting artifacts + falsification condition |
| `EXTERNAL_ASSERTION` | Claim sourced from Tier D (labels, reports, media, commentary) | Cannot serve as root cause unless corroborated by Tier A/B; else tag `[UNVERIFIED]` |

### Exit Gate Checklist (hard gate before Phase 4)

- [ ] Dismissal Log completed: every dismissed/de-prioritized anomaly recorded with reason
- [ ] Every major causal claim typed: `FACT_ONCHAIN` / `INFERENCE_ONCHAIN` / `EXTERNAL_ASSERTION`
- [ ] Any `EXTERNAL_ASSERTION` used as root cause is either upgraded with Tier A/B evidence or explicitly tagged `[UNVERIFIED]`
- [ ] At least one adversarial counter-hypothesis documented per major causal claim
- [ ] Layer 6 adversarial questions answered for each significant finding

---

## Layer 3: Anti-Normalization — Sophistication Looks Normal

### Principle

In DeFi analysis, "looks normal" is evidence of sophistication, not innocence. Adversarial actors design on-chain footprints to appear normal.

### Red Flags for "Too Normal"

| Signal | Why Suspicious | Investigation |
|--------|---------------|---------------|
| Perfect timing (actions at exact intervals) | Humans are irregular; machines are precise | Check nonce progression, tx spacing distribution |
| Round numbers (exactly 1.0 ETH, 10000 USDC) | Natural transactions have irregular amounts | Compare against pool's typical transaction size distribution |
| Textbook LP behavior in unusual context | Passive LP in a new, illiquid pool is unusual | Profile the LP: when did they arrive? What else do they do? |
| Zero failed transactions | Real users make mistakes; bots don't | Check `eth_getTransactionCount` vs successful tx count |
| Single-purpose wallet | Only interacts with one protocol | Trace funding source, check for sibling wallets |

### Application Rules

- **"By design" dismissals** require code-level evidence. Read the actual contract logic before claiming something is "designed that way."
- **Statistical normality** of individual data points does not prove collective normality. Each transaction may be normal-sized, but the frequency pattern or temporal clustering may be machine-like.
- **Clean patterns in messy environments** are the strongest anomaly signal. If a pool has chaotic activity but one actor's behavior is perfectly regular → investigate that actor.

---

## Layer 4: Blind Spot Audit — What You Didn't Investigate

### Phase 4 Mandatory Output

Before advancing to Phase 5, produce this table. **Empty blind spot audit = failed Phase 4.**

```
=== BLIND SPOT AUDIT ===
| Area NOT Investigated | Reason | What Could Be Hiding |
|---|---|---|
| Native ETH internal transfers | Tier C unavailable | Hidden fund flows between contracts |
| Cross-chain activity | Single-chain scope | Bridged funds, multi-chain obfuscation |
| Historical state before block X | Archive node required | Earlier positions, deleted evidence |
| Mempool / private transactions | Not accessible via RPC | Front-running, sandwich attacks |
| Off-chain governance / multisig actions | On-chain only | Coordinated off-chain decisions |
| [add investigation-specific gaps] | | |
```

### Why This Matters

Plausible deniability lives in blind spots. An adversarial actor who knows which data you can't see will operate in exactly those gaps. By documenting blind spots, you:
1. Prevent users from over-trusting results
2. Guide follow-up investigations to the highest-value areas
3. Create accountability for what was and wasn't examined

---

## Layer 5: Confidence-Triggered Deepening

### Rule

Any finding where **confidence < High** AND **significance ≥ Medium** MUST undergo:

| Option | Method | Goal |
|--------|--------|------|
| A | Additional RPC query — different method or angle on same data | Upgrade evidence basis |
| B | Cross-validation — compare event logs vs state reads, or two independent data sources | Corroborate or contradict |
| C | Explicit UNRESOLVED — promote to Open Questions with specific follow-up query | Flag for user attention |

**Settling for "Medium confidence, probably fine" on significant findings is not acceptable.**

### Confidence Resolution Table

| Current Confidence | Significance | Required Action |
|---|---|---|
| Highest / High | Any | No action needed |
| Medium | High+ | MUST attempt cross-validation (Option A or B) |
| Medium | Medium | Should attempt cross-validation; if unable, Option C |
| Low | Any ≥ Medium | MUST attempt upgrade; if unable, MUST use Option C |
| Contested | Any | Present both interpretations with evidence for each |

---

## Layer 6: Adversarial Self-Review — Devil's Advocate

### 4 Mandatory Questions (per major finding)

Before finalizing Phase 3, answer these for **each significant finding**:

1. **"What is the opposite interpretation of this data?"**
   - Concluded "whale accumulation"? → What if it's insider front-running?
   - Concluded "MEV bot"? → What if it's a protocol-affiliated market maker?

2. **"What adjacent pattern does this analysis obscure?"**
   - By focusing on token X flows, did you miss token Y flows in the same transactions?
   - By focusing on this wallet, did you miss the wallet it's interacting with?

3. **"What evidence would falsify my conclusion?"**
   - State the specific data that would prove you wrong
   - Did you look for that data? If not, why not?

4. **"Does any OTHER finding enable or amplify this one?"**
   - Cross-reference findings. Two "minor" anomalies = potentially major
   - Check: does finding A create the precondition for finding B?

### Forensic Mode Requirement

In 🔍 Forensic mode, the adversarial self-review MUST be documented in the evidence register, not just performed mentally. Each major finding gets an "Adversarial Review" subsection showing the 4 questions and their answers.

---

## Layer 7: Gap Logging — No Silent Omissions

### Rule

Every skipped RPC method, unavailable data source, or abbreviated analysis step is logged with:
1. **What** was skipped (specific method or analysis step)
2. **Why** (tier unavailable, rate limited, out of scope)
3. **What it could have revealed** (the blind spot created)

### Format (in reproducibility footer or separate section)

```
=== GAP LOG ===
| Skipped | Reason | Potential Impact |
|---|---|---|
| debug_traceTransaction | Tier C unavailable | Native ETH internal transfers invisible |
| Full history scan (blocks 0-15M) | Used blocks 15M-27M only (RPC range limit) | Earlier activity missed |
| Token Y analysis | Out of Phase 0 scope | Cross-token interactions unexamined |
| Contract source verification | Tier D not enabled | Cannot confirm contract behavior matches expectation |
```

### Anti-Pattern

```
❌ "I analyzed the wallet's activity."
   (Without specifying what WAS and WASN'T done)

✅ "I analyzed the wallet's ERC-20 transfers via eth_getLogs (blocks 15M-27M).
    Native ETH transfers NOT analyzed (Tier C unavailable).
    Cross-chain activity NOT checked (single-chain scope).
    Activity before block 15M NOT scanned (RPC range limit)."
```

Silent omission — reporting a conclusion without disclosing what analysis was NOT performed — is the single most dangerous failure mode in on-chain analytics. It creates false confidence in incomplete results.
