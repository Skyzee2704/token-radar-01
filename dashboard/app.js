// Token Radar's dashboard (rewritten). It reads window.RADAR — the dataset
// main.ts writes beside dashboard/ — and renders the ranked board, the
// filters, and a per-protocol drawer carrying the model's own inputs plus
// the protocol's farm plan. No network: every byte shown lives in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('app');
  var view = { q: '', cat: 'all', chain: 'all', tab: 'pre', sortKey: 'implied', sortDir: -1, picked: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** Short money: $557.9M, $332.3M, $1.2K, or the full figure when small. */
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, redone in the page: peer multiple x TVL, times the growth,
  // maturity and chain multipliers. The drawer recomputes a row with this
  // and checks the number against the one board.json carries, so the page's
  // arithmetic and the board's data are visibly the same calculation.
  // radar-2: peer = median mcap/TVL of live tokens in the row's category.
  function recompute(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = (row.chains || []).length;
    var chainMult = 1 + model.chain_step * Math.min(Math.max(chains - 1, 0), model.chain_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity * chainMult));
  }

  /** Tiny DOM builder: h('div', {cls, txt, onClick, ...attrs}, ...children). */
  function h(tag, props) {
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
    { keys: ['lend', 'cdp', 'collateral'], make: function (nm, amt, ch) { return 'Supply $' + amt + ' of USDC to ' + nm + ' on ' + ch + ' and keep the position open.'; } },
    { keys: ['dex', 'yield', 'leveraged farm'], make: function (nm, amt, ch) { return 'Provide $' + amt + ' of liquidity to ' + nm + "'s main pool on " + ch + ' and keep the position open.'; } },
    { keys: ['bridge'], make: function (nm, amt, ch) { return 'Bridge $' + amt + ' of USDC to ' + ch + ' through ' + nm + ' and use the bridged funds in its app.'; } },
    { keys: ['staking', 'restak'], make: function (nm, amt, ch) { return 'Stake $' + amt + " of the chain's staking asset through " + nm + ' and keep the receipt.'; } },
    { keys: ['perpetual', 'derivative'], make: function (nm, amt, ch) { return 'Deposit $' + amt + ' of USDC as margin on ' + nm + ' and open one small hedge.'; } },
    { keys: ['prediction'], make: function (nm, amt, ch) { return 'Fund $' + amt + ' and place one market position on ' + nm + '.'; } },
    { keys: ['curator', 'allocator'], make: function (nm, amt, ch) { return 'Deposit $' + amt + ' into a ' + nm + ' vault on ' + ch + ' and keep the shares.'; } },
    { keys: ['stable'], make: function (nm, amt, ch) { return 'Mint or deposit $' + amt + ' of the stable asset through ' + nm + ' on ' + ch + '.'; } },
    { keys: ['rwa'], make: function (nm, amt, ch) { return 'Mint $' + amt + " of the protocol's yield asset on " + ch + ' and hold it.'; } },
    { keys: ['insurance'], make: function (nm, amt, ch) { return 'Buy $' + amt + ' of cover from ' + nm + ' on ' + ch + ' and keep the policy.'; } }
  ];
  function actionLine(p, amt, ch) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < PLAN_RULES.length; i++) {
      var rule = PLAN_RULES[i];
      if (rule.keys.some(function (k) { return c.indexOf(k) >= 0; })) return rule.make(p.name, amt, ch);
    }
    return 'Deposit $' + amt + ' of USDC into ' + p.name + ' on ' + ch + ' and keep the position open.';
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
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + amt + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'When you exit, withdraw in two parts a day apart and check the position\'s value after each part, so a failed withdrawal is caught while half the funds are still in.', cost: 'about $4 of gas for the two withdrawals', time: '10 minutes over 2 days' }
    ].map(renderStep);
  }

  /** Deep-link state in the hash: q, p, category, chain. */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.picked = params.get('p');
    if (params.get('category')) view.cat = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.cat !== 'all') params.set('category', view.cat);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.picked) params.set('p', view.picked);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** Rows after the search, category and chain filters. */
  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.cat !== 'all' && r.category !== view.cat) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  /** Rows in the current sort order; ties break on slug so the order is stable. */
  function orderedRows(list) {
    var key = view.sortKey;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.sortDir;
      if (av > bv) return view.sortDir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return h('header', { cls: 'masthead' },
      h('div', { cls: 'wordmark' }, h('span', { cls: 'dot' }), h('span', { cls: 'wordmark-text', txt: 'Token Radar' })),
      h('div', { cls: 'masthead-meta' },
        h('span', { txt: 'Snapshot ' + DATA.as_of }),
        h('span', { txt: 'DefiLlama protocol index' }),
        h('span', { txt: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return h('section', { cls: 'intro' },
      h('div', null,
        h('h1', { txt: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { txt: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      h('div', { cls: 'stats' },
        h('div', { cls: 'stat' }, h('span', { txt: 'Watchlist covered' }), h('b', { txt: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { cls: 'stat' }, h('span', { txt: 'Pre-token rows scored' }), h('b', { txt: String(DATA.board_size) })),
        h('div', { cls: 'stat' }, h('span', { txt: 'Early rows below the floor' }), h('b', { txt: String(DATA.early_size) })),
        h('div', { cls: 'stat' }, h('span', { txt: 'Live-token protocols set aside' }), h('b', { txt: String(DATA.live_size) }))
      )
    );
  }

  function toolbar() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); paint(); });
    var catSel = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', txt: 'All categories' }),
      cats.map(function (c) { return h('option', { value: c, txt: c, selected: c === view.cat ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { view.cat = catSel.value; writeHash(); paint(); });
    var allChains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSel = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', txt: 'All chains' }),
      allChains.map(function (c) { return h('option', { value: c, txt: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { view.chain = chainSel.value; writeHash(); paint(); });
    var preBtn = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre' ? 'true' : 'false', txt: 'Pre-token', onClick: function () { view.tab = 'pre'; paint(); } });
    var liveBtn = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', txt: 'Live token', onClick: function () { view.tab = 'live'; paint(); } });
    return h('div', { cls: 'toolbar' },
      h('div', { cls: 'ctl' }, h('label', { for: 'q', txt: 'Search' }), search),
      h('div', { cls: 'ctl' }, h('label', { for: 'category', txt: 'Category' }), catSel),
      h('div', { cls: 'ctl' }, h('label', { for: 'chain', txt: 'Chain' }), chainSel),
      h('div', { cls: 'ctl' }, h('span', { cls: 'fine', txt: 'Token status' }), h('div', { cls: 'seg' }, preBtn, liveBtn)),
      h('span', { cls: 'tally', txt: view.tab === 'pre' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  /** A sortable column header: click to sort, click again to flip. */
  function sortHead(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onClick: function () { if (view.sortKey === key) view.sortDir = -view.sortDir; else { view.sortKey = key; view.sortDir = -1; } paint(); } },
        label,
        view.sortKey === key ? h('span', { 'aria-hidden': 'true', txt: view.sortDir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  /** One protocol's two-line cell: name above, category and chains below. */
  function whoCell(r) {
    return h('div', { cls: 'who' },
      h('b', { txt: r.name }),
      h('span', { cls: 'fine', txt: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
    );
  }

  function boardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { cls: 'card' }, h('div', { cls: 'noresults' },
        h('h2', { txt: 'No protocol matches that filter' }),
        h('p', { txt: 'Clear the search or pick another category to see the board again.' }),
        h('button', { cls: 'btn go', type: 'button', txt: 'Clear filters', onClick: function () { view.q = ''; view.cat = 'all'; writeHash(); paint(); } })
      ));
    }
    var top = list[0].implied_value_usd || 1;
    var body = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var row = h('tr', {
        'data-picked': view.picked === r.slug ? 'true' : 'false',
        tabindex: '0',
        onClick: function () { openDrawer(r.slug); },
        onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
      },
        h('td', { cls: 'fig', txt: String(r.rank) }),
        h('td', null, whoCell(r)),
        h('td', { cls: 'fig', txt: money(r.tvl_usd) }),
        h('td', { cls: 'fig ' + growthCls, txt: growth }),
        h('td', { cls: 'fig', txt: ageLabel(r.age_days) }),
        h('td', null, h('div', { cls: 'value' },
          h('div', { cls: 'meter', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + '%' })),
          h('span', { cls: 'fig', txt: money(r.implied_value_usd) })
        )),
        h('td', null, h('span', { cls: 'tag', txt: 'no token' }))
      );
      body.appendChild(row);
    });
    return h('div', { cls: 'card' },
      h('div', { cls: 'scroll' },
        h('table', null,
          h('caption', { cls: 'fine', txt: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            h('th', { scope: 'col', txt: 'Token' })
          )),
          body
        )
      )
    );
  }

  function liveTable() {
    var body = h('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(h('tr', null,
        h('td', { cls: 'fig', txt: 'live' }),
        h('td', null, whoCell(r)),
        h('td', { cls: 'fig', txt: money(r.tvl_usd) }),
        h('td', { cls: 'fig ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), txt: pct(r.change_7d) }),
        h('td', { cls: 'fig', txt: money(r.mcap_usd) }),
        h('td', null, h('span', { cls: 'tag', txt: 'already trades' }))
      ));
    });
    return h('div', { cls: 'card' },
      h('div', { cls: 'scroll' },
        h('table', null,
          h('caption', { cls: 'fine', txt: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', txt: 'Status' }), h('th', { scope: 'col', txt: 'Protocol' }), h('th', { scope: 'col', txt: 'TVL' }), h('th', { scope: 'col', txt: '7d' }), h('th', { scope: 'col', txt: 'Market cap' }), h('th', { scope: 'col', txt: 'Token' }))),
          body
        )
      )
    );
  }

  function howtoPanel() {
    var m = DATA.model;
    var peers = (DATA.peer_categories || []).slice(0, 12);
    return h('section', { cls: 'card howto' },
      h('h2', { txt: 'How implied value is computed' }),
      h('p', { cls: 'fine', txt: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { cls: 'math' },
        'implied = round( tvl_usd x peer_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_extra + ')) )'
      ),
      h('p', { cls: 'fine', txt: 'The peer multiple is the median market-cap-per-TVL of the live-token protocols in the same category, taken from this snapshot (global median ' + DATA.peer_global + ' where a category has fewer than ' + m.peer_min_peers + ' live peers, clamped to ' + m.peer_min + '-' + m.peer_max + '). TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      h('h3', { txt: 'Peer multiples by category (median mcap / TVL of live tokens)' }),
      h('div', { cls: 'scroll' },
        h('table', { cls: 'peer-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', txt: 'Category' }), h('th', { scope: 'col', txt: 'Peer multiple' }), h('th', { scope: 'col', txt: 'Live peers' }))),
          h('tbody', null, peers.map(function (p) {
            return h('tr', null, h('td', { txt: p.category }), h('td', { cls: 'fig', txt: String(p.multiple) }), h('td', { cls: 'fig', txt: String(p.peers) }));
          }))
        )
      )
    );
  }

  var drawer = h('dialog', { cls: 'drawer', id: 'detail', 'aria-labelledby': 'detail-title' });
  drawer.addEventListener('close', function () { view.picked = null; writeHash(); });

  function openDrawer(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.picked = slug;
    writeHash();
    drawer.textContent = '';
    var steps = farmPlan(row);
    var again = recompute(row, DATA.model);
    var check = again === row.implied_value_usd
      ? ', the same number board.json carries.'
      : ', which differs from the board: the data would be stale.';
    drawer.appendChild(h('div', { cls: 'drawer-head' },
      h('div', null,
        h('span', { cls: 'wordmark-text', txt: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', txt: row.name }),
        h('p', { cls: 'fine', txt: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { cls: 'shut', type: 'button', 'aria-label': 'Close details', txt: 'Close', onClick: function () { drawer.close(); } })
    ));
    drawer.appendChild(h('section', { cls: 'drawer-sec' },
      h('h3', { txt: 'Implied value' }),
      h('div', { cls: 'breakdown' },
        h('div', null, h('span', { txt: 'TVL' }), h('b', { cls: 'fig', txt: money(row.tvl_usd) })),
        h('div', null, h('span', { txt: 'Peer multiple (' + (row.category || 'Other') + ', ' + row.peer_count + ' live peers)' }), h('b', { cls: 'fig', txt: String(row.peer_multiple) })),
        h('div', null, h('span', { txt: 'Seven-day growth' }), h('b', { cls: 'fig', txt: pct(row.change_7d) })),
        h('div', null, h('span', { txt: 'Age with no token' }), h('b', { cls: 'fig', txt: ageLabel(row.age_days) })),
        h('div', null, h('span', { txt: 'Chains (' + (row.chains || []).length + ')' }), h('b', { cls: 'fig', txt: String(row.chain_multiplier) })),
        h('div', null, h('span', { txt: 'Growth multiplier' }), h('b', { cls: 'fig', txt: String(row.growth_multiplier) })),
        h('div', null, h('span', { txt: 'Maturity multiplier' }), h('b', { cls: 'fig', txt: String(row.maturity_multiplier) })),
        h('div', null, h('span', { txt: 'Implied value' }), h('b', { cls: 'fig', txt: money(row.implied_value_usd) }))
      ),
      h('p', { cls: 'fine', txt: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(again) + check + ' This is an estimate, not a price.' })
    ));
    drawer.appendChild(h('section', { cls: 'drawer-sec' },
      h('h3', { txt: 'Farm plan' }),
      h('ol', { cls: 'plan' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { txt: action }), h('span', { cls: 'price', txt: tail }));
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
    var shell = h('div', { cls: 'wrap' });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    shell.appendChild(toolbar());
    shell.appendChild(view.tab === 'pre' ? boardTable() : liveTable());
    if (view.tab === 'pre') shell.appendChild(howtoPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) mount.appendChild(drawer);
    if (view.picked) openDrawer(view.picked);
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
