// How the radar scores a protocol, written fresh (Node 22, standard library only).
//
// A sealed snapshot goes in; a ranked board comes out. The board holds the
// watchlist plus the early radar: pre-token protocols below the watchlist
// floor, which is what the radar is for. Protocols already trading never
// join the ranking — the market already values them, so they sit apart with
// their own market caps. No protocol gets special treatment: every figure
// comes from the snapshot itself.
//
// How a row gets its number (radar-2):
//
//   peer     the middle mcap/TVL ratio among live-token protocols in the
//            row's own category, when that category holds at least 3 live
//            peers, else the middle ratio across all live-token protocols;
//            held inside 0.05–1.50
//   base     TVL times peer
//   growth   the 7-day TVL change, held inside [-60, +120]%, counted at half
//            weight
//   age      days since first listing (365 when unlisted), ripening from
//            0.6 toward 1.0 over 1095 days
//   chains   1 plus 0.04 for each extra chain, at most 5 extra
//   implied  round(base times growth times maturity times chains), at least $1
//
// The peer ratio is cut to four decimals before it is multiplied, so the
// figure board.json holds and the figure the dashboard recomputes agree
// exactly, digit for digit.

/** One protocol exactly as the sealed snapshot records it. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** The model's tuning knobs, printed on the dashboard so the page can redo the maths. */
export interface Tuning {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_min: number;
  peer_max: number;
  peer_min_peers: number;
  chain_step: number;
  chain_max_extra: number;
}

export const TUNING: Tuning = {
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120,
  maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095,
  unknown_age_days: 365, peer_min: 0.05, peer_max: 1.5,
  peer_min_peers: 3, chain_step: 0.04, chain_max_extra: 5,
};

/** The model version the dashboard names and the rules quote. */
export const MODEL_TAG = 'radar-2';

/** Early-radar cap: pre-token protocols below the floor, taken by TVL. */
export const EARLY_CAP = 260;

/** Live-token cap: protocols already trading, taken by market cap. */
export const LIVE_CAP = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface Step {
  text: string;
  cost: string;
  time: string;
}

/** A row of board.json. */
export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row slimmed down for data.js; the page rebuilds the farm plan from it. */
export interface Slim {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  peer_multiple: number;
  peer_count: number;
  chain_multiplier: number;
}

/** A live-token protocol, shown with the market's own value instead of a model's. */
export interface Trade {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, in one object. */
export interface Dash {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  peer_global: number;
  peer_categories: { category: string; multiple: number; peers: number }[];
  rows: Slim[];
  live: Trade[];
}

/** A snapshot that cannot be scored. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const DAY_MS = 86_400_000;

/** Round to four decimals, the precision the board and the page both carry. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Bound `n` into [lo, hi]. */
function bound(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** `value` when it is a finite number, `fallback` otherwise. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is missing or bad. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The middle of an ascending array, or `fallback` for an empty one. */
function medianOf(ascending: number[], fallback: number): number {
  const n = ascending.length;
  if (n === 0) return fallback;
  const half = Math.floor(n / 2);
  if (n % 2 === 1) return ascending[half]!;
  return (ascending[half - 1]! + ascending[half]!) / 2;
}

/** Text order: -1, 0 or 1, for deterministic tie-breaks. */
function cmpStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Fill a sentence template: $N is the protocol name, $A the capital, $C the chain. */
function fill(t: string, n: string, a: number, c: string): string {
  return t.replace(/\$(N|A|C)/g, (m) => (m === '$N' ? n : m === '$A' ? String(a) : c));
}

/** Build one farm step from its three parts. */
function mkStep(text: string, cost: string, time: string): Step {
  return { text, cost, time };
}

/** Protocols keyed by slug, for the watchlist lookup. */
function bySlug(list: Proto[]): Map<string, Proto> {
  const index = new Map<string, Proto>();
  for (const p of list) index.set(p.slug, p);
  return index;
}

/** The peer table: per-category medians plus the global fallback, computed once per snapshot. */
export interface Peers {
  byCategory: Map<string, { multiple: number; peers: number }>;
  global: number;
  globalPeers: number;
}

/** Bound a raw peer multiple into the model's allowed band. */
function boundPeer(raw: number, tune: Tuning): number {
  return bound(raw, tune.peer_min, tune.peer_max);
}

export function peerIndex(snap: Snap, tune: Tuning = TUNING): Peers {
  const buckets = new Map<string, number[]>();
  const every: number[] = [];
  for (const proto of snap.protocols) {
    if (proto.mcap_usd === null || !(proto.tvl_usd > 0)) continue;
    const ratio = proto.mcap_usd / proto.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    every.push(ratio);
    const key = proto.category ?? 'Other';
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [ratio]);
    else bucket.push(ratio);
  }
  every.sort((a, b) => a - b);
  const global = boundPeer(medianOf(every, 0.25), tune);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, ratios] of buckets) {
    ratios.sort((a, b) => a - b);
    const peers = ratios.length;
    // A category with too few live peers borrows the global median instead
    // of trusting a median built on one or two tokens.
    const multiple = peers >= tune.peer_min_peers ? boundPeer(medianOf(ratios, global), tune) : global;
    byCategory.set(key, { multiple, peers });
  }
  return { byCategory, global, globalPeers: every.length };
}

/** One protocol's score: the implied value plus every multiplier that built it. */
export interface Score {
  value: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  peerMult: number;
  peerCount: number;
  age: number | null;
}

export function evaluate(
  proto: Proto,
  asOf: string,
  tune: Tuning,
  peers: Peers,
): Score {
  const age = daysSince(asOf, proto.listed_at);
  const growthPct = bound(numOr(proto.change_7d, 0), tune.growth_floor, tune.growth_cap);
  const growthMult = 1 + (growthPct / 100) * tune.growth_weight;
  const ageUsed = age ?? tune.unknown_age_days;
  const matured = bound(ageUsed, 0, tune.maturity_days) / tune.maturity_days;
  const maturityMult = tune.maturity_floor + matured * tune.maturity_range;
  const entry = peers.byCategory.get(proto.category ?? 'Other');
  // Round the peer multiple BEFORE multiplying: board.json and the dashboard
  // both print the rounded figure, so the page's recompute lands exactly.
  const peerMult = round4(entry?.multiple ?? peers.global);
  // The count the multiple actually rests on: the category's peers when it
  // has enough, otherwise the whole live-token set behind the global median.
  const peerCount = entry !== undefined && entry.peers >= tune.peer_min_peers ? entry.peers : peers.globalPeers;
  const extraChains = bound(proto.chains.length - 1, 0, tune.chain_max_extra);
  const chainMult = 1 + tune.chain_step * extraChains;
  const base = proto.tvl_usd * peerMult;
  const value = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { value, growthPct, growthMult, maturityMult, chainMult, peerMult, peerCount, age };
}

/** A name ending in a release marker (V2, v2, 2.0 ...) is a pool of another protocol, not its own. */
const VERSION_END = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the snapshot records no token for the protocol at all. */
export function tokenless(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the protocol may be ranked: pre-token, not an exchange, not a versioned pool. */
export function rankable(p: Proto): boolean {
  return tokenless(p) && p.category !== 'CEX' && !VERSION_END.test(p.name);
}

/** Early-radar picks: rankable pre-token protocols below the floor, richest TVL first. */
function earlySet(snap: Snap, chosen: Map<string, Proto>): Proto[] {
  return snap.protocols
    .filter((p) => !chosen.has(p.slug) && rankable(p) && p.tvl_usd < snap.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || cmpStr(a.slug, b.slug))
    .slice(0, EARLY_CAP);
}

/** One scored protocol turned into its board row, with the key order board.json prints. */
function toRow(p: Proto, score: Score, rank: number): Row {
  return {
    rank, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
    listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
    token_status: 'pre-token', age_days: score.age, implied_value_usd: score.value,
    model: {
      peer_multiple: round4(score.peerMult), peer_count: score.peerCount,
      growth_pct: score.growthPct, growth_multiplier: round4(score.growthMult),
      maturity_multiplier: round4(score.maturityMult), chain_multiplier: round4(score.chainMult),
      age_days: score.age,
    },
    farm_steps: planSteps(p, score.age).map(formatStep),
  };
}

/** The ranked board: watchlist first (the floor), early radar on top, strongest first. */
export function rankBoard(snap: Snap, tune: Tuning = TUNING): Row[] {
  const lookup = bySlug(snap.protocols);
  const peers = peerIndex(snap, tune);
  const chosen = new Map<string, Proto>();
  // The watchlist is the floor: every slug it names, even one the snapshot
  // no longer carries — coverage is the gate's row and is never gambled.
  for (const slug of snap.watchlist) {
    const hit = lookup.get(slug);
    if (hit !== undefined) chosen.set(slug, hit);
  }
  // The early radar adds below-floor protocols; a chosen protocol stays chosen.
  for (const p of earlySet(snap, chosen)) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ proto: p, score: evaluate(p, snap.as_of, tune, peers) }));
  scored.sort((a, b) => b.score.value - a.score.value || cmpStr(a.proto.slug, b.proto.slug));
  return scored.map((entry, i) => toRow(entry.proto, entry.score, i + 1));
}

/** The live-token protocols, richest market cap first, for the dashboard's Live token view. */
export function tradeRows(snap: Snap): Trade[] {
  const trading = snap.protocols.filter((p) => !tokenless(p) && p.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_CAP).map((p) => ({
    slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
  }));
}

/** A board row's slim form for data.js; the page regenerates the farm plan from it. */
export function slimRow(row: Row): Slim {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d,
    mcap_usd: row.mcap_usd, listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd, growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier, peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count, chain_multiplier: row.model.chain_multiplier,
  };
}

/** Headline figures for the run's summary line. */
export interface BoardStats {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Everything the dashboard renders, built from one snapshot. */
export function buildDash(snap: Snap, tune: Tuning = TUNING): { board: Row[]; radar: Dash } {
  const board = rankBoard(snap, tune);
  const live = tradeRows(snap);
  const peers = peerIndex(snap, tune);
  let early = 0;
  for (const row of board) if (!snap.watchlist.includes(row.slug)) early++;
  const peerCategories = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4(v.multiple), peers: v.peers }))
    .sort(
      (a, b) => b.peers - a.peers || a.category.localeCompare(b.category),
    );
  const radar: Dash = {
    as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, model: tune,
    model_version: MODEL_TAG, watchlist_size: snap.watchlist.length, board_size: board.length,
    early_size: early, live_size: live.length, peer_global: round4(peers.global),
    peer_categories: peerCategories, rows: board.map(slimRow), live,
  };
  return { board, radar };
}

/** First chain a protocol names, or a neutral phrase when it names none. */
function mainChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital one farm position needs, sized from the protocol's own TVL. */
function stakeSize(p: Proto): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Holding window, from the protocol's age: younger protocols need a longer qualifying run. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category rule: the keywords it matches and the action line it writes. */
interface ActRule {
  keys: string[];
  build: (name: string, amount: number, chain: string) => string;
}

/**
 * The category's one action, as a table instead of a chain of branches: the
 * first rule whose keyword appears in the category wins. The fallback at the
 * end is a plain deposit, for categories no rule names. Every rule names the
 * chain and the capital, so the step is an instruction, not a slogan.
 */
const ACT_RULES: ActRule[] = [
  { keys: ['liquid staking', 'staking pool'], build: (n, a, c) => fill("Stake $$A of the chain's staking asset through $N on $C and hold the liquid staking receipt.", n, a, c) },
  { keys: ['lend', 'cdp', 'collateral'], build: (n, a, c) => fill('Supply $$A of USDC to $N on $C and keep the position open.', n, a, c) },
  { keys: ['dex', 'yield aggregator', 'leveraged farm', 'farm', 'liquidity manager'], build: (n, a, c) => fill("Provide $$A of liquidity to $N's main pool on $C and keep the position open.", n, a, c) },
  { keys: ['bridge'], build: (n, a, c) => fill('Bridge $$A of USDC to $C through $N and use the bridged funds in its app.', n, a, c) },
  { keys: ['restak', 'staking'], build: (n, a, c) => fill("Stake $$A of the chain's staking asset through $N and keep the receipt.", n, a, c) },
  { keys: ['perpetual', 'derivative', 'basis trading'], build: (n, a, c) => fill('Deposit $$A of USDC as margin on $N and open one small hedge.', n, a, c) },
  { keys: ['prediction'], build: (n, a, c) => fill('Fund $$A and place one market position on $N.', n, a, c) },
  { keys: ['curator', 'allocator', 'aggregator'], build: (n, a, c) => fill('Deposit $$A into a $N vault on $C and keep the shares.', n, a, c) },
  { keys: ['stable'], build: (n, a, c) => fill('Mint or deposit $$A of the stable asset through $N on $C.', n, a, c) },
  { keys: ['rwa'], build: (n, a, c) => fill("Mint $$A of the protocol's yield asset on $C and hold it.", n, a, c) },
  { keys: ['insurance'], build: (n, a, c) => fill('Buy $$A of cover from $N on $C and keep the policy.', n, a, c) },
  { keys: ['btc', 'bitcoin'], build: (n, a, c) => fill('Deposit $$A of BTC into $N on $C and hold the receipt.', n, a, c) },
  { keys: ['cedefi'], build: (n, a, c) => fill('Deposit $$A into a $N vault on $C and keep the shares.', n, a, c) },
  { keys: ['chain'], build: (n, a, c) => fill('Bridge $$A of USDC to $N and use one app on the chain.', n, a, c) },
];

/** The category's action line, or the plain-deposit fallback. */
function actLine(p: Proto, amount: number, chain: string): string {
  const lowered = (p.category ?? '').toLowerCase();
  for (const rule of ACT_RULES) {
    if (rule.keys.some((k) => lowered.includes(k))) return rule.build(p.name, amount, chain);
  }
  return fill('Deposit $$A of USDC into $N on $C and keep the position open.', p.name, amount, chain);
}

/** One category rule for the weekly repeat: what to do each week to stay active. */
interface WeekRule {
  keys: string[];
  build: (name: string, amount: number, chain: string) => string;
}

const WEEK_RULES: WeekRule[] = [
  { keys: ['liquid staking', 'staking pool', 'restak', 'staking'], build: (n, a, c) => fill('Claim the staking rewards on $N and restake them, so the position compounds.', n, a, c) },
  { keys: ['lend', 'cdp', 'collateral'], build: (n, a, c) => fill('Repay a slice of the borrow on $N and re-supply $$A, so the loan stays healthy and the activity repeats.', n, a, c) },
  { keys: ['dex', 'yield aggregator', 'leveraged farm', 'farm', 'liquidity manager'], build: (n, a, c) => fill("Swap a small amount through $N's pool and top up the liquidity, so the position earns fees again.", n, a, c) },
  { keys: ['bridge'], build: (n, a, c) => fill('Bridge $$A back through $N and use the funds in a second app, so the bridge sees repeat use.', n, a, c) },
  { keys: ['perpetual', 'derivative', 'basis trading'], build: (n, a, c) => fill('Close the hedge on $N and reopen it at the new funding rate, so the position stays active.', n, a, c) },
  { keys: ['prediction'], build: (n, a, c) => fill('Settle one market on $N and open another, so the account keeps a live position.', n, a, c) },
  { keys: ['curator', 'allocator', 'aggregator', 'cedefi'], build: (n, a, c) => fill("Check $N's vault allocation and rebalance if it drifted, so the shares keep earning.", n, a, c) },
  { keys: ['stable', 'rwa'], build: (n, a, c) => fill('Check the peg and the yield on $N and top up if the rate moved.', n, a, c) },
  { keys: ['insurance'], build: (n, a, c) => fill("Check the cover's expiry on $N and renew it before it lapses.", n, a, c) },
  { keys: ['btc', 'bitcoin'], build: (n, a, c) => fill('Check the BTC peg on $N and the yield it pays, and top up if the rate moved.', n, a, c) },
  { keys: ['chain'], build: (n, a, c) => fill('Use one more app on $N this week, so the chain sees repeat activity.', n, a, c) },
];

/** The category's weekly repeat, or the plain qualifying-action fallback. */
function weekLine(p: Proto, amount: number, chain: string): string {
  const lowered = (p.category ?? '').toLowerCase();
  for (const rule of WEEK_RULES) {
    if (rule.keys.some((k) => lowered.includes(k))) return rule.build(p.name, amount, chain);
  }
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * The risk line: sized from the protocol's own record. A young protocol gets
 * a size-and-audit warning; a large one gets a note that any airdrop is split
 * across many farmers; a sharp weekly fall gets a check-the-drop warning.
 */
function riskNote(p: Proto, age: number | null): string {
  if (age !== null && age < 90) {
    return 'This protocol is young (' + age + ' days on record): size the position small, verify its audit before adding funds, and never use leverage.';
  }
  if (p.change_7d !== null && p.change_7d <= -20) {
    return 'TVL fell ' + Math.abs(p.change_7d).toFixed(1) + '% in a week: check whether the drop is an outflow or a price move before adding funds.';
  }
  if (p.tvl_usd >= 1_000_000_000) {
    return 'At $' + (p.tvl_usd / 1e9).toFixed(1) + 'B of TVL the position is liquid, but any airdrop is split across many farmers: size for the yield, not the airdrop.';
  }
  return 'Size the position so a 50% drawdown costs less than a week of income, ' + 'and never borrow to farm.';
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age, weekly
 * move) — never from a hand-written list of names. The action, the weekly
 * repeat and the risk line all vary by category; the last step is the exit:
 * how to unwind safely and what to check before claiming anything.
 */
export function planSteps(p: Proto, age: number | null): Step[] {
  const chain = mainChain(p);
  const amount = stakeSize(p);
  const hold = holdDays(age);
  const action = actLine(p, amount, chain);
  const weekly = weekLine(p, amount, chain);
  const risk = riskNote(p, age);
  const gasBig = amount >= 150 ? 8 : 4;
  return [
    mkStep('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
    mkStep(action, '$' + amount + ' of capital and about $' + gasBig + ' of gas', '15 minutes to set up'),
    mkStep(weekly, 'about $2 of gas a week', '10 minutes a week'),
    mkStep('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + amount + ' stays in the position', hold + ' days'),
    mkStep("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'),
    mkStep('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'),
    mkStep(risk, 'nothing to check, and it caps what you stake', '10 minutes before you add funds'),
    mkStep("When you exit, withdraw in two parts a day apart and check the position's value after each part, so a failed withdrawal is caught while half the funds are still in.", 'about $4 of gas for the two withdrawals', '10 minutes over 2 days'),
  ];
}

/** Render one farm step as a single string: action, then cost and time, within 20..600 chars. */
export function formatStep(step: Step): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function readSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapError('snapshot.json has no as_of date');
  }
  if (typeof doc.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapError('snapshot.json has no watchlist of slugs');
  }
  const protocols: Proto[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const numOrNull = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      slug: p.slug,
      name: p.name,
      category: textOrNull(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: numOrNull(p.change_7d),
      mcap_usd: numOrNull(p.mcap_usd),
      listed_at: textOrNull(p.listed_at),
      gecko_id: textOrNull(p.gecko_id),
      symbol: textOrNull(p.symbol),
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null when it passes every check. */
export function boardProblem(board: Row[], snap: Snap): string | null {
  const present = new Set(board.map((r) => r.slug));
  const absent = snap.watchlist.filter((s) => !present.has(s));
  if (absent.length > 0) {
    return `watchlist coverage: ${absent.length} missing (${absent.slice(0, 5).join(', ')})`;
  }
  const seenRanks = new Set<number>();
  for (const row of board) {
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > board.length || seenRanks.has(row.rank)) {
      return `rank ${row.rank} on ${row.slug} is not one of 1..${board.length} exactly once`;
    }
    seenRanks.add(row.rank);
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${board[i]!.slug}) outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share implied value $${board[0]!.implied_value_usd}: not a ranking`;
  }
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} carries implied value ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} carries ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) {
        return `${row.slug} carries a farm step of ${step.length} characters`;
      }
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script tag's worth, no fetch, no network. */
export function dataJs(radar: Dash): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
