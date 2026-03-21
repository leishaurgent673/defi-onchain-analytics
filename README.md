# DeFi On-Chain Analytics

An AI agent skill for conducting DeFi on-chain analysis using direct JSON-RPC calls. No APIs, no indexers — raw RPC to verifiable insights.

## Install

```bash
npx skills add Omnis-Labs/defi-onchain-analytics
```

Or manually:
```bash
git clone https://github.com/Omnis-Labs/defi-onchain-analytics.git ~/.claude/skills/defi-onchain-analytics
```

## What This Skill Does

Guides AI agents through a structured 6-phase workflow for on-chain DeFi analysis:

1. **Scoping Gate** — Define objectives, anchor policy, and data source constraints
2. **Reconnaissance** — Contract classification, proxy detection, address context
3. **Data Collection** — Batch reads, event log scanning, adaptive chunking, traces
4. **Interpretation** — Classification-first analysis with multi-pass adversarial review
5. **Sanity Check** — Cross-validation, blind spot audit, gap logging
6. **Synthesis** — Structured findings, confidence matrix, reproducibility footer

### Capabilities

- **Wallet profiling** — Balance snapshots, transfer history, entity clustering, funding trace
- **Protocol analysis** — TVL decomposition, admin risk, oracle health, governance participation
- **DEX analytics** — LP position analysis, owner resolution, market structure, bot detection
- **Token metrics** — Supply audit, holder concentration, vesting schedules
- **Contract inspection** — Proxy detection, storage layout, event decoding, ABI resolution

## Supported Chains

| Chain | Chain ID | Public RPC Endpoints | Benchmark Date |
|:---|:---|:---|:---|
| Ethereum | 1 | 24 | 2026-03-21 |
| Arbitrum One | 42161 | 14 | 2026-03-21 |
| Base | 8453 | 22 | 2026-03-21 |
| BSC | 56 | 26 | 2026-03-21 |
| Polygon PoS | 137 | 14 | 2026-03-21 |
| Katana | 747474 | 5 | 2026-03-21 |

108 verified endpoints with tier rankings, latency data, and `getLogs` support markers.

## Skill Architecture

```
SKILL.md                    Main workflow (364 lines)
├── references/
│   ├── rpc-field-guide.md      RPC methods, chunking, L2 guide, explorer APIs
│   ├── rpc-endpoints.ts        108 verified endpoints across 6 chains
│   ├── common-abis.md          ERC-20/721/1155/4626, V3/V4, Algebra CLAMM
│   ├── abi-fetching.md         Proxy detection and ABI resolution
│   ├── scoping-guide.md        Phase 0 detailed consultation guide
│   └── investigation-discipline.md  7-layer anti-shortcutting defense
└── patterns/
    ├── wallet-analytics.md     Address clustering, funding trace, Sybil detection
    ├── protocol-analytics.md   TVL, lending health, oracle monitoring
    ├── token-analytics.md      Supply audit, holder analysis
    ├── dex-analytics.md        V3 math, LP resolution, bot signals
    └── contract-inspection.md  Storage layout, proxy patterns, event decoding
```

## Key Features

### 4-Tier Data Confidence System

| Tier | Tag | Requires | Free Public RPC? |
|------|-----|----------|:---:|
| A | `[CORE]` | Standard JSON-RPC | Yes |
| B | `[ARCHIVE]` | Historical state >128 blocks | Rarely |
| C | `[TRACE]` | debug/trace namespace | No |
| D | `[ENRICH]` | External source (Etherscan, Sourcify) | Yes (not RPC) |

Every finding is tagged with its data source tier. Unavailable tiers are disclosed, never silently skipped.

### 7-Layer Investigation Discipline

Prevents AI agents from taking analytical shortcuts:

1. **Anti-Rationalization** — Banned dismissal phrases that trigger deeper investigation
2. **Iterative Depth** — Multi-pass analysis with adversarial re-examination
3. **Anti-Normalization** — "Looks normal" is sophistication, not innocence
4. **Blind Spot Audit** — Mandatory disclosure of what was NOT investigated
5. **Confidence Deepening** — Low confidence on significant findings → must dig deeper
6. **Adversarial Self-Review** — Devil's Advocate questions per finding
7. **Gap Logging** — Every skipped method logged with impact

### Adaptive RPC Chunking

Production-ready `eth_getLogs` chunking with:
- Per-provider block range limit table (Alchemy, Infura, dRPC, etc.)
- Error code recognition (`-32005`, `-32602`, `-32614`)
- TypeScript + viem code template with bisection
- Block explorer API fallback (Blockscout, Etherscan)

### Protocol Coverage

- **Uniswap V3/V4** — Full ABI reference, math formulas, position analytics
- **Algebra CLAMM** — Delta vs V3 (Camelot, QuickSwap, Katana DEX)
- **ERC-4626 Vaults** — Share/asset conversion, deposit/withdraw analysis
- **L2 Chains** — Block cadence, finality semantics, bridge tracing

## Compatible Agents

Works with any agent that supports the skills format:
- [Claude Code](https://claude.com/product/claude-code)
- [OpenCode](https://opencode.ai/)
- [Cursor](https://cursor.sh)
- [Cline](https://cline.bot/)
- [Windsurf](https://codeium.com/windsurf)
- And [more on skills.sh](https://skills.sh)

## Contributing

Contributions welcome. The most impactful contributions are:

- **New chain endpoints** — Add verified RPC endpoints to `references/rpc-endpoints.ts`
- **Pattern expansions** — Extend analytical methods in `patterns/` files
- **ABI references** — Add protocol ABIs to `references/common-abis.md`
- **Bug reports** — Real-world cases where the skill gave incorrect guidance

## License

[MIT](LICENSE)
