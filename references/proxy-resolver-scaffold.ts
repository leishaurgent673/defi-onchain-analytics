#!/usr/bin/env bun
// Proxy Resolver Scaffold — resolve proxy chain, extract selectors, lookup signatures, output partial ABI.
// Run:  bun run references/proxy-resolver-scaffold.ts
// Env:  RPC_URL=https://your-endpoint (defaults to publicnode)
//       TARGET=0xContractAddress
import {
  createPublicClient, http, toHex, fromHex, encodeFunctionData, decodeFunctionResult,
  type Address, type Hex, type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const short = (h: string) => `${h.slice(0, 6)}..${h.slice(-4)}`;

const EIP1967_SLOTS = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex,
  beacon:         '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' as Hex,
  admin:          '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103' as Hex,
};

const EIP1167_PREFIX = '363d3d373d3d3d363d73';

const CONFIG = {
  rpcUrl: process.env.RPC_URL || 'https://ethereum.publicnode.com',
  target: (process.env.TARGET || '0x_REPLACE') as Address,
};

const client = createPublicClient({ chain: mainnet, transport: http(CONFIG.rpcUrl) });

// ─── Proxy Detection & Resolution ──────────────────────────────────────────

interface ProxyInfo {
  address: Address;
  pattern: 'transparent' | 'uups' | 'beacon' | 'eip1167-clone' | 'diamond' | 'none';
  implementation: Address | null;
  beacon: Address | null;
  admin: Address | null;
}

function extractAddress(slot: Hex): Address | null {
  const addr = `0x${slot.slice(26)}` as Address;
  return addr === '0x0000000000000000000000000000000000000000' ? null : addr;
}

async function detectProxy(c: PublicClient, address: Address): Promise<ProxyInfo> {
  const code = await c.getCode({ address });
  if (!code || code === '0x') {
    return { address, pattern: 'none', implementation: null, beacon: null, admin: null };
  }

  const implSlot = await c.getStorageAt({ address, slot: EIP1967_SLOTS.implementation });
  const beaconSlot = await c.getStorageAt({ address, slot: EIP1967_SLOTS.beacon });
  const adminSlot = await c.getStorageAt({ address, slot: EIP1967_SLOTS.admin });

  const impl = extractAddress(implSlot || '0x' + '00'.repeat(32) as Hex);
  const beacon = extractAddress(beaconSlot || '0x' + '00'.repeat(32) as Hex);
  const admin = extractAddress(adminSlot || '0x' + '00'.repeat(32) as Hex);

  if (impl) {
    return { address, pattern: 'transparent', implementation: impl, beacon: null, admin };
  }

  if (beacon) {
    let beaconImpl: Address | null = null;
    try {
      const result = await c.call({
        to: beacon,
        data: '0x5c60da1b' as Hex, // implementation()
      });
      if (result.data) beaconImpl = extractAddress(result.data);
    } catch {}
    return { address, pattern: 'beacon', implementation: beaconImpl, beacon, admin };
  }

  const codeHex = code.slice(2);
  if (codeHex.startsWith(EIP1167_PREFIX)) {
    const implAddr = `0x${codeHex.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40)}` as Address;
    return { address, pattern: 'eip1167-clone', implementation: implAddr, beacon: null, admin: null };
  }

  try {
    const result = await c.call({ to: address, data: '0x7a0ed627' as Hex }); // facets()
    if (result.data && result.data.length > 66) {
      return { address, pattern: 'diamond', implementation: null, beacon: null, admin };
    }
  } catch {}

  return { address, pattern: 'none', implementation: null, beacon: null, admin };
}

async function resolveFullChain(c: PublicClient, address: Address): Promise<ProxyInfo[]> {
  const chain: ProxyInfo[] = [];
  let current = address;
  const visited = new Set<string>();

  while (!visited.has(current.toLowerCase())) {
    visited.add(current.toLowerCase());
    const info = await detectProxy(c, current);
    chain.push(info);

    if (info.implementation && !visited.has(info.implementation.toLowerCase())) {
      current = info.implementation;
    } else {
      break;
    }
  }
  return chain;
}

// ─── Bytecode Selector Extraction ──────────────────────────────────────────

function extractSelectors(bytecode: Hex): Hex[] {
  const selectors = new Set<string>();
  const hex = bytecode.slice(2);
  // PUSH4 = 0x63, scan for 4-byte selector arguments in the dispatcher
  for (let i = 0; i < hex.length - 10; i += 2) {
    if (hex.slice(i, i + 2) === '63') {
      const candidate = hex.slice(i + 2, i + 10);
      if (candidate.length === 8) {
        selectors.add(`0x${candidate}`);
      }
    }
  }
  // PUSH4 via selector comparison patterns (EQ after PUSH4)
  // Filter obvious non-selectors: all zeros, all FFs
  const filtered = [...selectors].filter(s =>
    s !== '0x00000000' && s !== '0xffffffff' && s !== '0x01000000'
  );
  return filtered as Hex[];
}

// ─── 4byte.directory Lookup ────────────────────────────────────────────────

interface SignatureMatch {
  selector: Hex;
  signatures: string[];
}

async function lookupSelectors(selectors: Hex[]): Promise<SignatureMatch[]> {
  const results: SignatureMatch[] = [];
  const batchSize = 5;

  for (let i = 0; i < selectors.length; i += batchSize) {
    const batch = selectors.slice(i, i + batchSize);
    const lookups = batch.map(async (sel): Promise<SignatureMatch> => {
      try {
        const res = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${sel}`);
        if (!res.ok) return { selector: sel, signatures: [] };
        const data = await res.json() as any;
        const sigs = (data.results || []).map((r: any) => r.text_signature as string);
        return { selector: sel, signatures: sigs };
      } catch {
        return { selector: sel, signatures: [] };
      }
    });
    results.push(...await Promise.all(lookups));
    if (i + batchSize < selectors.length) await sleep(300);
  }
  return results;
}

// ─── Selector Probing ──────────────────────────────────────────────────────

interface ProbeResult {
  selector: Hex;
  signatures: string[];
  callable: boolean;
  returnSize: number;
  error: string | null;
}

async function probeSelectors(
  c: PublicClient,
  target: Address,
  matches: SignatureMatch[],
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const match of matches) {
    try {
      const result = await c.call({
        to: target,
        data: (match.selector + '0'.repeat(64)) as Hex,
      });
      results.push({
        selector: match.selector,
        signatures: match.signatures,
        callable: true,
        returnSize: result.data ? (result.data.length - 2) / 2 : 0,
        error: null,
      });
    } catch (err: any) {
      results.push({
        selector: match.selector,
        signatures: match.signatures,
        callable: false,
        returnSize: 0,
        error: (err?.message ?? 'unknown').slice(0, 60),
      });
    }
  }
  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const target = CONFIG.target;
  console.log(`\n═══ PROXY RESOLVER ═══`);
  console.log(`Target: ${target}`);
  console.log(`RPC: ${CONFIG.rpcUrl.slice(0, 50)}...`);
  console.log(`═════════════════════\n`);

  console.log(`Step 1: Proxy chain resolution...`);
  const chain = await resolveFullChain(client as PublicClient, target);

  for (const info of chain) {
    console.log(`  ${short(info.address)} → pattern: ${info.pattern}`);
    if (info.implementation) console.log(`    implementation: ${info.implementation}`);
    if (info.beacon) console.log(`    beacon: ${info.beacon}`);
    if (info.admin) console.log(`    admin: ${info.admin}`);
  }

  const finalImpl = chain[chain.length - 1];
  const codeTarget = finalImpl.implementation || finalImpl.address;
  console.log(`\nFinal implementation: ${codeTarget}`);

  console.log(`\nStep 2: Extracting selectors from bytecode...`);
  const bytecode = await (client as PublicClient).getCode({ address: codeTarget });
  if (!bytecode || bytecode === '0x') {
    console.log('  No bytecode found (EOA or self-destructed). Exiting.');
    return;
  }

  const selectors = extractSelectors(bytecode);
  console.log(`  Found ${selectors.length} candidate selectors`);

  console.log(`\nStep 3: Looking up signatures via 4byte.directory...`);
  const matches = await lookupSelectors(selectors);
  const resolved = matches.filter(m => m.signatures.length > 0);
  const unknown = matches.filter(m => m.signatures.length === 0);
  console.log(`  Resolved: ${resolved.length} | Unknown: ${unknown.length}`);

  console.log(`\nStep 4: Probing selectors on contract...`);
  const probeResults = await probeSelectors(client as PublicClient, target, matches);

  console.log(`\n═══ PARTIAL ABI ═══`);
  console.log(`\nCallable functions:`);
  const callable = probeResults.filter(r => r.callable);
  for (const r of callable) {
    const name = r.signatures.length > 0 ? r.signatures[0] : `unknown_${r.selector}`;
    console.log(`  ${r.selector} → ${name} (returns ${r.returnSize} bytes)`);
  }

  if (unknown.length > 0) {
    console.log(`\nUnresolved selectors (no 4byte match):`);
    for (const u of unknown.slice(0, 20)) {
      const probe = probeResults.find(p => p.selector === u.selector);
      const status = probe?.callable ? '✓ callable' : '✗ reverts';
      console.log(`  ${u.selector} ${status}`);
    }
    if (unknown.length > 20) console.log(`  ... and ${unknown.length - 20} more`);
  }

  console.log(`\n═══ SUMMARY ═══`);
  console.log(`Proxy chain: ${chain.map(c => `${short(c.address)}[${c.pattern}]`).join(' → ')}`);
  console.log(`Implementation: ${codeTarget}`);
  console.log(`Total selectors: ${selectors.length}`);
  console.log(`Resolved signatures: ${resolved.length}`);
  console.log(`Callable: ${callable.length} | Reverts: ${probeResults.length - callable.length}`);
  console.log(`═══════════════\n`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
