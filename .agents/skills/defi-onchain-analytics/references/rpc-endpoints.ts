/**
 * Public RPC Endpoint Registry
 *
 * Verified public RPC endpoints for all supported EVM chains.
 * Benchmark: Asia-Pacific (Taiwan), March 2026.
 *
 * Auto-selection: pick first reachable endpoint from tier "S"/"1",
 * fall back through tiers. Always configure 3+ endpoints for redundancy.
 *
 * Tier definitions:
 *   S/1 — Production-grade, full API, low latency (<500ms from APAC)
 *   A/2 — Reliable, full API, moderate latency (500-1000ms)
 *   B/3 — Usable with caveats (high latency, partial API, shared keys)
 *   W   — Warning: known issues, use only as last resort
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tier = "S" | "A" | "B" | "W" | "1" | "2" | "3";

export interface RpcEndpoint {
  provider: string;
  url: string;
  tier: Tier;
  /** Average latency in ms from APAC benchmark (null = not benchmarked) */
  latencyMs: number | null;
  /** Supports eth_getLogs */
  getLogs: boolean;
  /** Free-form notes */
  notes?: string;
}

export interface ChainRpcConfig {
  chainId: number;
  name: string;
  /** Important caveats for the chain's RPC landscape */
  caveats?: string;
  /** Benchmark metadata */
  benchmark?: { date: string; location: string; endpointsTested: number };
  endpoints: RpcEndpoint[];
  /** Top 3 recommended fallback URLs in priority order */
  fallbacks: [string, string, string];
  /** Testnet endpoints (optional) */
  testnets?: {
    name: string;
    chainId: number;
    endpoints: Pick<RpcEndpoint, "provider" | "url" | "latencyMs">[];
  }[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const RPC_REGISTRY: Record<number, ChainRpcConfig> = {

  // =========================================================================
  // Ethereum (Chain ID: 1)
  // =========================================================================
  1: {
    chainId: 1,
    name: "Ethereum",
    fallbacks: [
      "https://ethereum-mainnet.gateway.tatum.io/",
      "https://1rpc.io/eth",
      "https://ethereum.publicnode.com/",
    ],
    endpoints: [
      // --- Tier S ---
      { provider: "Tatum",       url: "https://ethereum-mainnet.gateway.tatum.io/",                    tier: "S", latencyMs: null, getLogs: true, notes: "Free tier, no API key needed" },
      { provider: "1RPC",        url: "https://1rpc.io/eth",                                           tier: "S", latencyMs: null, getLogs: true, notes: "Privacy-preserving relay (Automata Network)" },
      { provider: "PublicNode",  url: "https://ethereum.publicnode.com/",                               tier: "S", latencyMs: null, getLogs: true, notes: "Free, privacy-focused" },
      { provider: "Tenderly",    url: "https://mainnet.gateway.tenderly.co",                            tier: "S", latencyMs: null, getLogs: true, notes: "80+ chains, 99.99% SLA" },
      // --- Tier A ---
      { provider: "dRPC",        url: "https://eth.drpc.org/",                                          tier: "A", latencyMs: null, getLogs: true, notes: "Decentralized, MEV protection" },
      { provider: "thirdweb",    url: "https://ethereum.rpc.thirdweb.com/",                             tier: "A", latencyMs: null, getLogs: true, notes: "150+ edge locations" },
      { provider: "LlamaNodes",  url: "https://eth.llamarpc.com",                                      tier: "A", latencyMs: null, getLogs: true, notes: "Privacy RPC" },
      { provider: "Nodies",      url: "https://ethereum-public.nodies.app",                             tier: "A", latencyMs: null, getLogs: true, notes: "POKT decentralized relay" },
      { provider: "BlockPI",     url: "https://ethereum.public.blockpi.network/v1/rpc/public",          tier: "A", latencyMs: null, getLogs: true, notes: "Distributed network" },
      { provider: "Polkachu",    url: "https://ethereum-rpc.polkachu.com/",                             tier: "A", latencyMs: null, getLogs: true, notes: "Validator-operated" },
      { provider: "0xRPC",       url: "https://0xrpc.io/eth",                                           tier: "A", latencyMs: null, getLogs: true },
      // --- Tier B ---
      { provider: "Flashbots",   url: "https://rpc.flashbots.net/fast",                                 tier: "B", latencyMs: null, getLogs: true, notes: "MEV protection, may add latency" },
      { provider: "MEV Blocker", url: "https://rpc.mevblocker.io",                                      tier: "B", latencyMs: null, getLogs: true, notes: "MEV protection" },
      { provider: "Cloudflare",  url: "https://cloudflare-eth.com/v1/mainnet",                          tier: "B", latencyMs: null, getLogs: true, notes: "CDN-backed" },
      { provider: "bloXroute",   url: "https://eth-protect.rpc.blxrbdn.com/",                           tier: "B", latencyMs: null, getLogs: true, notes: "Frontrunning protection" },
      // OMNIA removed 2026-03-21: HTTP 521 server down
      { provider: "OnFinality",  url: "https://eth.api.onfinality.io/public",                           tier: "B", latencyMs: null, getLogs: true, notes: "May rate-limit" },
      { provider: "SubQuery",    url: "https://ethereum.rpc.subquery.network/public",                   tier: "B", latencyMs: null, getLogs: true, notes: "Decentralized network" },
      { provider: "Pocket",      url: "https://eth.api.pocket.network/",                                tier: "B", latencyMs: null, getLogs: true, notes: "Decentralized relay" },
      { provider: "Stakely",     url: "https://ethereum-json-rpc.stakely.io/",                          tier: "B", latencyMs: null, getLogs: true },
      { provider: "Reddio",      url: "https://eth-mainnet.reddio.com/",                                tier: "B", latencyMs: null, getLogs: true },
      { provider: "merkle",      url: "https://eth.merkle.io/",                                         tier: "B", latencyMs: null, getLogs: true, notes: "MEV protection" },
      { provider: "LeoRPC",      url: "https://eth.leorpc.com/?api_key=FREE",                           tier: "B", latencyMs: null, getLogs: true, notes: "Embedded free key" },
      { provider: "NOWNodes",    url: "https://public-eth.nownodes.io/",                                tier: "B", latencyMs: null, getLogs: true },
      { provider: "Node RPC",    url: "https://api.noderpc.xyz/rpc-mainnet/public",                     tier: "B", latencyMs: null, getLogs: true },
    ],
  },

  // =========================================================================
  // Arbitrum One (Chain ID: 42161)
  // =========================================================================
  42161: {
    chainId: 42161,
    name: "Arbitrum One",
    fallbacks: [
      "https://1rpc.io/arb",
      "https://arbitrum.gateway.tenderly.co/",
      "https://arbitrum-one.publicnode.com/",
    ],
    endpoints: [
      // --- Tier S ---
      { provider: "1RPC",         url: "https://1rpc.io/arb",                                            tier: "S", latencyMs: null, getLogs: true, notes: "Privacy relay" },
      { provider: "Tenderly",     url: "https://arbitrum.gateway.tenderly.co/",                           tier: "S", latencyMs: null, getLogs: true, notes: "Stable, 99.99% SLA" },
      { provider: "PublicNode",   url: "https://arbitrum-one.publicnode.com/",                            tier: "S", latencyMs: null, getLogs: true, notes: "Free, privacy-focused" },
      { provider: "Arbitrum.io",  url: "https://arb1.arbitrum.io/rpc",                                   tier: "S", latencyMs: null, getLogs: true, notes: "Official Arbitrum endpoint" },
      // --- Tier A ---
      { provider: "dRPC",         url: "https://arbitrum.drpc.org/",                                      tier: "A", latencyMs: null, getLogs: true, notes: "Decentralized; free tier may rate-limit getBlock" },
      { provider: "thirdweb",     url: "https://arbitrum.rpc.thirdweb.com/",                              tier: "A", latencyMs: null, getLogs: true, notes: "Global edge network" },
      { provider: "Nodies",       url: "https://arbitrum-one-public.nodies.app",                          tier: "A", latencyMs: null, getLogs: true, notes: "POKT relay" },
      { provider: "BlockPI",      url: "https://arbitrum.public.blockpi.network/v1/rpc/public",           tier: "A", latencyMs: null, getLogs: true, notes: "Distributed" },
      { provider: "Lava",         url: "https://arbitrum.lava.build/",                                    tier: "A", latencyMs: null, getLogs: true, notes: "Decentralized RPC protocol" },
      // --- Tier B ---
      { provider: "Fastnode",     url: "https://public-arb-mainnet.fastnode.io/",                         tier: "B", latencyMs: null, getLogs: true },
      // OMNIA removed 2026-03-21: HTTP 521 server down
      { provider: "OnFinality",   url: "https://arbitrum.api.onfinality.io/public",                       tier: "B", latencyMs: null, getLogs: true, notes: "May rate-limit" },
      { provider: "SubQuery",     url: "https://arbitrum.rpc.subquery.network/public",                    tier: "B", latencyMs: null, getLogs: true, notes: "Decentralized" },
      { provider: "Pocket",       url: "https://arb-one.api.pocket.network/",                             tier: "B", latencyMs: null, getLogs: true, notes: "High latency from Asia" },
      { provider: "LeoRPC",       url: "https://arb.leorpc.com/?api_key=FREE",                            tier: "B", latencyMs: null, getLogs: true, notes: "Embedded free key" },
    ],
  },

  // =========================================================================
  // Base (Chain ID: 8453)
  // =========================================================================
  8453: {
    chainId: 8453,
    name: "Base",
    benchmark: { date: "2026-03-12", location: "Taiwan", endpointsTested: 51 },
    fallbacks: [
      "https://base-mainnet.gateway.tatum.io",
      "https://1rpc.io/base",
      "https://base.gateway.tenderly.co",
    ],
    endpoints: [
      // --- Tier S (production-grade, ≤500ms) ---
      { provider: "Tatum",           url: "https://base-mainnet.gateway.tatum.io",                       tier: "S", latencyMs: 183,  getLogs: true, notes: "Fastest & most stable; free tier, no API key" },
      { provider: "1RPC",            url: "https://1rpc.io/base",                                        tier: "S", latencyMs: 190,  getLogs: true, notes: "Privacy relay, ultra-stable (8ms jitter)" },
      { provider: "Tenderly",        url: "https://base.gateway.tenderly.co",                            tier: "S", latencyMs: 229,  getLogs: true, notes: "Also: https://gateway.tenderly.co/public/base" },
      { provider: "Sentio",          url: "https://rpc.sentio.xyz/base",                                 tier: "S", latencyMs: 237,  getLogs: true, notes: "Analytics-focused platform" },
      { provider: "Lava",            url: "https://base.lava.build",                                     tier: "S", latencyMs: 276,  getLogs: true, notes: "Decentralized RPC protocol" },
      { provider: "ZAN",             url: "https://api.zan.top/base-mainnet",                            tier: "S", latencyMs: 285,  getLogs: true, notes: "Ant Group; great for Asia" },
      { provider: "Base Flashblocks",url: "https://mainnet-preconf.base.org",                            tier: "S", latencyMs: 307,  getLogs: true, notes: "Official, 200ms pre-confirmation, fastest sync" },
      { provider: "Polkachu",        url: "https://base-rpc.polkachu.com",                               tier: "S", latencyMs: 368,  getLogs: true, notes: "Validator-operated" },
      { provider: "PublicNode",      url: "https://base.publicnode.com",                                 tier: "S", latencyMs: 386,  getLogs: true, notes: "Also: https://base-rpc.publicnode.com" },
      // --- Tier A (reliable, 500-1000ms) ---
      { provider: "thirdweb",        url: "https://base.rpc.thirdweb.com",                               tier: "A", latencyMs: 493,  getLogs: true, notes: "Global edge" },
      { provider: "Base.org Dev",    url: "https://developer-access-mainnet.base.org",                   tier: "A", latencyMs: 475,  getLogs: true, notes: "Official, variable latency" },
      { provider: "BlockPI",         url: "https://base.public.blockpi.network/v1/rpc/public",           tier: "A", latencyMs: 555,  getLogs: true, notes: "Fast sync" },
      { provider: "Nodies",          url: "https://base-public.nodies.app",                              tier: "A", latencyMs: 560,  getLogs: true, notes: "Stable" },
      { provider: "merkle",          url: "https://base.merkle.io",                                      tier: "A", latencyMs: 562,  getLogs: true, notes: "MEV protection, cold-start slow" },
      { provider: "SubQuery",        url: "https://base.rpc.subquery.network/public",                    tier: "A", latencyMs: 749,  getLogs: true, notes: "Decentralized" },
      { provider: "LlamaNodes",      url: "https://base.llamarpc.com",                                   tier: "A", latencyMs: 786,  getLogs: true, notes: "Privacy RPC" },
      // --- Tier B (functional but slow or unstable) ---
      { provider: "LeoRPC",          url: "https://base.leorpc.com/?api_key=FREE",                       tier: "B", latencyMs: 758,  getLogs: true, notes: "Embedded free key" },
      { provider: "Pocket",          url: "https://base.api.pocket.network",                             tier: "B", latencyMs: 756,  getLogs: true, notes: "Decentralized relay" },
      { provider: "bloXroute",       url: "https://base.rpc.blxrbdn.com",                                tier: "B", latencyMs: 820,  getLogs: true, notes: "BDN network" },
      { provider: "BlastAPI",        url: "https://base-mainnet.public.blastapi.io",                     tier: "B", latencyMs: 1791, getLogs: true, notes: "Unstable spikes, acquired by Alchemy" },
      // --- Warning ---
      { provider: "dRPC",            url: "https://base.drpc.org",                                       tier: "W", latencyMs: 99,   getLogs: true, notes: "Fastest but free-tier getBlock times out; use paid tier" },
      { provider: "Base.org",        url: "https://mainnet.base.org",                                    tier: "W", latencyMs: 276,  getLogs: false, notes: "Official but getLogs returns 'no healthy backend'" },
    ],
  },

  // =========================================================================
  // BSC / BNB Smart Chain (Chain ID: 56)
  // =========================================================================
  56: {
    chainId: 56,
    name: "BSC",
    caveats: "Official BNB Chain dataseeds do NOT support eth_getLogs. Only Tier 1/2 providers support full analytics queries.",
    benchmark: { date: "2026-03-11", location: "Taiwan", endpointsTested: 56 },
    fallbacks: [
      "https://bsc.drpc.org",
      "https://bsc.blockrazor.xyz",
      "https://rpc-bsc.48.club",
    ],
    endpoints: [
      // --- Tier 1 (excellent, getLogs ✅) ---
      { provider: "dRPC",              url: "https://bsc.drpc.org",                                              tier: "1", latencyMs: 150, getLogs: true,  notes: "Decentralized, MEV protection" },
      { provider: "BlockRazor",        url: "https://bsc.blockrazor.xyz",                                        tier: "1", latencyMs: 153, getLogs: true,  notes: "100% sandwich protection, fastest BSC builder" },
      { provider: "48Club",            url: "https://rpc-bsc.48.club",                                           tier: "1", latencyMs: 123, getLogs: true,  notes: "56.7% BSC block share, private mempool" },
      { provider: "48Club (alt)",      url: "https://0.48.club",                                                 tier: "1", latencyMs: 127, getLogs: true,  notes: "Alternate 48Club endpoint" },
      { provider: "bloXroute",         url: "https://bsc.rpc.blxrbdn.com",                                       tier: "1", latencyMs: 208, getLogs: true,  notes: "Frontrunning protection" },
      { provider: "Tatum",             url: "https://bsc-mainnet.gateway.tatum.io",                               tier: "1", latencyMs: 238, getLogs: true,  notes: "Multi-chain, rate-limited free tier" },
      { provider: "Sentio",            url: "https://rpc.sentio.xyz/bsc",                                        tier: "1", latencyMs: 236, getLogs: true,  notes: "Analytics platform" },
      // --- Tier 2 (good, getLogs ✅) ---
      { provider: "Nodies",            url: "https://binance-smart-chain-public.nodies.app",                      tier: "2", latencyMs: 295, getLogs: true,  notes: "POKT relay, 99.9% uptime" },
      { provider: "thirdweb",          url: "https://binance.rpc.thirdweb.com",                                   tier: "2", latencyMs: 268, getLogs: true,  notes: "Dev platform" },
      { provider: "NodeReal (shared)", url: "https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3", tier: "2", latencyMs: 292, getLogs: true,  notes: "Official BSC partner; shared key may hit limits" },
      { provider: "BlastAPI",          url: "https://bsc-mainnet.public.blastapi.io",                              tier: "2", latencyMs: 341, getLogs: true,  notes: "Acquired by Alchemy — may shut down" },
      { provider: "OnFinality",        url: "https://bnb.api.onfinality.io/public",                               tier: "2", latencyMs: 356, getLogs: true },
      { provider: "PublicNode",        url: "https://bsc-rpc.publicnode.com",                                      tier: "2", latencyMs: 407, getLogs: true,  notes: "Free, privacy-focused" },
      { provider: "Fastnode",          url: "https://public-bsc-mainnet.fastnode.io",                              tier: "2", latencyMs: 446, getLogs: true },
      { provider: "SubQuery",          url: "https://bnb.rpc.subquery.network/public",                             tier: "2", latencyMs: 574, getLogs: true,  notes: "Decentralized" },
      { provider: "RPCFast (shared)",  url: "https://bsc-mainnet.rpcfast.com?api_key=xbhWBI1Wkguk8SNMu1bvvLurPGLXmgwYeC4S6g2H7WdwFigZSmPWVZRxrskEQwIf", tier: "2", latencyMs: 649, getLogs: true, notes: "Shared key, may expire" },
      { provider: "NOWNodes",          url: "https://public-bsc.nownodes.io",                                      tier: "2", latencyMs: 692, getLogs: true,  notes: "Trustpilot 3.7/5" },
      { provider: "LeoRPC",            url: "https://bsc.leorpc.com/?api_key=FREE",                                tier: "2", latencyMs: 816, getLogs: true,  notes: "Embedded free key" },
      { provider: "Pocket",            url: "https://bsc.api.pocket.network",                                      tier: "2", latencyMs: 872, getLogs: true,  notes: "High latency from Asia" },
      // --- Tier 3 (no getLogs — only for basic reads) ---
      { provider: "1RPC",              url: "https://1rpc.io/bnb",                                                tier: "3", latencyMs: 216, getLogs: false, notes: "Privacy relay; NO getLogs" },
      { provider: "BNBChain dataseed1",url: "https://bsc-dataseed1.bnbchain.org",                                 tier: "3", latencyMs: 231, getLogs: false, notes: "Official; also dataseed2/3/4" },
      { provider: "NodeReal",          url: "https://bsc.nodereal.io",                                            tier: "3", latencyMs: 234, getLogs: false, notes: "2000 CU/min; also https://binance.nodereal.io" },
      { provider: "Defibit dataseed1", url: "https://bsc-dataseed1.defibit.io",                                   tier: "3", latencyMs: 215, getLogs: false, notes: "Official partner; also dataseed2" },
      { provider: "Ninicoin dataseed1",url: "https://bsc-dataseed1.ninicoin.io",                                   tier: "3", latencyMs: 226, getLogs: false, notes: "Official partner" },
      { provider: "ZAN",               url: "https://api.zan.top/bsc-mainnet",                                    tier: "3", latencyMs: 370, getLogs: false, notes: "Ant Group; no getLogs on free tier" },
      { provider: "MeowRPC",           url: "https://bsc.meowrpc.com",                                            tier: "3", latencyMs: 470, getLogs: false },
    ],
  },

  // =========================================================================
  // Polygon PoS (Chain ID: 137)
  // =========================================================================
  137: {
    chainId: 137,
    name: "Polygon PoS",
    fallbacks: [
      "https://1rpc.io/matic",
      "https://polygon-bor.publicnode.com/",
      "https://polygon-mainnet.gateway.tatum.io/",
    ],
    endpoints: [
      // --- Tier S ---
      { provider: "1RPC",           url: "https://1rpc.io/matic",                                         tier: "S", latencyMs: null, getLogs: true, notes: "Privacy relay" },
      { provider: "Tenderly",       url: "https://tenderly.rpc.polygon.community/",                       tier: "S", latencyMs: null, getLogs: true, notes: "Community endpoint via Tenderly" },
      { provider: "PublicNode",     url: "https://polygon-bor.publicnode.com/",                            tier: "S", latencyMs: null, getLogs: true, notes: "Free, privacy-focused" },
      { provider: "Tatum",          url: "https://polygon-mainnet.gateway.tatum.io/",                     tier: "S", latencyMs: null, getLogs: true, notes: "Free tier" },
      // --- Tier A ---
      { provider: "dRPC",           url: "https://polygon.drpc.org/",                                     tier: "A", latencyMs: null, getLogs: true, notes: "Decentralized, MEV protection" },
      { provider: "thirdweb",       url: "https://137.rpc.thirdweb.com/",                                 tier: "A", latencyMs: null, getLogs: true, notes: "Global edge" },
      { provider: "Nodies",         url: "https://polygon-public.nodies.app",                              tier: "A", latencyMs: null, getLogs: true, notes: "POKT relay" },
      { provider: "Polygon Labs",   url: "https://rpc-mainnet.polygon.technology/",                        tier: "A", latencyMs: null, getLogs: true, notes: "Official" },
      { provider: "QuickNode",      url: "https://rpc-mainnet.matic.quiknode.pro",                         tier: "A", latencyMs: null, getLogs: true, notes: "Public endpoint" },
      // --- Tier B ---
      // OMNIA removed 2026-03-21: HTTP 521 server down
      { provider: "OnFinality",     url: "https://polygon.api.onfinality.io/public",                       tier: "B", latencyMs: null, getLogs: true, notes: "May rate-limit" },
      { provider: "SubQuery",       url: "https://polygon.rpc.subquery.network/public",                    tier: "B", latencyMs: null, getLogs: true, notes: "Decentralized" },
      { provider: "Pocket",         url: "https://poly.api.pocket.network/",                               tier: "B", latencyMs: null, getLogs: true, notes: "Decentralized relay" },
      { provider: "LeoRPC",         url: "https://pol.leorpc.com/?api_key=FREE",                           tier: "B", latencyMs: null, getLogs: true, notes: "Embedded free key" },
      // Node RPC removed 2026-03-21: HTTP 404
      { provider: "RPC Fast (shared)", url: "https://polygon-mainnet.rpcfast.com?api_key=xbhWBI1Wkguk8SNMu1bvvLurPGLXmgwYeC4S6g2H7WdwFigZSmPWVZRxrskEQwIf", tier: "B", latencyMs: null, getLogs: true, notes: "Shared key, may expire" },
    ],
  },

  // =========================================================================
  // Katana (Chain ID: 747474)
  // =========================================================================
  747474: {
    chainId: 747474,
    name: "Katana",
    caveats: "Only 5 verified public mainnet endpoints. Gas is negligible (~0.001 Gwei).",
    benchmark: { date: "2026-03-11", location: "Asia-Pacific", endpointsTested: 32 },
    fallbacks: [
      "https://katana.drpc.org",
      "https://katana.gateway.tenderly.co",
      "https://rpc.katanarpc.com",
    ],
    endpoints: [
      // --- Tier S ---
      { provider: "dRPC",                url: "https://katana.drpc.org",              tier: "S", latencyMs: 75,  getLogs: true, notes: "Fastest, decentralized, 100% success rate" },
      { provider: "Tenderly",            url: "https://katana.gateway.tenderly.co",   tier: "S", latencyMs: 158, getLogs: true, notes: "Official Katana RPC partner, 99.99% SLA" },
      { provider: "katanarpc.com (Conduit)", url: "https://rpc.katanarpc.com",        tier: "S", latencyMs: 165, getLogs: true, notes: "Conduit infra, powers 55%+ of ETH L2s" },
      // --- Tier A ---
      { provider: "thirdweb",            url: "https://747474.rpc.thirdweb.com",      tier: "A", latencyMs: 235, getLogs: true, notes: "URL pattern: {chainId}.rpc.thirdweb.com" },
      { provider: "Conduit (Official)",  url: "https://rpc.katana.network",           tier: "A", latencyMs: 367, getLogs: true, notes: "Higher latency, variable (315-430ms)" },
    ],
    testnets: [
      {
        name: "Bokuto",
        chainId: 737373,
        endpoints: [
          { provider: "dRPC",     url: "https://katana-testnet.drpc.org",            latencyMs: 70 },
          { provider: "Conduit",  url: "https://rpc-bokuto.katanarpc.com",           latencyMs: 185 },
          { provider: "Tenderly", url: "https://katana-bokuto.gateway.tenderly.co",  latencyMs: 217 },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Auto-selection helpers
// ---------------------------------------------------------------------------

/**
 * Get the recommended fallback URLs for a given chain.
 * Returns top 3 endpoints in priority order.
 */
export function getFallbacks(chainId: number): string[] {
  return RPC_REGISTRY[chainId]?.fallbacks ?? [];
}

/**
 * Get all endpoints for a chain that support eth_getLogs,
 * sorted by tier (S/1 first) then by latency (lowest first).
 */
export function getAnalyticsEndpoints(chainId: number): RpcEndpoint[] {
  const config = RPC_REGISTRY[chainId];
  if (!config) return [];

  const tierOrder: Record<Tier, number> = { S: 0, "1": 0, A: 1, "2": 1, B: 2, "3": 2, W: 3 };

  return config.endpoints
    .filter((e) => e.getLogs)
    .sort((a, b) => {
      const td = tierOrder[a.tier] - tierOrder[b.tier];
      if (td !== 0) return td;
      // null latency sorts after known latency
      if (a.latencyMs === null && b.latencyMs === null) return 0;
      if (a.latencyMs === null) return 1;
      if (b.latencyMs === null) return -1;
      return a.latencyMs - b.latencyMs;
    });
}

/**
 * Auto-selection algorithm:
 *
 * 1. Pick first Tier S/1 endpoint for the chain
 * 2. Probe with eth_chainId (timeout 5s)
 * 3. If probe fails -> try next Tier S/1 endpoint
 * 4. If all Tier S/1 fail -> try Tier A/2
 * 5. After connecting, verify: eth_chainId matches expected chain ID
 * 6. For BSC analytics requiring eth_getLogs -> MUST use Tier 1/2 (NOT Tier 3 dataseeds)
 * 7. For Katana -> only 5 mainnet endpoints exist, cycle through all
 * 8. Log which endpoint was selected in the reproducibility footer
 */
