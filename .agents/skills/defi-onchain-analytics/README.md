# defi-onchain-analytics

An AI agent skill for conducting DeFi on-chain analysis using direct JSON-RPC calls.

## What This Skill Does

* Profiles wallet behavior and asset allocation.
* Analyzes protocol-level state and governance participation.
* Tracks token metrics and liquidity pool performance.
* Inspects smart contract bytecode and storage slots.
* Performs trace-based debugging for complex transactions.

## Supported Chains

| Chain | Chain ID | Public RPC Endpoints | Benchmark Date |
| :--- | :--- | :--- | :--- |
| Ethereum | 1 | 24 | 2026-03-21 |
| Arbitrum One | 42161 | 14 | 2026-03-21 |
| Base | 8453 | 22 | 2026-03-21 |
| BSC | 56 | 26 | 2026-03-21 |
| Polygon PoS | 137 | 14 | 2026-03-21 |
| Katana | 747474 | 5 | 2026-03-21 |

Note: BSC endpoints require handling specific getLogs limitations.

## Installation

**For Claude Code**

`claude mcp add-skill git@github.com:Omnis-Labs/defi-onchain-analytics.git`

**For OpenCode**

`git clone git@github.com:Omnis-Labs/defi-onchain-analytics.git ~/.claude/skills/defi-onchain-analytics`

**Manual Installation**

Clone this repository directly into your local skills directory.

## Skill Structure

* `SKILL.md`: Skill definition and configuration.
* `patterns/`: Analytical templates for wallets, protocols, tokens, and contracts.
* `references/`: ABIs, common contract references, RPC guides, and endpoint registry.

## How It Works

1. **Scoping Gate**: Define analytical objectives and identify data requirements.
2. **Reconnaissance**: Determine target contracts and relevant storage locations.
3. **Data Collection**: Fetch data via typed JSON-RPC requests.
4. **Interpretation**: Decode retrieved data using verified ABI mappings.
5. **Sanity Check**: Validate findings against known chain state.
6. **Synthesis**: Generate structured insights and narratives.

## RPC Endpoint Registry

The `references/rpc-endpoints.ts` file contains 108 verified endpoints. The skill employs an auto-selection algorithm to identify optimal endpoints based on availability. All entries were verified via eth_chainId probe on 2026-03-21.

## Contributing

Contributions are welcome. Submit pull requests to add new RPC endpoints, improve pattern files, or extend support for additional EVM chains.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
