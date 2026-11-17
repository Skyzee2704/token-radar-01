// Token radar, model layer (rewritten).
//
// One sealed snapshot goes in; one ranked board comes out. The board is the
// watchlist plus the early radar: pre-token protocols under the watchlist
// floor that the radar exists to surface. Live-token protocols never enter
// the ranking — the market already prices them, so they are shown apart with
// their own market caps.
//
// How a row earns its number (model radar-2). Everything below comes from
// the snapshot itself; no protocol name is ever given special treatment:
//
//   peer     median mcap/TVL across live-token protocols in the row's own
//            category, when that category has at least 3 live peers, else
//            the median across every live-token protocol; clamped 0.05–1.50
//   base     TVL x peer
//   growth   the 7-day TVL move, clamped to [-60, +120]%, half-weighted
//   age      days since first listing (365 when unlisted), maturing from
//            0.6 toward 1.0 across 1095 days
//   chains   1 + 0.04 per extra chain, up to 5 extra
//   implied  round(base x growth x maturity x chains), at least $1
//
// The peer multiple is rounded to four decimals before it is multiplied, so
// the number board.json carries and the number the dashboard recomputes are
// the same number, digit for digit.

/** One protocol exactly as the sealed snapshot records it. */
export interface SnapshotProtocol {
  slug: string; // DefiLlama key, unique across the snapshot
  name: string; // display name
  category: string | null; // null when DefiLlama names none
  chains: string[]; // chains the protocol reports
  tvl_usd: number; // whole dollars, truncated
  change_7d: number | null; // 7-day TVL change in percent, null when unreported
  mcap_usd: number | null; // null when no token is recorded
  listed_at: string | null; // first tracked day (UTC), null when unknown
  gecko_id: string | null; // null when no token is recorded
  symbol: string | null; // null when no token is recorded
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string; // UTC date of the fetch, YYYY-MM-DD
  source: string; // endpoint and exact fetch time
  floor_usd: number; // watchlist floor in whole dollars
  protocols: SnapshotProtocol[]; // every protocol at or above $5M TVL, by slug
  watchlist: string[]; // slugs the house rule kept
}

/** The model's tuning knobs, printed on the dashboard so the page can redo the maths. */
export interface ModelConstants {
  growth_weight: number; // how much of the 7-day move counts
  growth_floor: number; // lowest 7-day move the model credits, percent
  growth_cap: number; // highest 7-day move the model credits, percent
  maturity_floor: number; // multiplier of a protocol listed yesterday
  maturity_range: number; // extra multiplier earned over the maturity window
  maturity_days: number; // days until a protocol counts as fully mature
  unknown_age_days: number; // age assumed when listed_at is missing
  peer_min: number; // lowest peer multiple the model allows
  peer_max: number; // highest peer multiple the model allows
  peer_min_peers: number; // live peers a category needs before its own median counts
  chain_step: number; // multiplier added per extra chain
  chain_max_extra: number; // extra chains that count, at most
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_min: 0.05,
  peer_max: 1.5,
  peer_min_peers: 3,
  chain_step: 0.04,
  chain_max_extra: 5,
};

/** The model version the dashboard names and the rules quote. */
export const MODEL_VERSION = 'radar-2';

/** Early-radar cap: pre-token protocols below the floor, taken by TVL. */
export const EARLY_ROWS = 260;

/** Live-token cap: protocols already trading, taken by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string; // the action itself
  cost: string; // money at stake, gas included
  time: string; // wall-clock time the step needs
}

/** A row of board.json. */
export interface BoardRow {
  rank: number; // 1..N, strongest implied value first
  slug: string; // snapshot key
  name: string; // display name
  category: string | null; // snapshot category
  chains: string[]; // snapshot chains
  tvl_usd: number; // snapshot TVL
  change_7d: number | null; // snapshot 7-day change
  mcap_usd: number | null; // null: pre-token rows record no token
  listed_at: string | null; // snapshot first-tracked day
  gecko_id: string | null; // null: pre-token rows record no token
  symbol: string | null; // null: pre-token rows record no token
  token_status: 'pre-token'; // every board row is pre-token
  age_days: number | null; // days since listed_at, null when unknown
  implied_value_usd: number; // the model's number, whole dollars
  model: {
    peer_multiple: number; // rounded to 4 decimals, before use
    peer_count: number; // live peers the multiple rests on
    growth_pct: number; // clamped 7-day move
    growth_multiplier: number; // 1 + growth x weight
    maturity_multiplier: number; // 0.6..1.0 by age
    chain_multiplier: number; // 1 + 0.04 per extra chain
    age_days: number | null; // same age as the row's own field
  };
  farm_steps: string[]; // seven rendered steps, 20..600 chars each
}

/** A board row slimmed down for data.js; the page rebuilds the farm plan from it. */
export interface RadarRow {
  rank: number; // board rank
  slug: string; // snapshot key
  name: string; // display name
  category: string | null; // snapshot category
  chains: string[]; // snapshot chains
  tvl_usd: number; // snapshot TVL
  change_7d: number | null; // snapshot 7-day change
  mcap_usd: number | null; // null on every pre-token row
  listed_at: string | null; // snapshot first-tracked day
  age_days: number | null; // days since listed_at
  implied_value_usd: number; // the model's number
  growth_multiplier: number; // from the row's model block
  maturity_multiplier: number; // from the row's model block
  peer_multiple: number; // from the row's model block
  peer_count: number; // from the row's model block
  chain_multiplier: number; // from the row's model block
}

/** A live-token protocol, shown with the market's own value instead of a model's. */
export interface LiveRow {
  slug: string; // snapshot key
  name: string; // display name
  category: string | null; // snapshot category
  chains: string[]; // snapshot chains
  tvl_usd: number; // snapshot TVL
  mcap_usd: number | null; // the market cap the market itself sets
  change_7d: number | null; // snapshot 7-day change
}

/** Everything the dashboard renders, in one object. */
export interface RadarData {
  as_of: string; // snapshot date
  source: string; // snapshot source line
  floor_usd: number; // watchlist floor
  model: ModelConstants; // tuning knobs, for the page's recompute
  model_version: string; // 'radar-2'
  watchlist_size: number; // watchlist slugs
  board_size: number; // rows on the board
  early_size: number; // board rows from below the floor
  live_size: number; // live-token protocols set aside
  peer_global: number; // global median mcap/TVL, 4 decimals
  peer_categories: { category: string; multiple: number; peers: number }[]; // per-category medians
  rows: RadarRow[]; // the board, slimmed
  live: LiveRow[]; // live-token protocols, by market cap
}

/** A snapshot that cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** Round to four decimals, the precision the board and the page both carry. */
const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Clamp `n` into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** `value` when it is a finite number, `fallback` otherwise. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is missing or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The middle of an ascending array, or `fallback` for an empty one. */
function middleOf(ascending: number[], fallback: number): number {
  const n = ascending.length;
  if (n === 0) return fallback;
  const half = Math.floor(n / 2);
  if (n % 2 === 1) return ascending[half]!;
  return (ascending[half - 1]! + ascending[half]!) / 2;
}

/** Text order: -1, 0 or 1, for deterministic tie-breaks. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The peer table: per-category medians plus the global fallback, computed once per snapshot. */
export interface PeerTable {
  byCategory: Map<string, { multiple: number; peers: number }>; // category -> median + peer count
  global: number; // global median, clamped
  globalPeers: number; // live-token protocols behind the global median
}

/** Clamp a raw peer multiple into the model's allowed band. */
function clampPeer(raw: number, tune: ModelConstants): number {
  return clamp(raw, tune.peer_min, tune.peer_max);
}

export function peerTable(snapshot: Snapshot, tune: ModelConstants = MODEL): PeerTable {
  const buckets = new Map<string, number[]>();
  const every: number[] = [];
  for (const proto of snapshot.protocols) {
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
  const global = clampPeer(middleOf(every, 0.25), tune);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, ratios] of buckets) {
    ratios.sort((a, b) => a - b);
    const peers = ratios.length;
    // A category with too few live peers borrows the global median instead
    // of trusting a median built on one or two tokens.
    const multiple = peers >= tune.peer_min_peers ? clampPeer(middleOf(ratios, global), tune) : global;
    byCategory.set(key, { multiple, peers });
  }
  return { byCategory, global, globalPeers: every.length };
}

/** One protocol's score: the implied value plus every multiplier that built it. */
export interface ScoreCard {
  value: number; // implied value, whole dollars, at least $1
  growthPct: number; // clamped 7-day move
  growthMult: number; // 1 + growth x weight
  maturityMult: number; // 0.6..1.0 by age
  chainMult: number; // 1 + 0.04 per extra chain
  peerMult: number; // rounded to 4 decimals before use
  peerCount: number; // live peers behind the multiple
  age: number | null; // days since first listing
}

export function scoreProtocol(
  proto: SnapshotProtocol,
  asOf: string,
  tune: ModelConstants,
  peers: PeerTable,
): ScoreCard {
  const age = ageInDays(asOf, proto.listed_at);
  const growthPct = clamp(asNumber(proto.change_7d, 0), tune.growth_floor, tune.growth_cap);
  const growthMult = 1 + (growthPct / 100) * tune.growth_weight;
  const ageUsed = age ?? tune.unknown_age_days;
  const matured = clamp(ageUsed, 0, tune.maturity_days) / tune.maturity_days;
  const maturityMult = tune.maturity_floor + matured * tune.maturity_range;
  const entry = peers.byCategory.get(proto.category ?? 'Other');
  // Round the peer multiple BEFORE multiplying: board.json and the dashboard
  // both print the rounded figure, so the page's recompute lands exactly.
  const peerMult = round4dp(entry?.multiple ?? peers.global);
  // The count the multiple actually rests on: the category's peers when it
  // has enough, otherwise the whole live-token set behind the global median.
  const peerCount = entry !== undefined && entry.peers >= tune.peer_min_peers ? entry.peers : peers.globalPeers;
  const extraChains = clamp(proto.chains.length - 1, 0, tune.chain_max_extra);
  const chainMult = 1 + tune.chain_step * extraChains;
  const base = proto.tvl_usd * peerMult;
  const value = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { value, growthPct, growthMult, maturityMult, chainMult, peerMult, peerCount, age };
}

/** A name ending in a release marker (V2, v2, 2.0 ...) is a pool of another protocol, not its own. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the snapshot records no token for the protocol at all. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the protocol may be ranked: pre-token, not an exchange, not a versioned pool. */
export function canRank(p: SnapshotProtocol): boolean {
  return hasNoToken(p) && p.category !== 'CEX' && !VERSION_TAIL.test(p.name);
}

/** Protocols keyed by slug, for the watchlist lookup. */
function indexBySlug(list: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of list) index.set(p.slug, p);
  return index;
}

/** Early-radar picks: rankable pre-token protocols below the floor, richest TVL first. */
function earlyPicks(snapshot: Snapshot, chosen: Map<string, SnapshotProtocol>): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && canRank(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareText(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
}

/** One scored protocol turned into its board row, with the key order board.json prints. */
function toBoardRow(p: SnapshotProtocol, score: ScoreCard, rank: number): BoardRow {
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: score.age,
    implied_value_usd: score.value,
    model: {
      peer_multiple: round4dp(score.peerMult),
      peer_count: score.peerCount,
      growth_pct: score.growthPct,
      growth_multiplier: round4dp(score.growthMult),
      maturity_multiplier: round4dp(score.maturityMult),
      chain_multiplier: round4dp(score.chainMult),
      age_days: score.age,
    },
    farm_steps: farmSteps(p, score.age).map(renderStep),
  };
}

/** The ranked board: watchlist first (the floor), early radar on top, strongest first. */
export function buildBoard(snapshot: Snapshot, tune: ModelConstants = MODEL): BoardRow[] {
  const lookup = indexBySlug(snapshot.protocols);
  const peers = peerTable(snapshot, tune);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot
  // no longer carries — coverage is the gate's row and is never gambled.
  for (const slug of snapshot.watchlist) {
    const hit = lookup.get(slug);
    if (hit !== undefined) chosen.set(slug, hit);
  }
  // The early radar adds below-floor protocols; a chosen protocol stays chosen.
  for (const p of earlyPicks(snapshot, chosen)) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ proto: p, score: scoreProtocol(p, snapshot.as_of, tune, peers) }));
  scored.sort((a, b) => b.score.value - a.score.value || compareText(a.proto.slug, b.proto.slug));
  return scored.map((entry, i) => toBoardRow(entry.proto, entry.score, i + 1));
}

/** Render one farm step as a single string: action, then cost and time, within 20..600 chars. */
export function renderStep(step: FarmStep): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/** First chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital one farm position needs, sized from the protocol's own TVL. */
function stakeFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Holding window, from the protocol's age: younger protocols need a longer qualifying run. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category rule: the keywords it matches and the action line it writes. */
interface ActionRule {
  keys: string[]; // lowercase substrings of the category
  line: (name: string, amount: number, chain: string) => string;
}

/**
 * The category's one action, as a table instead of a chain of branches: the
 * first rule whose keyword appears in the category wins. The fallback at the
 * end is a plain deposit, for categories no rule names. Every rule names the
 * chain and the capital, so the step is an instruction, not a slogan.
 */
const ACTION_RULES: ActionRule[] = [
  {
    keys: ['liquid staking', 'staking pool'],
    line: (n, a, c) => `Stake $${a} of the chain's staking asset through ${n} on ${c} and hold the liquid staking receipt.`,
  },
  {
    keys: ['lend', 'cdp', 'collateral'],
    line: (n, a, c) => `Supply $${a} of USDC to ${n} on ${c} and keep the position open.`,
  },
  {
    keys: ['dex', 'yield aggregator', 'leveraged farm', 'farm', 'liquidity manager'],
    line: (n, a, c) => `Provide $${a} of liquidity to ${n}'s main pool on ${c} and keep the position open.`,
  },
  {
    keys: ['bridge'],
    line: (n, a, c) => `Bridge $${a} of USDC to ${c} through ${n} and use the bridged funds in its app.`,
  },
  {
    keys: ['restak', 'staking'],
    line: (n, a, c) => `Stake $${a} of the chain's staking asset through ${n} and keep the receipt.`,
  },
  {
    keys: ['perpetual', 'derivative', 'basis trading'],
    line: (n, a, c) => `Deposit $${a} of USDC as margin on ${n} and open one small hedge.`,
  },
  {
    keys: ['prediction'],
    line: (n, a, c) => `Fund $${a} and place one market position on ${n}.`,
  },
  {
    keys: ['curator', 'allocator', 'aggregator'],
    line: (n, a, c) => `Deposit $${a} into a ${n} vault on ${c} and keep the shares.`,
  },
  {
    keys: ['stable'],
    line: (n, a, c) => `Mint or deposit $${a} of the stable asset through ${n} on ${c}.`,
  },
  {
    keys: ['rwa'],
    line: (n, a, c) => `Mint $${a} of the protocol's yield asset on ${c} and hold it.`,
  },
  {
    keys: ['insurance'],
    line: (n, a, c) => `Buy $${a} of cover from ${n} on ${c} and keep the policy.`,
  },
  {
    keys: ['btc', 'bitcoin'],
    line: (n, a, c) => `Deposit $${a} of BTC into ${n} on ${c} and hold the receipt.`,
  },
  {
    keys: ['cedefi'],
    line: (n, a, c) => `Deposit $${a} into a ${n} vault on ${c} and keep the shares.`,
  },
  {
    keys: ['chain'],
    line: (n, a, c) => `Bridge $${a} of USDC to ${n} and use one app on the chain.`,
  },
];

/** The category's action line, or the plain-deposit fallback. */
function actionLine(p: SnapshotProtocol, amount: number, chain: string): string {
  const lowered = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.keys.some((k) => lowered.includes(k))) return rule.line(p.name, amount, chain);
  }
  return `Deposit $${amount} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** One category rule for the weekly repeat: what to do each week to stay active. */
interface WeeklyRule {
  keys: string[]; // lowercase substrings of the category
  line: (name: string, amount: number, chain: string) => string;
}

const WEEKLY_RULES: WeeklyRule[] = [
  {
    keys: ['liquid staking', 'staking pool', 'restak', 'staking'],
    line: (n) => `Claim the staking rewards on ${n} and restake them, so the position compounds.`,
  },
  {
    keys: ['lend', 'cdp', 'collateral'],
    line: (n, a) => `Repay a slice of the borrow on ${n} and re-supply $${a}, so the loan stays healthy and the activity repeats.`,
  },
  {
    keys: ['dex', 'yield aggregator', 'leveraged farm', 'farm', 'liquidity manager'],
    line: (n) => `Swap a small amount through ${n}'s pool and top up the liquidity, so the position earns fees again.`,
  },
  {
    keys: ['bridge'],
    line: (n, a) => `Bridge $${a} back through ${n} and use the funds in a second app, so the bridge sees repeat use.`,
  },
  {
    keys: ['perpetual', 'derivative', 'basis trading'],
    line: (n) => `Close the hedge on ${n} and reopen it at the new funding rate, so the position stays active.`,
  },
  {
    keys: ['prediction'],
    line: (n) => `Settle one market on ${n} and open another, so the account keeps a live position.`,
  },
  {
    keys: ['curator', 'allocator', 'aggregator', 'cedefi'],
    line: (n) => `Check ${n}'s vault allocation and rebalance if it drifted, so the shares keep earning.`,
  },
  {
    keys: ['stable', 'rwa'],
    line: (n) => `Check the peg and the yield on ${n} and top up if the rate moved.`,
  },
  {
    keys: ['insurance'],
    line: (n) => `Check the cover's expiry on ${n} and renew it before it lapses.`,
  },
  {
    keys: ['btc', 'bitcoin'],
    line: (n) => `Check the BTC peg on ${n} and the yield it pays, and top up if the rate moved.`,
  },
  {
    keys: ['chain'],
    line: (n) => `Use one more app on ${n} this week, so the chain sees repeat activity.`,
  },
];

/** The category's weekly repeat, or the plain qualifying-action fallback. */
function weeklyLine(p: SnapshotProtocol, amount: number, chain: string): string {
  const lowered = (p.category ?? '').toLowerCase();
  for (const rule of WEEKLY_RULES) {
    if (rule.keys.some((k) => lowered.includes(k))) return rule.line(p.name, amount, chain);
  }
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * The risk line: sized from the protocol's own record. A young protocol gets
 * a size-and-audit warning; a large one gets a note that any airdrop is split
 * across many farmers; a sharp weekly fall gets a check-the-drop warning.
 */
function riskLine(p: SnapshotProtocol, age: number | null): string {
  if (age !== null && age < 90) {
    return (
      `This protocol is young (${age} days on record): size the position small, ` +
      `verify its audit before adding funds, and never use leverage.`
    );
  }
  if (p.change_7d !== null && p.change_7d <= -20) {
    return (
      `TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in a week: check whether the drop is an ` +
      `outflow or a price move before adding funds.`
    );
  }
  if (p.tvl_usd >= 1_000_000_000) {
    return (
      `At $${(p.tvl_usd / 1e9).toFixed(1)}B of TVL the position is liquid, but any airdrop is split ` +
      `across many farmers: size for the yield, not the airdrop.`
    );
  }
  return 'Size the position so a 50% drawdown costs less than a week of income, and never borrow to farm.';
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age, weekly
 * move) — never from a hand-written list of names. The action, the weekly
 * repeat and the risk line all vary by category; the last step is the exit:
 * how to unwind safely and what to check before claiming anything.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const amount = stakeFor(p);
  const hold = holdFor(age);
  const action = actionLine(p, amount, chain);
  const weekly = weeklyLine(p, amount, chain);
  const risk = riskLine(p, age);
  const gasBig = amount >= 150 ? 8 : 4;
  return [
    {
      text:
        'Use a fresh wallet that holds only the funds you plan to farm, ' +
        'and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${amount} of capital and about $${gasBig} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${amount} stays in the position`,
      time: `${hold} days`,
    },
    {
      text:
        "Before you withdraw, open the protocol's own points or rewards page " +
        'and claim only from the link it publishes.',
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text:
        'Write the wallet, the dates and every transaction in a farm log ' +
        'so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: risk,
      cost: 'nothing to check, and it caps what you stake',
      time: '10 minutes before you add funds',
    },
    {
      text:
        "When you exit, withdraw in two parts a day apart and check the position's value " +
        'after each part, so a failed withdrawal is caught while half the funds are still in.',
      cost: 'about $4 of gas for the two withdrawals',
      time: '10 minutes over 2 days',
    },
  ];
}

/** The live-token protocols, richest market cap first, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !hasNoToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's slim form for data.js; the page regenerates the farm plan from it. */
export function toRadarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Headline figures for the run's summary line. */
export interface BoardSummary {
  watchlist_size: number; // slugs on the watchlist
  board_size: number; // rows ranked
  early_size: number; // rows from below the floor
  live_size: number; // live-token protocols set aside
}

/** Everything the dashboard renders, built from one snapshot. */
export function buildRadar(snapshot: Snapshot, tune: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, tune);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot, tune);
  let early = 0;
  for (const row of board) if (!snapshot.watchlist.includes(row.slug)) early++;
  const peerCategories = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4dp(v.multiple), peers: v.peers }))
    .sort(
      (a, b) => b.peers - a.peers || a.category.localeCompare(b.category),
    );
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: tune,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    peer_global: round4dp(peers.global),
    peer_categories: peerCategories,
    rows: board.map(toRadarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const present = new Set(board.map((r) => r.slug));
  const absent = snapshot.watchlist.filter((s) => !present.has(s));
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
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
