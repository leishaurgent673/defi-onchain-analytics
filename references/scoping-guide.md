# Phase 0 Scoping Guide — Detailed Reference

> Referenced from SKILL.md Phase 0. This file provides detailed consultation techniques, depth/angle options, and anti-patterns for the scoping conversation.

---

## Intent Discovery

Before collecting any fields, understand **why** the user wants this analysis. Use structured questions with options to guide them efficiently.

**Always ask — even if the user gives an address and says "check this":**

1. **What triggered this analysis?** _(determines analysis mode)_

   | Trigger | Mode | What it emphasizes |
   |---------|------|--------------------|
   | Suspicious activity / incident | 🔍 Forensic | Trace fund flows, timeline reconstruction, counterparty identification |
   | Investment / trading decision | 📊 Due Diligence | Risk metrics, PnL, position health, token economics |
   | Portfolio / position monitoring | 📈 Monitoring | Current state, health indicators, threshold alerts |
   | Protocol evaluation / comparison | 🏗️ Protocol Assessment | TVL composition, risk parameters, governance, upgrade history |
   | Security review / audit prep | 🛡️ Security | Admin keys, upgrade patterns, privileged functions, fund custody |
   | General curiosity / learning | 🔭 Exploratory | Broad survey, explain what's interesting, teach as you go |

   > Present these as options. If the user's request maps clearly to one mode, **propose it and ask for confirmation** rather than asking from scratch.

2. **What decision will the results inform?** _(determines depth and output format)_
   - Helps calibrate between "quick sanity check" vs "court-grade evidence trail"
   - If user says "just curious" → still ask: "Curious about what specifically? I can focus on [2-3 relevant angles based on the target]."

3. **What do you already know?** _(avoids redundant work, catches misconceptions early)_
   - "Is this address a protocol, a wallet, a token contract, or you're not sure?"
   - "Have you interacted with this before, or is it completely new to you?"
   - If user has a hypothesis → capture it; you'll test it explicitly in Phase 3.

---

## Approach Negotiation — Present Options with Trade-offs

Based on the intent, **proactively present 2-3 analysis approaches** with clear pros/cons. Don't ask the user to design the approach — propose and let them choose.

### Depth Options

| Option | What you get | Cost | Best for |
|--------|-------------|------|----------|
| 🟢 **Snapshot** — Current state only | Balance, positions, rates, health factors at one block | ~5-15 RPC calls, <1 min | Quick health check, "what does this address hold right now?" |
| 🟡 **Window** — Recent period (7d/30d/custom) | Behavioral patterns, trends, recent PnL | ~50-300 calls, needs log scanning | "What has this address been doing recently?" |
| 🔴 **Deep History** — Full lifecycle | Complete transaction history, total PnL, all counterparties | Hundreds-thousands of calls, may need archive node (Tier B) | Forensic investigation, full entity profiling |

### Angle Options

Present the 2-3 most relevant based on target type:

| Angle | Approach | Pros | Cons |
|-------|----------|------|------|
| **Top-down** | Protocol → pools → top addresses | Systematic, complete coverage | Misses cross-protocol activity |
| **Bottom-up** | Address → transactions → counterparties → protocols | Follows the money, catches hidden connections | Can spiral without bounds |
| **Comparative** | Side-by-side vs benchmark (similar protocols, top wallets) | Context-rich, relative assessment | Doubles the data collection work |
| **Hypothesis-driven** | Test a specific claim with targeted data | Efficient, focused | May miss unexpected findings |

> **Always recommend** one approach based on the user's stated intent. Explain why. Ask if they agree or want to adjust.

---

## Field Collection Guidance

Collect through natural dialogue. For **every** field the user doesn't specify, state your default assumption and ask for confirmation.

| # | Field | How to ask |
|---|-------|------------|
| 1 | **Target** | If ambiguous: "I see an address — is this the main target, or should I also look at related contracts (e.g., the protocol's router, vault, or governance)?" |
| 2 | **Chain** | Infer from address context if possible. If unclear: "Which chain? Ethereum / Arbitrum / Base / BSC / Polygon / Katana — or multiple?" |
| 3 | **Objective** | Derived from Intent Discovery. Restate in your own words: "So your main question is: [restatement]. Is that right?" |
| 4 | **Hypothesis** | "Do you have a specific theory to test? (e.g., 'this wallet is connected to X', 'this protocol is under-collateralized') Or should I explore with fresh eyes?" |
| 5 | **Timeframe** | "Based on [chosen depth], I'll look at [timeframe]. Want to adjust?" |
| 6 | **Expected output** | "How should I deliver results? Options: **(a)** Quick summary with key metrics. **(b)** Full report with evidence trail. **(c)** Raw data tables." |
| 7 | **Data source policy** | "I'll use **raw RPC only** (highest confidence). Want me to also pull from Etherscan/Sourcify for labels and source code? Adds context but introduces external trust." |
| 8 | **Anchor policy** | Only explain if the user is technical: "`safe` = finalized, no reorg risk. `latest` = freshest but could reorg. `historical-scan` = full-chain event scanning. I'll default to `safe`." |

---

## Blind Spot Disclosure Templates

**Before confirming, proactively flag what the analysis CANNOT see:**

- "⚠️ On-chain analysis can't see: CEX internal transfers, OTC deals, off-chain agreements, L2 activity (unless we scope those chains too)."
- If Tier A only: "Without archive/trace access, I won't capture native ETH internal transfers or historical state. I'll flag where this matters."
- If no enrichment: "Without Etherscan labels, addresses will be raw hex — I'll note patterns but can't name entities."

> This prevents users from over-trusting results and sets expectations early.

---

## Anti-Patterns — STOP if you catch yourself doing these

| ❌ Anti-pattern | ✅ Instead |
|----------------|-----------|
| Dumping all 10 fields as a form | Ask 2-3 targeted questions based on what user already provided |
| Silently defaulting hypothesis to "Exploratory" | Ask: "Any specific theory to test, or explore broadly?" |
| Assuming output format | Offer options with one-line descriptions of each |
| Proceeding without confirmation | Always present the analysis plan and wait |
| Not disclosing blind spots | Flag limitations upfront — users trust you more when you're honest about gaps |
| Over-questioning when user is clearly expert | Match the user's sophistication — experts need fewer explanations, more options |
