// Token Radar's dashboard (fresh rewrite). It reads window.RADAR — the dataset
// main.ts writes beside dashboard/ — and renders the ranked board, the
// filters, and a per-protocol drawer carrying the model's own inputs plus
// the protocol's farm plan. No network: every byte shown lives in data.js.
(function () {
  'use strict';

  var BOARD = window.RADAR;
  if (!BOARD) return;
  var mount = document.getElementById('app');
  var state = { q: '', cat: 'all', chain: 'all', tab: 'pre', sortKey: 'implied', sortDir: -1, picked: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** Short money: $557.9M, $332.3M, $1.2K, or the full figure when small. */
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, redone in the page: peer multiple x TVL, times the growth,
  // maturity and chain multipliers. The drawer recomputes a row with this
  // and checks the number against the one board.json carries, so the page's
  // arithmetic and the board's data are visibly the same calculation.
  // radar-2: peer = median mcap/TVL of live tokens in the row's category.
  function recheck(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = (row.chains || []).length;
    var chainMult = 1 + model.chain_step * Math.min(Math.max(chains - 1, 0), model.chain_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity * chainMult));
  }
  /** One sentence that says why this row ranks where it does, from its own numbers. */
  function reasonLine(row) {
    var week = row.change_7d === null || row.change_7d === undefined
      ? 'a week with no recorded change'
      : (row.change_7d >= 0 ? '+' : '') + row.change_7d.toFixed(1) + '% in the last week';
    var s = row.name + ' ranks ' + row.rank + ' because its ' + fmtMoney(row.tvl_usd) + ' of TVL, valued at ' + row.peer_multiple + 'x by its ' + row.peer_count + ' live ' + (row.category || 'Other') + ' peers, gives a ' + fmtMoney(row.implied_value_usd) + ' implied value after ' + week + '.';
    if (row.maturity_multiplier > 1) s += ' Its ' + row.age_days + ' days with no token multiply it by ' + row.maturity_multiplier + 'x.';
    if (row.growth_multiplier > 1) s += ' Strong growth multiplies it by ' + row.growth_multiplier + 'x.';
    if (row.growth_multiplier < 1) s += ' A shrinking week multiplies it by ' + row.growth_multiplier + 'x.';
    return s;
  }

  /** Tiny DOM builder: el('div', {cls, txt, onClick, ...attrs}, ...children). */
  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined) return;
        if (k === 'cls') node.className = v;
        else if (k === 'txt') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) kid.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes into board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  // Templates use {N} for the name, {A} for the capital, {C} for the chain;
  // a literal $ before {A} is the dollar sign the sentence prints.
  function plug(t, nm, amt, ch) {
    return t.split('{N}').join(nm).split('{A}').join(String(amt)).split('{C}').join(ch);
  }
  function mainChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  var PLAN_RULES = [
    { keys: ['liquid staking', 'staking pool'], make: function (nm, amt, ch) { return plug("Stake ${A} of the chain's staking asset through {N} on {C} and hold the liquid staking receipt.", nm, amt, ch); } },
    { keys: ['lend', 'cdp', 'collateral'], make: function (nm, amt, ch) { return plug('Supply ${A} of USDC to {N} on {C} and keep the position open.', nm, amt, ch); } },
    { keys: ['dex', 'yield aggregator', 'leveraged farm', 'farm', 'liquidity manager'], make: function (nm, amt, ch) { return plug("Provide ${A} of liquidity to {N}'s main pool on {C} and keep the position open.", nm, amt, ch); } },
    { keys: ['bridge'], make: function (nm, amt, ch) { return plug('Bridge ${A} of USDC to {C} through {N} and use the bridged funds in its app.', nm, amt, ch); } },
    { keys: ['restak', 'staking'], make: function (nm, amt, ch) { return plug("Stake ${A} of the chain's staking asset through {N} and keep the receipt.", nm, amt, ch); } },
    { keys: ['perpetual', 'derivative', 'basis trading'], make: function (nm, amt, ch) { return plug('Deposit ${A} of USDC as margin on {N} and open one small hedge.', nm, amt, ch); } },
    { keys: ['prediction'], make: function (nm, amt, ch) { return plug('Fund ${A} and place one market position on {N}.', nm, amt, ch); } },
    { keys: ['curator', 'allocator', 'aggregator'], make: function (nm, amt, ch) { return plug('Deposit ${A} into a {N} vault on {C} and keep the shares.', nm, amt, ch); } },
    { keys: ['stable'], make: function (nm, amt, ch) { return plug('Mint or deposit ${A} of the stable asset through {N} on {C}.', nm, amt, ch); } },
    { keys: ['rwa'], make: function (nm, amt, ch) { return plug("Mint ${A} of the protocol's yield asset on {C} and hold it.", nm, amt, ch); } },
    { keys: ['insurance'], make: function (nm, amt, ch) { return plug('Buy ${A} of cover from {N} on {C} and keep the policy.', nm, amt, ch); } },
    { keys: ['btc', 'bitcoin'], make: function (nm, amt, ch) { return plug('Deposit ${A} of BTC into {N} on {C} and hold the receipt.', nm, amt, ch); } },
    { keys: ['cedefi'], make: function (nm, amt, ch) { return plug('Deposit ${A} into a {N} vault on {C} and keep the shares.', nm, amt, ch); } },
    { keys: ['chain'], make: function (nm, amt, ch) { return plug('Bridge ${A} of USDC to {N} and use one app on the chain.', nm, amt, ch); } }
  ];
  function actionLine(p, amt, ch) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < PLAN_RULES.length; i++) {
      var rule = PLAN_RULES[i];
      if (rule.keys.some(function (k) { return c.indexOf(k) >= 0; })) return rule.make(p.name, amt, ch);
    }
    return plug('Deposit ${A} of USDC into {N} on {C} and keep the position open.', p.name, amt, ch);
  }
  var WEEKLY_RULES = [
    { keys: ['liquid staking', 'staking pool', 'restak', 'staking'], make: function (nm) { return plug('Claim the staking rewards on {N} and restake them, so the position compounds.', nm, 0, ''); } },
    { keys: ['lend', 'cdp', 'collateral'], make: function (nm, amt) { return plug('Repay a slice of the borrow on {N} and re-supply ${A}, so the loan stays healthy and the activity repeats.', nm, amt, ''); } },
    { keys: ['dex', 'yield aggregator', 'leveraged farm', 'farm', 'liquidity manager'], make: function (nm) { return plug("Swap a small amount through {N}'s pool and top up the liquidity, so the position earns fees again.", nm, 0, ''); } },
    { keys: ['bridge'], make: function (nm, amt) { return plug('Bridge ${A} back through {N} and use the funds in a second app, so the bridge sees repeat use.', nm, amt, ''); } },
    { keys: ['perpetual', 'derivative', 'basis trading'], make: function (nm) { return plug('Close the hedge on {N} and reopen it at the new funding rate, so the position stays active.', nm, 0, ''); } },
    { keys: ['prediction'], make: function (nm) { return plug('Settle one market on {N} and open another, so the account keeps a live position.', nm, 0, ''); } },
    { keys: ['curator', 'allocator', 'aggregator', 'cedefi'], make: function (nm) { return plug("Check {N}'s vault allocation and rebalance if it drifted, so the shares keep earning.", nm, 0, ''); } },
    { keys: ['stable', 'rwa'], make: function (nm) { return plug('Check the peg and the yield on {N} and top up if the rate moved.', nm, 0, ''); } },
    { keys: ['insurance'], make: function (nm) { return plug("Check the cover's expiry on {N} and renew it before it lapses.", nm, 0, ''); } },
    { keys: ['btc', 'bitcoin'], make: function (nm) { return plug('Check the BTC peg on {N} and the yield it pays, and top up if the rate moved.', nm, 0, ''); } },
    { keys: ['chain'], make: function (nm) { return plug('Use one more app on {N} this week, so the chain sees repeat activity.', nm, 0, ''); } }
  ];
  function weeklyLine(p, amt, ch) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < WEEKLY_RULES.length; i++) {
      var rule = WEEKLY_RULES[i];
      if (rule.keys.some(function (k) { return c.indexOf(k) >= 0; })) return rule.make(p.name, amt, ch);
    }
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function riskLine(p) {
    var age = p.age_days;
    if (age !== null && age !== undefined && age < 90) {
      return 'This protocol is young (' + age + ' days on record): size the position small, verify its audit before adding funds, and never use leverage.';
    }
    if (p.change_7d !== null && p.change_7d !== undefined && p.change_7d <= -20) {
      return 'TVL fell ' + Math.abs(p.change_7d).toFixed(1) + '% in a week: check whether the drop is an outflow or a price move before adding funds.';
    }
    if (p.tvl_usd >= 1e9) {
      return 'At $' + (p.tvl_usd / 1e9).toFixed(1) + 'B of TVL the position is liquid, but any airdrop is split across many farmers: size for the yield, not the airdrop.';
    }
    return 'Size the position so a 50% drawdown costs less than a week of income, and never borrow to farm.';
  }
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmPlan(p) {
    var ch = mainChain(p);
    var amt = stakeFor(p);
    var hold = holdFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionLine(p, amt, ch), cost: '$' + amt + ' of capital and about $' + (amt >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyLine(p, amt, ch), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + amt + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: riskLine(p), cost: 'nothing to check, and it caps what you stake', time: '10 minutes before you add funds' },
      { text: 'When you exit, withdraw in two parts a day apart and check the position\'s value after each part, so a failed withdrawal is caught while half the funds are still in.', cost: 'about $4 of gas for the two withdrawals', time: '10 minutes over 2 days' }
    ].map(renderStep);
  }

  /** Deep-link state in the hash: q, p, category, chain. */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.picked = params.get('p');
    if (params.get('category')) state.cat = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat !== 'all') params.set('category', state.cat);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.picked) params.set('p', state.picked);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** Rows after the search, category and chain filters. */
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return BOARD.rows.filter(function (r) {
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  /** Rows in the current sort order; ties break on slug so the order is stable. */
  function orderedRows(list) {
    var key = state.sortKey;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.sortDir;
      if (av > bv) return state.sortDir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return el('header', { cls: 'masthead' },
      el('div', { cls: 'wordmark' }, el('span', { cls: 'dot' }), el('span', { cls: 'wordmark-text', txt: 'Token Radar' })),
      el('div', { cls: 'masthead-meta' },
        el('span', { txt: 'Snapshot ' + BOARD.as_of }),
        el('span', { txt: 'DefiLlama protocol index' }),
        el('span', { txt: BOARD.model_version + ' model' })
      )
    );
  }

  function intro() {
    return el('section', { cls: 'intro' },
      el('div', null,
        el('h1', { txt: BOARD.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { txt: 'The watchlist is the floor: every protocol with at least $' + Math.round(BOARD.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + BOARD.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { cls: 'stats' },
        el('div', { cls: 'stat' }, el('span', { txt: 'Watchlist covered' }), el('b', { txt: BOARD.watchlist_size + ' / ' + BOARD.watchlist_size })),
        el('div', { cls: 'stat' }, el('span', { txt: 'Pre-token rows scored' }), el('b', { txt: String(BOARD.board_size) })),
        el('div', { cls: 'stat' }, el('span', { txt: 'Early rows below the floor' }), el('b', { txt: String(BOARD.early_size) })),
        el('div', { cls: 'stat' }, el('span', { txt: 'Live-token protocols set aside' }), el('b', { txt: String(BOARD.live_size) }))
      )
    );
  }
  /** The top three as cards, each with its one-line reason, above the table. */
  function spotlight() {
    var top = BOARD.rows.slice(0, 3);
    return el('section', { cls: 'spot', 'aria-label': 'Top three' },
      el('h2', { txt: 'Top three' }),
      el('div', { cls: 'spot-grid' }, top.map(function (row) {
        var why = reasonLine(row).split('. ')[0] + '.';
        return el('article', { cls: 'spot-card', tabindex: '0',
          onClick: function () { openDrawer(row.slug); },
          onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(row.slug); } } },
          el('span', { cls: 'spot-rank', txt: '#' + row.rank }),
          el('h3', { txt: row.name }),
          el('p', { cls: 'spot-val', txt: fmtMoney(row.implied_value_usd) + ' implied' }),
          el('p', { cls: 'spot-why', txt: why })
        );
      }))
    );
  }

  function toolbar() {
    var cats = Array.from(new Set(BOARD.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); paint(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', txt: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, txt: c, selected: c === state.cat ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.cat = catSel.value; writeHash(); paint(); });
    var allChains = Array.from(new Set(BOARD.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', txt: 'All chains' }),
      allChains.map(function (c) { return el('option', { value: c, txt: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); paint(); });
    var preBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', txt: 'Pre-token', onClick: function () { state.tab = 'pre'; paint(); } });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', txt: 'Live token', onClick: function () { state.tab = 'live'; paint(); } });
    return el('div', { cls: 'toolbar' },
      el('div', { cls: 'ctl' }, el('label', { for: 'q', txt: 'Search' }), search),
      el('div', { cls: 'ctl' }, el('label', { for: 'category', txt: 'Category' }), catSel),
      el('div', { cls: 'ctl' }, el('label', { for: 'chain', txt: 'Chain' }), chainSel),
      el('div', { cls: 'ctl' }, el('span', { cls: 'fine', txt: 'Token status' }), el('div', { cls: 'seg' }, preBtn, liveBtn)),
      el('span', { cls: 'tally', txt: state.tab === 'pre' ? visibleRows().length + ' rows shown' : BOARD.live.length + ' live-token protocols' })
    );
  }

  /** A sortable column header: click to sort, click again to flip. */
  function sortHead(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onClick: function () { if (state.sortKey === key) state.sortDir = -state.sortDir; else { state.sortKey = key; state.sortDir = -1; } paint(); } },
        label,
        state.sortKey === key ? el('span', { 'aria-hidden': 'true', txt: state.sortDir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  /** One protocol's two-line cell: name above, category and chains below. */
  function whoCell(r) {
    return el('div', { cls: 'who' },
      el('b', { txt: r.name }),
      el('span', { cls: 'fine', txt: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
    );
  }

  function boardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { cls: 'card' }, el('div', { cls: 'noresults' },
        el('h2', { txt: 'No protocol matches that filter' }),
        el('p', { txt: 'Clear the search or pick another category to see the board again.' }),
        el('button', { cls: 'btn go', type: 'button', txt: 'Clear filters', onClick: function () { state.q = ''; state.cat = 'all'; writeHash(); paint(); } })
      ));
    }
    var top = list[0].implied_value_usd || 1;
    var body = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var row = el('tr', {
        'data-picked': state.picked === r.slug ? 'true' : 'false',
        tabindex: '0',
        onClick: function () { openDrawer(r.slug); },
        onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
      },
        el('td', { cls: 'fig', txt: String(r.rank) }),
        el('td', null, whoCell(r)),
        el('td', { cls: 'fig', txt: fmtMoney(r.tvl_usd) }),
        el('td', { cls: 'fig ' + growthCls, txt: growth }),
        el('td', { cls: 'fig', txt: fmtAge(r.age_days) }),
        el('td', null, el('div', { cls: 'value' },
          el('div', { cls: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + '%' })),
          el('span', { cls: 'fig', txt: fmtMoney(r.implied_value_usd) })
        )),
        el('td', null, el('span', { cls: 'tag', txt: 'no token' }))
      );
      body.appendChild(row);
    });
    return el('div', { cls: 'card' },
      el('div', { cls: 'scroll' },
        el('table', null,
          el('caption', { cls: 'fine', txt: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            el('th', { scope: 'col', txt: 'Token' })
          )),
          body
        )
      )
    );
  }

  function liveTable() {
    var body = el('tbody');
    BOARD.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', { cls: 'fig', txt: 'live' }),
        el('td', null, whoCell(r)),
        el('td', { cls: 'fig', txt: fmtMoney(r.tvl_usd) }),
        el('td', { cls: 'fig ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), txt: fmtPct(r.change_7d) }),
        el('td', { cls: 'fig', txt: fmtMoney(r.mcap_usd) }),
        el('td', null, el('span', { cls: 'tag', txt: 'already trades' }))
      ));
    });
    return el('div', { cls: 'card' },
      el('div', { cls: 'scroll' },
        el('table', null,
          el('caption', { cls: 'fine', txt: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', txt: 'Status' }), el('th', { scope: 'col', txt: 'Protocol' }), el('th', { scope: 'col', txt: 'TVL' }), el('th', { scope: 'col', txt: '7d' }), el('th', { scope: 'col', txt: 'Market cap' }), el('th', { scope: 'col', txt: 'Token' }))),
          body
        )
      )
    );
  }

  function howtoPanel() {
    var m = BOARD.model;
    var peers = (BOARD.peer_categories || []).slice(0, 12);
    return el('section', { cls: 'card howto' },
      el('h2', { txt: 'How implied value is computed' }),
      el('p', { cls: 'fine', txt: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { cls: 'math' },
        'implied = round( tvl_usd x peer_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_extra + ')) )'
      ),
      el('p', { cls: 'fine', txt: 'The peer multiple is the median market-cap-per-TVL of the live-token protocols in the same category, taken from this snapshot (global median ' + BOARD.peer_global + ' where a category has fewer than ' + m.peer_min_peers + ' live peers, clamped to ' + m.peer_min + '-' + m.peer_max + '). TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('h3', { txt: 'Peer multiples by category (median mcap / TVL of live tokens)' }),
      el('div', { cls: 'scroll' },
        el('table', { cls: 'peer-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', txt: 'Category' }), el('th', { scope: 'col', txt: 'Peer multiple' }), el('th', { scope: 'col', txt: 'Live peers' }))),
          el('tbody', null, peers.map(function (p) {
            return el('tr', null, el('td', { txt: p.category }), el('td', { cls: 'fig', txt: String(p.multiple) }), el('td', { cls: 'fig', txt: String(p.peers) }));
          }))
        )
      )
    );
  }

  var drawer = el('dialog', { cls: 'drawer', id: 'detail', 'aria-labelledby': 'detail-title' });
  drawer.addEventListener('close', function () { state.picked = null; writeHash(); });

  function openDrawer(slug) {
    var row = BOARD.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.picked = slug;
    writeHash();
    drawer.textContent = '';
    var steps = farmPlan(row);
    var again = recheck(row, BOARD.model);
    var check = again === row.implied_value_usd
      ? ', the same number board.json carries.'
      : ', which differs from the board: the data would be stale.';
    drawer.appendChild(el('div', { cls: 'drawer-head' },
      el('div', null,
        el('span', { cls: 'wordmark-text', txt: 'Rank ' + row.rank + ' of ' + BOARD.board_size }),
        el('h2', { id: 'detail-title', txt: row.name }),
        el('p', { cls: 'fine', txt: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { cls: 'shut', type: 'button', 'aria-label': 'Close details', txt: 'Close', onClick: function () { drawer.close(); } })
    ));
    drawer.appendChild(el('section', { cls: 'drawer-sec' },
      el('h3', { txt: 'Implied value' }),
      el('div', { cls: 'breakdown' },
        el('div', null, el('span', { txt: 'TVL' }), el('b', { cls: 'fig', txt: fmtMoney(row.tvl_usd) })),
        el('div', null, el('span', { txt: 'Peer multiple (' + (row.category || 'Other') + ', ' + row.peer_count + ' live peers)' }), el('b', { cls: 'fig', txt: String(row.peer_multiple) })),
        el('div', null, el('span', { txt: 'Seven-day growth' }), el('b', { cls: 'fig', txt: fmtPct(row.change_7d) })),
        el('div', null, el('span', { txt: 'Age with no token' }), el('b', { cls: 'fig', txt: fmtAge(row.age_days) })),
        el('div', null, el('span', { txt: 'Chains (' + (row.chains || []).length + ')' }), el('b', { cls: 'fig', txt: String(row.chain_multiplier) })),
        el('div', null, el('span', { txt: 'Growth multiplier' }), el('b', { cls: 'fig', txt: String(row.growth_multiplier) })),
        el('div', null, el('span', { txt: 'Maturity multiplier' }), el('b', { cls: 'fig', txt: String(row.maturity_multiplier) })),
        el('div', null, el('span', { txt: 'Implied value' }), el('b', { cls: 'fig', txt: fmtMoney(row.implied_value_usd) }))
      ),
      el('p', { cls: 'why', txt: reasonLine(row) }),
      el('p', { cls: 'fine', txt: 'Model ' + BOARD.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtMoney(again) + check + ' This is an estimate, not a price.' })
    ));
    drawer.appendChild(el('section', { cls: 'drawer-sec' },
      el('h3', { txt: 'Farm plan' }),
      el('ol', { cls: 'plan' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { txt: action }), el('span', { cls: 'price', txt: tail }));
      }))
    ));
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function paint() {
    mount.textContent = '';
    var shell = el('div', { cls: 'wrap' });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    shell.appendChild(spotlight());
    shell.appendChild(toolbar());
    shell.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    if (state.tab === 'pre') shell.appendChild(howtoPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) mount.appendChild(drawer);
    if (state.picked) openDrawer(state.picked);
  }

  readHash();
  paint();
  // Back/forward through deep links re-reads the hash and repaints.
  window.addEventListener('hashchange', function () {
    readHash();
    paint();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });
})();
