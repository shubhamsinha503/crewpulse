/* CrewPulse — app screens. Plain JS, no build step, runs fully offline.
   Shows YOUR data only (day log on this device). The Demo Band is the only simulated part, and it is labelled. */
(function () {
  const Q = window.CP;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LVL = { ok: 'Normal', watch: 'Watch', act: 'Act today', none: 'No data yet' };
  const KEY = 'crewpulse-v2';

  // ---------- state (saved on this device only) ----------
  const DEFAULT = { theme: 'light', queue: [], sent: [], done: {}, levers: [], range: 30, metric: 'sleep' };
  let S;
  try { S = Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = { ...DEFAULT }; }
  try { const old = JSON.parse(localStorage.getItem('crewpulse-v1') || 'null'); if (old) { if (old.theme && !localStorage.getItem(KEY)) S.theme = old.theme; localStorage.removeItem('crewpulse-v1'); } } catch (e) { /* ignore */ }
  if (!Array.isArray(S.levers)) S.levers = [];
  // New look (Oct 2026) is light-first: switch everyone to light once; they can still pick dark in About.
  if (S.themeV !== 2) { S.theme = 'light'; S.themeV = 2; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: keep in memory */ } };

  let ME = null;
  function regen() { ME = Q.build(); }
  const crew = () => ME;
  const analysis = () => Q.analyze(ME);
  const fc = (c = ME, lv) => Q.forecast(ME, ME.today, lv === undefined ? S.levers : lv);
  const pctTxt = (p) => (p == null ? '—' : p + '%');
  const checkedIn = () => !!(ME.today && ME.today.at && ((ME.today.values && Object.keys(ME.today.values).length) || (ME.today.symptoms && ME.today.symptoms.length)));

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- header / you bar ----------
  function renderHeader() {
    $('#mdLabel').textContent = Q.daysLogged ? 'Log day ' + Q.N : 'Day 1';
    $('#profileLabel').textContent = Q.daysLogged
      ? `${Q.daysLogged} day${Q.daysLogged === 1 ? '' : 's'} logged since ${Q.fmtDate(Q.startDate)} · ${Q.SAMPLE ? 'sample data (simulated)' : 'your data only'}`
      : 'No readings yet · your data only';
    const B = Q.band, st = B.state;
    const word = st === 'live' ? (B.source === 'demo' ? 'Demo Band (simulated)' : 'Band live') : st === 'connecting' ? 'Band connecting…' : st === 'lost' ? 'Band reconnecting…' : 'Band not connected';
    $('#passPill').innerHTML = `<i class="dot ${st === 'live' ? (B.source === 'demo' ? 'watch' : 'ok') : st === 'off' ? '' : 'watch'}"></i><span class="lg-only">${word}</span><span class="sm-only">${st === 'live' ? (B.source === 'demo' ? 'Demo' : 'Band') : 'No Band'}</span>`;
    const n = S.queue.length;
    const b = $('#qbadge'); b.hidden = !n; b.textContent = n;
  }
  function renderCrewbar() { $('#crewbar').innerHTML = youCard(); }

  // ---------- TODAY ----------
  function deltaText(r) {
    const M = Q.METRICS[r.m];
    if (!r.readings) return 'No readings yet';
    if (r.recent == null) return 'No reading in the last 7 days';
    if (!r.baseline.ready) return r.baseline.label;
    if (M.base === 'target') return Math.round((r.recent / r.baseline.mean) * 100) + '% of target';
    const sign = r.pct >= 0 ? '+' : '−';
    return sign + Math.abs(r.pct).toFixed(Math.abs(r.pct) < 10 ? 1 : 0) + '% vs your normal';
  }
  const checks = (key, list) => { const done = S.done['me|' + key] || []; return list.map((t, i) => `<li><label><input type="checkbox" data-done="${key}|${i}" ${done.includes(i) ? 'checked' : ''}/><span>${esc(t)}</span></label></li>`).join(''); };
  const queueBtn = (key) => (S.queue.some((q) => q.key === key) ? `<button class="btn ghost" data-unqueue="${key}">✓ Queued for next report</button>` : `<button class="btn" data-queue="${key}">Add to next report</button>`);
  function alertCard(a) {
    const chips = a.metrics.map((m) => `<a class="chip" href="#trends/${m}">${Q.METRICS[m].short} →</a>`).join('');
    return `<article class="alert ${a.level}">
      <header><span class="lvl ${a.level}">${LVL[a.level]}</span><h3>${esc(a.title)}</h3></header>
      <p class="why">${esc(a.why)}</p>
      <div class="cols">
        <div><h4>Do now</h4><ul class="checks">${checks(a.key, a.now)}</ul></div>
        <div class="ground"><h4>Tell your flight surgeon</h4><p>${esc(a.ground)}</p>${queueBtn(a.key)}</div>
      </div>
      ${chips ? '<footer>' + chips + '</footer>' : ''}
    </article>`;
  }
  function tile(r) {
    const M = Q.METRICS[r.m];
    const s = ME.series[r.m].slice(-30);
    const norm = r.baseline.ready ? (M.base === 'target' ? 'Target ' : 'Normal ') + Q.fmt(r.m, r.baseline.mean) + ' · ' : '';
    return `<a class="tile ${r.level}" href="#trends/${r.m}">
      <div class="t-top"><span>${M.short}</span><span class="lvl ${r.level}">${LVL[r.level]}</span></div>
      <div class="t-val">${Q.fmt(r.m, r.today)}<small>${M.unit}</small></div>
      <div class="t-sub">${norm}${esc(deltaText(r))}</div>
      ${Q.sparkline(s, r.level)}
    </a>`;
  }
  function condCard(x, open) {
    const key = 'c-' + x.key;
    const need = x.missing.map((m) => Q.METRICS[m].short).join(', ');
    const drivers = !x.ready
      ? `<li>Not enough data yet. Needs 3 days of: ${esc(need)}.</li>`
      : x.drivers.length
        ? x.drivers.map((d) => `<li>${esc(d.text)}${d.streak >= 2 ? ` <span class="streak">${d.streak} readings in a row</span>` : ''}</li>`).join('')
        : '<li>All readings close to your normal.</li>';
    const partial = x.ready && x.missing.length ? `<li class="muted">Not counted yet (no normal): ${esc(need)}</li>` : '';
    const firstM = (x.drivers.find((d) => d.m) || {}).m || Object.keys(x.weights)[0];
    return `<details class="cond ${x.wx}" id="cond-${x.key}" ${open ? 'open' : ''}>
      <summary>
        ${Q.wxIcon(x.wx, 44)}
        <span class="c-main"><strong>${x.label}</strong><span class="c-wx">${Q.WX[x.wx].word}</span></span>
        ${Q.condSpark(x.hist, x.proj, x.wx)}
        <span class="c-tm" title="Chance it needs attention (Watch or Act today) tomorrow"><b>${pctTxt(x.prob[0])}</b><small>tomorrow</small></span>
      </summary>
      <div class="c-body">
        <p class="why">${esc(x.why)}</p>
        <div class="cols">
          <div><h4>Why the forecast says this</h4><ul class="drivers">${drivers}${partial}</ul>
            ${x.ready ? `<h4>Do now</h4><ul class="checks">${checks(key, x.now)}</ul>` : ''}</div>
          ${x.ready ? `<div class="ground"><h4>Tell your flight surgeon</h4><p>${esc(x.ground)}</p>${queueBtn(key)}</div>` : `<div><h4>How to fill it</h4><p><a class="btn ghost" href="#checkin">Do today's check-in</a></p></div>`}
        </div>
        <footer><a class="chip" href="#trends/${firstM}">See trend and forecast →</a></footer>
      </div>
    </details>`;
  }
  // Hand-drawn astronaut for the body map (viewBox 400x380, centred on x=200). Outline = --text, fill = --card.
  // Colour accents (patch, belt, boots, gloves, antenna) use the decorative palette, never status colours.
  const ASTRONAUT = `<defs><linearGradient id="visorG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--vis-1)"/><stop offset="1" style="stop-color:var(--vis-2)"/></linearGradient></defs>
  <g class="astro">
    <rect class="a-fill" x="146" y="128" width="108" height="118" rx="20"/>
    <path class="a-limb-o" d="M156 156 C132 168 120 196 116 230"/><path class="a-limb-i" d="M156 156 C132 168 120 196 116 230"/>
    <circle class="a-fill a-glove" cx="115" cy="240" r="13"/>
    <g class="a-arm-r"><path class="a-limb-o" d="M244 156 C268 168 280 196 284 230"/><path class="a-limb-i" d="M244 156 C268 168 280 196 284 230"/>
      <circle class="a-fill a-glove" cx="285" cy="240" r="13"/></g>
    <path class="a-leg-o" d="M178 256 L175 320"/><path class="a-leg-i" d="M178 256 L175 320"/>
    <path class="a-leg-o" d="M222 256 L225 320"/><path class="a-leg-i" d="M222 256 L225 320"/>
    <rect class="a-fill a-boot" x="150" y="316" width="46" height="24" rx="11"/><rect class="a-fill a-boot" x="204" y="316" width="46" height="24" rx="11"/>
    <path class="a-fill" d="M150 150 Q150 140 160 140 H240 Q250 140 250 150 L256 250 Q256 262 244 262 H156 Q144 262 144 250 Z"/>
    <rect class="a-belt" x="146" y="229" width="109" height="13" rx="3"/>
    <circle class="a-patch" cx="163" cy="166" r="9"/><path class="a-patch-star" d="M163 160.5 l1.6 3.4 3.7.4 -2.8 2.5 .8 3.6 -3.3-1.9 -3.3 1.9 .8-3.6 -2.8-2.5 3.7-.4z"/>
    <rect class="a-panel" x="182" y="176" width="44" height="32" rx="8"/>
    <circle class="a-beat" cx="194" cy="192" r="3.5"/><circle class="a-dot a-heart" cx="194" cy="192" r="3.5"/><path class="a-line a-c1" d="M204 186 H216"/><path class="a-line a-c2" d="M204 197 H214"/>
    <rect class="a-fill" x="168" y="132" width="64" height="15" rx="7.5"/>
    <path class="a-line" d="M236 42 L247 25"/><circle class="a-fill a-ant" cx="249" cy="22" r="5"/>
    <circle class="a-fill" cx="200" cy="88" r="56"/>
    <rect class="a-visor" x="160" y="60" width="80" height="54" rx="26" style="fill:url(#visorG)"/>
    <path class="a-shine" d="M174 78 Q182 68 196 67"/>
  </g>`;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Count a number up from 0 (the final value is already in the HTML, so no-JS / reduced motion just shows it).
  function countUp(el) {
    const end = Number(el.dataset.count); if (!Number.isFinite(end) || calm()) return;
    const node = el.firstChild, t0 = performance.now(), dur = 900;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.nodeValue = String(Math.round(end * e)); if (k < 1) requestAnimationFrame(tick); };
    node.nodeValue = '0'; requestAnimationFrame(tick);
  }
  // Wavy "worm" progress bar (12wave-style loader): n of N days logged.
  function waveMeter(n, N, label) {
    const W = 300, P = 48, A = 7, frac = Math.min(n, N) / N, xEnd = Math.max(10, frac * W);
    const y = (x) => (15 + A * Math.sin((x / P) * 2 * Math.PI)).toFixed(1);
    let d = `M${-P} ${y(-P)}`; for (let x = -P + 4; x <= W + P; x += 4) d += ` L${x} ${y(x)}`;
    const delay = (((xEnd / P) % 1) - 1) * 1.6; // keep the head on the wave
    const id = 'wv' + Math.random().toString(36).slice(2, 7);
    return `<div class="wave-meter"><svg viewBox="-12 -4 ${W + 28} 38" aria-hidden="true">
        <path class="wave-track" d="M0 15 H${W}"/>
        <clipPath id="${id}"><rect x="-12" y="-4" width="${xEnd + 12}" height="38"/></clipPath>
        <g clip-path="url(#${id})"><path class="wave-body" d="${d}"/></g>
        <g transform="translate(${xEnd.toFixed(1)} 15)"><g class="wave-head" style="animation-delay:${delay.toFixed(2)}s">
          <circle r="8.5"/><circle class="eye" cx="1.5" cy="-2.5" r="2.6"/><circle class="eye" cx="7" cy="-2.5" r="2.6"/><circle class="pupil" cx="2.3" cy="-2.3" r="1.2"/><circle class="pupil" cx="7.8" cy="-2.3" r="1.2"/></g></g>
        <circle class="wave-goal" cx="${W}" cy="15" r="5"/></svg>
        <p class="wave-label"><b>${Math.min(n, N)} of ${N} days</b> ${label}</p></div>`;
  }
  let flown = false; // the greeting fly-by rocket shows once per visit
  // small line icons for the big-number tiles (each tile has its own decorative colour)
  const ki = (d) => `<svg class="k-ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const KICON = {
    sleep: ki('<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>'),
    hrv: ki('<path d="M3 12h3l2-5 3 10 3-8 2 3h5"/>'),
    rt: ki('<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3.5h4M18 6.5l1.5-1.5"/>'),
    rhr: ki('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  };

  function renderToday() {
    const a = analysis(), lv = S.levers;
    const f = fc(), f0 = fc(ME, []);
    const d0 = f.days[0];
    const conds = Object.values(f.conditions).sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
    const warnings = a.alerts.filter((x) => x.symptom);
    const feels = conds.filter((x) => x.score >= 1.4).map((x) => x.feels);
    const ci = checkedIn();
    const maxP = (arr) => Math.max(0, ...arr.filter((v) => v != null));
    const relevant = Q.LEVERS.filter((l) => l.conds.some((k) => f0.conditions[k].ready && (f0.conditions[k].score >= 1.4 || maxP(f0.conditions[k].prob) >= 30)));
    const leverHtml = relevant.map((l) => {
      const fl = fc(ME, [l.id]);
      const gain = (k) => (f0.conditions[k].prob[0] ?? 0) - (fl.conditions[k].prob[0] ?? 0);
      const k = l.conds.reduce((b, x) => (gain(x) > gain(b) ? x : b), l.conds[0]);
      return `<label class="lever"><input type="checkbox" data-lever="${l.id}" ${lv.includes(l.id) ? 'checked' : ''}/>
        <span><strong>${l.label}</strong><small>${f0.conditions[k].label} tomorrow: ${pctTxt(f0.conditions[k].prob[0])} → <b>${pctTxt(fl.conditions[k].prob[0])}</b></small></span></label>`;
    }).join('');
    const days = f.days.slice(1).map((d) => `<li class="${d.wx}"><span class="d-label">${d.label}</span>${Q.wxIcon(d.wx, 44)}<strong>${d.text}</strong><small>${d.wx === 'none' ? 'Needs 3+ readings' : Q.WX[d.wx].rank >= 2 ? '<b>' + d.prob + '%</b> chance' : 'Low risk'}</small></li>`).join('');
    const order = ['sleep', 'rt', 'mood', 'stress', 'rhr', 'hrv', 'exercise', 'grip', 'mass'];
    const ready = f.ready;
    const building = Object.keys(Q.METRICS).filter((m) => m !== 'exercise').map((m) => ({ m, n: a.metrics[m].readings })).filter((x) => x.n > 0 && x.n < Q.MIN_DAYS);
    const heroText = ready ? d0.text : Q.daysLogged ? 'Building your forecast' : 'Start your forecast';
    const feelsText = ready
      ? 'Feels like: ' + esc(feels.join(' · ') || 'your normal self')
      : Q.daysLogged
        ? `CrewPulse is learning your normal. Each reading needs ${Q.MIN_DAYS} days before it counts.${building.length ? ' So far: ' + building.map((x) => `${Q.METRICS[x.m].short} ${x.n}/${Q.MIN_DAYS}`).join(' · ') + '.' : ''}`
        : 'No readings yet. Do a 2-minute check-in each day (and a calm reading with the Band). After 3 days you get your first forecast; after 14 days your normal is fully set.';
    // ---- greeting ----
    const hr = new Date().getHours();
    const hello = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    // ---- highest-risk ring (worst condition tomorrow) ----
    const readyConds = conds.filter((x) => x.ready && x.prob[0] != null);
    const worst = readyConds.reduce((b, x) => (!b || x.prob[0] > b.prob[0] ? x : b), null);
    const lvlOf = (wx) => (Q.WX[wx] ? Q.WX[wx].lvl : 'none');
    const ring = (() => {
      const N = 28, p = worst ? worst.prob[0] : 0, on = Math.round((p / 100) * N), cls = worst ? lvlOf(worst.wxProj?.[0] || worst.wx) : 'none';
      let segs = '';
      for (let i = 0; i < N; i++) {
        const a0 = Math.PI * (0.75 + (1.5 * i) / N) + 0.03, a1 = Math.PI * (0.75 + (1.5 * (i + 1)) / N) - 0.03;
        const pt = (a, r) => (60 + r * Math.cos(a)).toFixed(2) + ' ' + (60 + r * Math.sin(a)).toFixed(2);
        segs += `<path class="seg-${i < on ? cls : 'off'}" style="--i:${i}" d="M${pt(a0, 50)} A50 50 0 0 1 ${pt(a1, 50)} L${pt(a1, 40)} A40 40 0 0 0 ${pt(a0, 40)}Z"/>`;
      }
      return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true">${segs}</svg>`;
    })();
    const riskCard = `<section class="card risk-card ${worst ? '' : 'no-risk'}">
        <h4>Highest risk tomorrow</h4>
        <div class="ring-wrap">${ring}<div class="ring-val"><b ${worst ? `data-count="${worst.prob[0]}"` : ''}>${worst ? worst.prob[0] + '<small>%</small>' : '—'}</b><span>${worst ? 'chance it needs attention tomorrow' : 'needs 3+ days of readings'}</span></div></div>
        ${worst ? (() => { const twx = (worst.wxProj && worst.wxProj[0] && worst.wxProj[0] !== 'none') ? worst.wxProj[0] : worst.wx; return `<p class="risk-name">${esc(worst.label)} <span class="lvl ${lvlOf(twx)}">${Q.WX[twx].word}</span></p>`; })() : '<p class="risk-name muted">No forecast yet</p>'}
      </section>`;
    // ---- big-number tiles ----
    const kpi = (m) => { const r = a.metrics[m], M = Q.METRICS[m];
      const tag = r.level === 'none' && r.today != null ? `Normal: ${Math.min(r.readings, Q.MIN_DAYS)}/${Q.MIN_DAYS} days` : LVL[r.level];
      return `<a class="kpi ${r.level}" data-m="${m}" href="#trends/${m}"><span class="k-lab">${KICON[m] || ''}${M.short}</span><b>${Q.fmt(m, r.today)}<small>${M.unit}</small></b><span class="lvl ${r.level}">${tag}</span></a>`; };
    const kpis = `<div class="kpis">${['sleep', 'hrv', 'rt', 'rhr'].map(kpi).join('')}</div>`;
    // ---- body map (hand-drawn astronaut, conditions pinned to the body) ----
    const C = f.conditions;
    const PINS = [ // key, side, pin box top %, target point on the drawing (viewBox 400x380)
      ['mood', 'l', 14, [178, 92]], ['fatigue', 'r', 10, [226, 78]], ['heart', 'r', 44, [214, 194]], ['muscle', 'l', 70, [180, 300]],
    ];
    const pinHtml = PINS.map(([k, side, top]) => { const x = C[k]; if (!x) return ''; const p = x.ready ? x.prob[0] : null;
      return `<button class="pin pin-${side} ${x.wx}" style="top:${top}%" data-pin="${k}" aria-label="${esc(x.label)}: ${Q.WX[x.wx] ? Q.WX[x.wx].word : 'no data yet'}">
        ${Q.wxIcon(x.wx, 30)}<span class="pin-t"><strong>${esc(x.label)}</strong><span class="pin-w">${x.ready ? Q.WX[x.wx].word : 'No data yet'}</span></span><b class="pin-p">${p == null ? '—' : p + '%'}</b></button>`; }).join('');
    const leaders = PINS.map(([k, side, top, [tx, ty]]) => { const y = (top / 100) * 380 + 30, x0 = side === 'l' ? 128 : 272;
      return `<path class="leader ${C[k] ? C[k].wx : ''}" data-k="${k}" d="M${x0} ${y.toFixed(0)} C${(x0 + tx) / 2} ${y.toFixed(0)} ${(x0 + tx) / 2} ${ty} ${tx} ${ty}"/><circle class="leader-dot ${C[k] ? C[k].wx : ''}" cx="${tx}" cy="${ty}" r="4"/>`; }).join('');
    // soft pulsing halo where a condition needs attention (colour + the word on its pin)
    const halos = PINS.map(([k, , , [tx, ty]]) => { const l = C[k] && C[k].ready ? lvlOf(C[k].wx) : 'none';
      return l === 'watch' || l === 'act' ? `<circle class="halo ${l}" cx="${tx}" cy="${ty}" r="9"/>` : ''; }).join('');
    // the chest light beats at the user's own resting heart rate
    const bpm = a.metrics.rhr && a.metrics.rhr.today;
    const beat = bpm ? `style="--beat:${(60 / bpm).toFixed(2)}s"` : '';
    const bodyMap = `<section class="card body-map" aria-label="Body map">
        <h4>Body map <span class="muted">· tap a part</span></h4>
        <div class="bm-stage">
          <svg class="bm-svg ${bpm ? 'has-beat' : ''} ${ready ? '' : 'waving'}" ${beat} viewBox="0 0 400 380" aria-hidden="true">
            <g class="bm-stars"><circle cx="40" cy="40" r="1.4"/><circle cx="350" cy="30" r="1.2"/><circle cx="372" cy="210" r="1.6"/><circle cx="28" cy="250" r="1.2"/><circle cx="310" cy="350" r="1.4"/><circle cx="90" cy="345" r="1"/></g>
            <g class="astro-float">${ASTRONAUT}${halos}${leaders}</g>
          </svg>
          ${pinHtml}
        </div>
        <p class="bm-note">${bpm ? `Chest light beats at your resting heart rate: <b>${Math.round(bpm)} bpm</b>` : 'Chest light will beat at your resting heart rate once the Band has a reading'}</p>
      </section>`;
    const flyby = flown || calm() ? '' : `<svg class="flyby" viewBox="0 0 64 96" aria-hidden="true"><path class="r-flame" d="M24 70 Q32 94 40 70 Q32 80 24 70Z"/><path class="a-fill" d="M32 6 C46 18 48 40 44 66 H20 C16 40 18 18 32 6Z"/><circle class="a-visor" cx="32" cy="34" r="7"/><path class="a-fill" d="M20 50 L10 66 L20 64Z M44 50 L54 66 L44 64Z"/></svg>`;
    flown = true;
    const toNormal = Q.daysLogged < 14;
    const wave = !ready ? waveMeter(Q.daysLogged, Q.MIN_DAYS, 'to your first forecast')
      : toNormal ? waveMeter(Q.daysLogged, 14, 'until your normal is fully set') : '';
    $('#view').innerHTML = `
      <header class="greet ${d0.wx}">
        <div class="greet-planet" aria-hidden="true"></div>
        <div class="greet-orbit" aria-hidden="true"><i class="moon"></i><i class="sat"></i></div>
        ${flyby}
        <p class="eyebrow">${hello} · ${Q.fmtDate(new Date())}</p>
        <h1>${ready ? `Your body today: <span class="hl ${d0.wx}">${heroText}</span>` : heroText}</h1>
        <p class="feels">${feelsText}</p>
        ${wave}
        ${ci ? '<p class="muted small">✓ Check-in done today</p>' : ''}
        <div class="hero-actions">
          ${ci ? '' : '<a class="btn" href="#checkin">Do today\'s 2-minute check-in</a>'}
          ${ready ? `<button class="btn ghost go-btn" data-goopen aria-expanded="${!!S.goOpen}">${S.goOpen ? 'Hide go / caution check' : 'Go / caution check'}</button>` : '<a class="btn ghost" href="#band">Connect Band</a>'}
          ${!ready && !Q.SAMPLE && !Q.daysLogged ? '<a class="btn ghost" href="?sample#today">Try with sample data</a>' : ''}
        </div>
      </header>
      ${supBanner(f)}
      ${ewCard()}
      <div class="fc-grid">
        <div class="fc-left">${riskCard}${kpis}</div>
        ${bodyMap}
        <section class="card fc-right">
          <h4>Next 3 days ${lv.length && ready ? '<span class="plan">with your plan</span>' : ''}</h4>
          <ol class="wx-days vert">${days}</ol>
          <p class="wx-note">% = chance the main condition needs attention (Watch or Act today)</p>
        </section>
      </div>
      ${S.goOpen && ready ? goPanel() : ''}
      ${warnings.length ? '<h2 class="warn-h">Severe weather warning</h2>' + warnings.map((w) => alertCard(w)).join('') : ''}
      ${relevant.length ? `<section class="card levers"><h2>Change your forecast</h2>
        <p class="muted small">Tick what you plan to do and watch the forecast change. Rough estimates from typical recovery — not a medical prediction.</p>
        <div class="lever-list">${leverHtml}</div></section>` : ''}
      <h2>Your conditions <small>tap for why and what to do</small></h2>
      <div class="conds">${conds.map((x, i) => condCard(x, i === 0 && x.ready && Q.WX[x.wx].rank >= 2)).join('')}</div>
      <details class="allnums" ${ready ? '' : 'open'}><summary>All ${order.length} readings</summary>
        <div class="tiles">${order.map((m) => tile(a.metrics[m])).join('')}</div></details>
      <p class="fine">Your own data, stored only on this device. Decision support only — this app does not diagnose. Always follow your doctor or flight surgeon.</p>`;
    $('#view').querySelectorAll('[data-count]').forEach(countUp);
    const fb = $('#view').querySelector('.flyby'); if (fb) fb.addEventListener('animationend', (e) => { if (e.target === fb) fb.remove(); });
    // body-map pins open the matching condition below
    $('#view').querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => {
      const d = document.getElementById('cond-' + b.dataset.pin); if (!d) return;
      d.open = true; d.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
  }

  // ---------- CHECK-IN ----------
  let rtState = null, ciDate = null;
  function lastKnown(k) { const s = ME.series[k]; for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i]; return null; }
  function renderCheckin() {
    const today = Q.dateKey();
    if (!ciDate || ciDate > today) ciDate = today;
    const day = Q.log.get(ciDate) || { values: {}, symptoms: [] };
    const v = (k) => (day.values[k] != null ? day.values[k] : '');
    const hasSleep = day.values.sleep != null;
    const sleepV = hasSleep ? day.values.sleep : lastKnown('sleep') != null ? lastKnown('sleep') : 7;
    const scale = (name, labels, val) => `<div class="scale" role="radiogroup" aria-label="${name}">${labels.map((l, i) => `<label><input type="radio" name="${name}" value="${i + 1}" ${Number(val) === i + 1 ? 'checked' : ''}/><span><b>${i + 1}</b>${l}</span></label>`).join('')}</div>`;
    const hint = (k) => { const x = lastKnown(k); return x != null && day.values[k] == null ? `<small class="muted">last: ${Q.fmt(k, x)}</small>` : ''; };
    // decorative scenes that react to what you enter (palette colours only; status colours stay for status)
    const stars = [[14, 12, 1], [30, 26, 3], [48, 10, 5], [62, 34, 2], [24, 44, 7], [78, 12, 4], [104, 40, 6], [44, 52, 9], [70, 50, 8], [110, 14, 10]]
      .map(([x, y, h]) => `<circle cx="${x}" cy="${y}" r="${h % 3 ? 1.1 : 1.6}" data-h="${h}"/>`).join('');
    $('#view').innerHTML = `
      <section class="card ci-head">
        <div>
          <p class="eyebrow">Daily check-in · your data</p>
          <h1>${ciDate === today ? 'How are you today?' : 'Fill in ' + Q.fmtDate(Q.parseKey(ciDate))}</h1>
          <p class="muted">About 2 minutes. Saved only on this device. Leave a box empty if you didn't measure it — empty is better than a guess.</p>
          <label class="ci-date">Day <input type="date" id="ciDate" value="${ciDate}" max="${today}"/></label>
        </div>
        <div class="ci-trip" aria-hidden="true">
          <svg viewBox="0 0 240 170">
            <circle class="trip-star" cx="40" cy="40" r="1.6"/><circle class="trip-star" cx="120" cy="22" r="1.2"/><circle class="trip-star" cx="96" cy="150" r="1.4"/><circle class="trip-star" cx="226" cy="120" r="1.2"/>
            <path class="trip-path" id="tripPath" d="M18 152 C70 152 108 128 138 98 S176 64 188 60"/>
            <path class="trip-done" d="M18 152 C70 152 108 128 138 98 S176 64 188 60"/>
            <g class="trip-planet"><circle class="tp-body" cx="212" cy="46" r="24"/><circle class="tp-crater" cx="204" cy="40" r="5"/><circle class="tp-crater" cx="220" cy="54" r="3.5"/>
              <ellipse class="tp-ring" cx="212" cy="46" rx="36" ry="9" transform="rotate(-18 212 46)"/>
              <g class="trip-flag"><path class="tf-pole" d="M212 22 V2"/><path class="tf-flag" d="M212 2 L228 7 L212 12Z"/></g>
              <circle class="trip-burst" cx="212" cy="46" r="26"/></g>
            <g class="trip-rocket"><path class="tr-flame" d="M-3.5 10 Q0 21 3.5 10Z"/><path class="tr-body" d="M0 -15 C7 -9 8 1 5.5 10 H-5.5 C-8 1 -7 -9 0 -15Z"/><circle class="tr-win" cy="-3" r="2.8"/><path class="tr-body" d="M-5.5 3 L-11 11 L-5.5 10Z M5.5 3 L11 11 L5.5 10Z"/></g>
          </svg>
          <p class="trip-label"><b id="tripN">0</b> of 6 logged</p>
        </div>
      </section>
      <form id="ciForm" class="card form">
        <fieldset><legend>Sleep last night</legend>
          <div class="range"><input type="range" name="sleep" min="0" max="14" step="0.25" value="${sleepV}" oninput="this.nextElementSibling.textContent=this.value+' h';this.form.sleepSet.value='1'"/><output>${hasSleep ? sleepV + ' h' : '— h'}</output>
            <svg class="sleep-sky" viewBox="0 0 120 64" aria-hidden="true"><rect class="sky-day" width="120" height="64" rx="12"/><rect class="sky-night" width="120" height="64" rx="12"/>
              <g class="sky-stars">${stars}</g><g class="sky-moon"><circle cx="0" cy="0" r="9"/><circle class="sm-crater" cx="-3" cy="-2" r="2"/><circle class="sm-crater" cx="3" cy="3" r="1.4"/></g>
              <g class="sky-z"><text x="16" y="52">z</text><text x="26" y="46">z</text><text x="36" y="40">Z</text></g></svg></div>
          <input type="hidden" name="sleepSet" value="${hasSleep ? '1' : ''}"/>
          <p class="hint">${hasSleep ? 'Saved. Move the slider to change it.' : 'Move the slider to record your sleep. Untouched = not saved.'}</p></fieldset>
        <fieldset><legend class="leg-anim">Mood <svg class="mood-face" viewBox="0 0 24 24" aria-hidden="true"><circle class="mf-head" cx="12" cy="12" r="10"/><g class="mf-eyes"><circle cx="8.5" cy="10" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/></g><path class="mf-mouth" d="M9 15.5 H15"/></svg></legend>${scale('mood', ['Very low', 'Low', 'OK', 'Good', 'Great'], v('mood'))}</fieldset>
        <fieldset><legend class="leg-anim">Stress <svg class="stress-orbit" viewBox="0 0 28 28" aria-hidden="true"><circle class="so-ring" cx="14" cy="14" r="11"/><circle class="so-planet" cx="14" cy="14" r="5"/><g class="so-spin"><circle class="so-moon" cx="25" cy="14" r="2.4"/></g></svg></legend>${scale('stress', ['Very calm', 'Calm', 'Some', 'High', 'Very high'], v('stress'))}</fieldset>
        <fieldset><legend>Any of these today?</legend>
          <div class="symptoms">${Q.SYMPTOMS.map((s) => `<label><input type="checkbox" name="sym" value="${s.id}" ${(day.symptoms || []).includes(s.id) ? 'checked' : ''}/><span>${s.label}</span></label>`).join('')}</div></fieldset>
        <fieldset><legend>Reaction test <small>short version of NASA's PVT</small></legend>
          <p class="hint">Tap the box as soon as it turns green. 5 rounds.</p>
          <button type="button" class="rt-box" id="rtBox">Tap to start</button>
          <input type="hidden" name="rt" value="${v('rt')}"/>
          <p class="hint" id="rtOut">${day.values.rt != null ? 'Saved result: ' + day.values.rt + ' ms' : 'Optional. Skip it and nothing is saved for reaction time.'}</p></fieldset>
        <fieldset class="grid2"><legend>Exercise & strength</legend>
          <label>Exercise (min) ${hint('exercise')}<input type="number" name="exercise" min="0" max="400" inputmode="numeric" value="${v('exercise')}"/></label>
          <label><span>Grip strength (kg) <small>weekly</small> ${hint('grip')}</span><input type="number" step="0.1" name="grip" min="0" max="90" inputmode="decimal" value="${v('grip')}"/></label>
          <label><span>Body mass (kg) <small>weekly</small> ${hint('mass')}</span><input type="number" step="0.1" name="mass" min="20" max="250" inputmode="decimal" value="${v('mass')}"/></label></fieldset>
        <fieldset class="grid2"><legend>Heart <small>filled in by the Band's calm reading, or type them</small></legend>
          <label>Resting heart rate (bpm) ${hint('rhr')}<input type="number" name="rhr" min="30" max="200" inputmode="numeric" value="${v('rhr')}"/></label>
          <label>HRV (ms) ${hint('hrv')}<input type="number" name="hrv" min="5" max="300" inputmode="numeric" value="${v('hrv')}"/></label></fieldset>
        <div class="actions form-actions"><button class="btn big" type="submit">Save check-in</button><a class="btn ghost" href="#today">Cancel</a></div>
      </form>`;
    rtState = null;
    const form = $('#ciForm');
    const MOUTH = ['M9 15.5 H15', 'M8 17.5 Q12 12.5 16 17.5', 'M8 16.5 Q12 14.5 16 16.5', 'M8 15.5 H16', 'M8 14.5 Q12 17.5 16 14.5', 'M7.5 14 Q12 20 16.5 14'];
    const ORBIT = [0, 9, 5.5, 3.2, 1.7, 0.9];
    const kick = (el) => { el.classList.remove('kick'); void el.getBoundingClientRect(); el.classList.add('kick'); };
    const scenes = (changed) => {
      const fd = new FormData(form), get = (k) => fd.get(k);
      // sleep sky: more hours → darker night, more stars, higher moon, more z's
      const hs = Number(get('sleep')), set = !!get('sleepSet'), sky = form.querySelector('.sleep-sky');
      sky.classList.toggle('unset', !set);
      sky.style.setProperty('--night', (0.15 + 0.85 * Math.min(1, hs / 9)).toFixed(2));
      sky.querySelectorAll('.sky-stars circle').forEach((c) => c.classList.toggle('on', hs >= Number(c.dataset.h)));
      sky.querySelector('.sky-moon').style.transform = `translate(92px, ${(54 - Math.min(1, hs / 10) * 38).toFixed(1)}px)`;
      sky.classList.toggle('dreaming', hs >= 5);
      // mood face and stress orbit
      const m = Number(get('mood')) || 0, s = Number(get('stress')) || 0;
      const face = form.querySelector('.mood-face'); face.querySelector('.mf-mouth').setAttribute('d', MOUTH[m]); face.dataset.m = m;
      const orb = form.querySelector('.stress-orbit'); orb.dataset.s = s; if (s) orb.style.setProperty('--orb', ORBIT[s] + 's');
      if (changed === 'mood') kick(face); if (changed === 'stress') kick(orb);
      // rocket trip: one leg per section filled in
      const done = [set, m, s, get('rt'), get('exercise'), get('rhr') || get('hrv')].filter((x) => x !== '' && x != null && x !== false && x !== 0).length;
      const path = $('#tripPath'), len = path.getTotalLength(), f = done / 6, at = Math.max(0.5, len * f);
      const p = path.getPointAtLength(at), q = path.getPointAtLength(Math.min(len, at + 1)), p0 = path.getPointAtLength(Math.max(0, at - 1));
      const ang = Math.atan2(q.y - p0.y, q.x - p0.x) * 180 / Math.PI + 90;
      const rocket = document.querySelector('.trip-rocket'); rocket.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${ang.toFixed(0)}deg)`;
      document.querySelector('.trip-done').style.strokeDasharray = `${(len * f).toFixed(1)} ${len.toFixed(1)}`;
      const arrived = done === 6, planet = document.querySelector('.trip-planet');
      if (arrived && !planet.classList.contains('arrived')) planet.classList.add('arrived'); else if (!arrived) planet.classList.remove('arrived');
      $('#tripN').textContent = done;
    };
    form.addEventListener('input', (e) => scenes(e.target.name));
    form.addEventListener('change', (e) => scenes(e.target.name));
    scenes(); requestAnimationFrame(() => document.querySelector('.ci-trip')?.classList.add('ready'));
    $('#rtBox').addEventListener('pointerdown', rtTap);
    $('#ciDate').addEventListener('change', (e) => { if (e.target.value) { ciDate = e.target.value; renderCheckin(); } });
    $('#ciForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const values = {};
      for (const k of ['sleep', 'mood', 'stress', 'exercise', 'grip', 'mass', 'rhr', 'hrv', 'rt']) { const x = fd.get(k); if (x !== null && x !== '') values[k] = Number(x); }
      if (!fd.get('sleepSet')) delete values.sleep;
      const d = Q.log.get(ciDate); // a box you emptied removes that reading
      if (d) for (const k of ['exercise', 'grip', 'mass', 'rhr', 'hrv']) if (values[k] == null && d.values[k] != null) delete d.values[k];
      Q.log.record(values, { key: ciDate, symptoms: fd.getAll('sym'), source: 'checkin' });
      regen(); renderHeader();
      toast('Check-in saved on this device ✓');
      if (calm()) { location.hash = '#today'; return; }
      // a little rocket lifts off from the Save button, then we go to the forecast
      const b = e.target.querySelector('button[type=submit]').getBoundingClientRect(), el = document.createElement('div');
      el.className = 'save-rocket'; el.style.left = (b.left + b.width / 2 - 14) + 'px'; el.style.top = (b.top - 18) + 'px';
      el.innerHTML = '<svg viewBox="0 0 64 96" aria-hidden="true"><path class="r-flame" d="M24 70 Q32 94 40 70 Q32 80 24 70Z"/><path class="a-fill" d="M32 6 C46 18 48 40 44 66 H20 C16 40 18 18 32 6Z"/><circle class="a-visor" cx="32" cy="34" r="7"/><path class="a-fill" d="M20 50 L10 66 L20 64Z M44 50 L54 66 L44 64Z"/></svg>';
      document.body.appendChild(el);
      setTimeout(() => { el.remove(); location.hash = '#today'; }, 750);
    });
  }
  function rtTap(e) {
    e.preventDefault();
    const box = $('#rtBox');
    if (!rtState || rtState.phase === 'done') { rtState = { phase: 'idle', times: [] }; }
    const st = rtState;
    if (st.phase === 'wait') {
      clearTimeout(st.timer); st.phase = 'idle';
      box.className = 'rt-box early'; box.textContent = 'Too soon! Tap to try this round again';
      return;
    }
    if (st.phase === 'go') {
      const ms = Math.round(performance.now() - st.t0);
      st.times.push(ms);
      if (st.times.length >= 5) {
        const sorted = [...st.times].sort((a, b) => a - b), med = sorted[2];
        st.phase = 'done';
        box.className = 'rt-box done'; box.textContent = 'Done — ' + med + ' ms (tap to redo)';
        $('input[name=rt]').value = med; $('#ciForm').dispatchEvent(new Event('change'));
        $('#rtOut').textContent = 'Rounds: ' + st.times.join(', ') + ' ms · median ' + med + ' ms';
        return;
      }
      st.phase = 'idle'; box.className = 'rt-box'; box.textContent = ms + ' ms · round ' + (st.times.length + 1) + ' of 5 — tap to continue';
      return;
    }
    st.phase = 'wait'; box.className = 'rt-box wait'; box.textContent = 'Wait for green…';
    st.timer = setTimeout(() => { st.phase = 'go'; st.t0 = performance.now(); box.className = 'rt-box go'; box.textContent = 'TAP!'; }, 1200 + Math.random() * 2300);
  }

  // ---------- TRENDS ----------
  function renderTrends(m) {
    if (m && Q.METRICS[m]) S.metric = m;
    const a = analysis(), M = Q.METRICS[S.metric], r = a.metrics[S.metric], pj = fc().proj[S.metric];
    const chips = Object.entries(Q.METRICS).map(([k, x]) => `<a class="chip ${k === S.metric ? 'on' : ''} ${a.metrics[k].level}" href="#trends/${k}"><span class="lvl-dot ${a.metrics[k].level}" aria-hidden="true"></span>${x.short}<span class="sr"> — ${LVL[a.metrics[k].level]}</span></a>`).join('');
    const ranges = [[14, '2 wk'], [30, '30 d'], [60, '60 d'], [999, 'All']].map(([v, l]) => `<button class="seg ${S.range === v ? 'on' : ''}" data-range="${v}">${l}</button>`).join('');
    const advice = Q.ADVICE[S.metric];
    const range = Math.min(S.range, Q.N);
    $('#view').innerHTML = `
      <section class="card">
        <p class="eyebrow">Trends · your data</p>
        <div class="chips trend-chips">${chips}</div>
        <p class="dot-key" aria-hidden="true"><span><i class="lvl-dot ok"></i>${LVL.ok}</span><span><i class="lvl-dot watch"></i>${LVL.watch}</span><span><i class="lvl-dot act"></i>${LVL.act}</span><span><i class="lvl-dot none"></i>${LVL.none}</span></p>
      </section>
      <section class="card">
        <div class="chart-head"><div><h1>${M.label}</h1><p class="muted small">Source: ${M.src} · ${r.readings} reading${r.readings === 1 ? '' : 's'} · Your normal: ${esc(r.baseline.label)}</p></div><div class="segs">${ranges}</div></div>
        <div class="chart">${Q.trendChart(S.metric, ME.series[S.metric], r, Math.max(range, 7), pj)}</div>
        <ul class="legend"><li><i class="lg data"></i>Daily value</li><li><i class="lg avg"></i>3-day average</li>${pj ? `<li><i class="lg fcst"></i>Forecast (next 3 days${S.levers.length ? ', with your plan' : ''})</li>` : ''}${r.baseline.ready && r.baseline.sd ? '<li><i class="lg band"></i>Your normal range' + (M.base === 'early' ? ' (alert outside it)' : '') + '</li>' : ''}${M.base !== 'early' && r.baseline.ready ? '<li><i class="lg thresh"></i>Alert line</li>' : ''}</ul>
        <dl class="stats">
          <div><dt>Latest</dt><dd>${Q.fmt(S.metric, r.today)} <small>${M.unit}</small></dd></div>
          <div><dt>3-reading average</dt><dd>${Q.fmt(S.metric, r.recent)} <small>${M.unit}</small></dd></div>
          <div><dt>${M.base === 'target' ? 'Target' : 'Your normal'}</dt><dd>${Q.fmt(S.metric, r.baseline.ready ? r.baseline.mean : null)} <small>${M.unit}</small></dd></div>
          <div><dt>Forecast ${Q.dayLabel(Q.N + 2)}</dt><dd>${Q.fmt(S.metric, pj ? pj[2] : null)} <small>${M.unit}</small></dd></div>
        </dl>
        <p class="muted">${esc(deltaText(r))}. ${advice ? esc(advice.why) : ''}</p>
      </section>
      <section class="card how"><h2>How the forecast works</h2><ul>
        <li>We learn <b>your</b> normal from your first readings (up to ${Q.BASE_DAYS}; at least ${Q.MIN_DAYS}).</li>
        <li>We use your <b>last 3 readings</b>, so one bad night does not trigger a warning.</li>
        <li>We extend your <b>recent trend</b> 3 days ahead. Further ahead = less certain.</li>
        <li>Days you didn't measure stay empty — we never fill them in.</li>
        <li>It is a simple, explainable trend — not a medical prediction.</li>
      </ul></section>`;
  }

  // ---------- SYNC ----------
  const SIZES = { x25519: 32, kemPk: 800, kemCt: 768, sig: 2420, dsaPk: 1312, nonce: 12, tag: 16 };
  function payload() {
    const a = analysis();
    const vals = Object.fromEntries(Object.keys(Q.METRICS).map((m) => [m, a.metrics[m].recent == null ? null : +a.metrics[m].recent.toFixed(2)]));
    return JSON.stringify({ v: 2, date: Q.dateKey(), days: Q.daysLogged, status: a.overall, alerts: a.alerts.map((x) => x.key + ':' + x.level), vals, msgs: S.queue.map((q) => ({ k: q.key, t: q.text })) });
  }
  const hex = (buf, n) => Array.from(new Uint8Array(buf).slice(0, n)).map((b) => b.toString(16).padStart(2, '0')).join('');
  function renderSync() {
    const pl = new TextEncoder().encode(payload()).length;
    const total = pl + SIZES.nonce + SIZES.tag + SIZES.sig;
    const q = S.queue.map((x, i) => `<li><div><strong>${esc(x.title)}</strong><small>${esc(x.text)}</small></div><button class="icon-btn" data-del="${i}" aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></li>`).join('');
    const log = S.sent.slice(-5).reverse().map((x) => `<li><div><strong>${esc(x.label)}</strong><small>${new Date(x.at).toLocaleString()} · ${x.bytes.toLocaleString()} B · ${x.items} messages · signature check (simulated)</small></div></li>`).join('');
    $('#view').innerHTML = `
      <section class="hero sync watch">
        <div><p class="eyebrow">Sync to ground · flight surgeon</p>
        <h1>Your daily report</h1>
        <p class="muted">Built from your own log. On a mission it waits on board until the next ground pass; here the ground link is simulated.</p>
        <div class="uplink" aria-hidden="true"><svg viewBox="0 0 360 58">
          <path class="ul-arc" d="M22 44 Q180 -16 338 44"/>
          ${[0, 1, 2].map((k) => `<circle class="ul-pkt" r="3.5"><animateMotion dur="1.5s" begin="${(-k * 0.5).toFixed(1)}s" repeatCount="indefinite" path="M22 44 Q180 -16 338 44"/></circle>`).join('')}
          <circle class="ul-ship" cx="22" cy="44" r="7"/><circle class="ul-led" cx="22" cy="44" r="2.5"/>
          <circle class="ul-wave" cx="338" cy="44" r="8"/><circle class="ul-wave w2" cx="338" cy="44" r="8"/>
          <path class="ul-dish" d="M330 40 A10 10 0 0 0 346 40 Z M338 45 V54 M332 54 H344"/></svg>
          <div class="ul-lab"><span>Crew device</span><span class="ul-state">Next ground pass</span><span>Ground</span></div></div></div>
        <div class="sync-side"><svg class="rocket" viewBox="0 0 64 96" aria-hidden="true"><g class="r-body"><path class="r-flame" d="M24 70 Q32 94 40 70 Q32 80 24 70Z"/><path class="a-fill" d="M32 6 C46 18 48 40 44 66 H20 C16 40 18 18 32 6Z"/><circle class="a-visor" cx="32" cy="34" r="7"/><path class="a-fill" d="M20 50 L10 66 L20 64Z M44 50 L54 66 L44 64Z"/></g></svg>
        <div class="secure-badge"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg><div><strong>Encrypted</strong><small>AES-256 · post-quantum planned</small></div></div></div>
      </section>
      <section class="card">
        <div class="panel-head"><h2>Ready to send</h2><span class="tag">${S.queue.length + 1} item${S.queue.length ? 's' : ''} · ≈ ${total.toLocaleString()} B</span></div>
        <ul class="queue"><li class="auto"><div><strong>Daily health summary — you</strong><small>Added automatically · ${Q.daysLogged} day${Q.daysLogged === 1 ? '' : 's'} logged · ${pl.toLocaleString()} B before encryption</small></div></li>${q}</ul>
        <form id="noteForm" class="note"><label class="sr" for="note">Message to flight surgeon</label><input id="note" maxlength="240" placeholder="Add a private note for your flight surgeon…"/><button class="btn ghost">Add</button></form>
        <div class="actions"><button class="btn big" id="sendBtn">Send now (simulated ground link)</button>
        <span class="lvl" id="sentTag" hidden>Delivered ✓</span>
        <span class="muted small">≈ ${total.toLocaleString()} B to send · about ${(total * 8 / Q.LINK_BPS).toFixed(1)} s of air time at 9.6 kbps</span></div>
        <ol class="pipeline" id="pipeline" hidden></ol>
      </section>
      <section class="card">
        <h2>How your medical data is protected</h2>
        <ul class="plain">
          <li><b>Why:</b> medical data stays private for life. Attackers can record radio traffic today and break it later with a quantum computer ("harvest now, decrypt later").</li>
          <li><b>Key exchange:</b> X25519 + ML-KEM-512 together (hybrid). An attacker must break both.</li>
          <li><b>Encryption:</b> AES-256-GCM. Hides the report and catches any change.</li>
          <li><b>Signature:</b> ML-DSA-44. Ground knows the report really came from this crew device.</li>
          <li><b>Standards:</b> ML-KEM (FIPS 203) and ML-DSA (FIPS 204) are NIST post-quantum standards from 2024.</li>
          <li><b>Today:</b> AES-256-GCM encryption is real, in your browser. The ML-KEM and ML-DSA steps are a labelled simulation — post-quantum protection is planned.</li>
        </ul>
        <div class="table-wrap"><table class="sizes"><thead><tr><th>Item</th><th>Size</th></tr></thead><tbody>
          <tr><td>X25519 public key</td><td>32 B</td></tr>
          <tr><td>ML-KEM-512 public key / ciphertext</td><td>800 B / 768 B</td></tr>
          <tr><td>ML-DSA-44 signature</td><td><b>2,420 B</b></td></tr>
          <tr><td>ML-DSA-44 public key (loaded before launch)</td><td>1,312 B</td></tr>
          <tr><td>AES-256-GCM nonce + tag</td><td>12 B + 16 B</td></tr></tbody></table></div>
        <p class="muted">The cost: post-quantum keys and signatures are bigger than older ones. CrewPulse sends <b>one batched report per ground pass</b>, so this extra data is paid once a day, not for every reading.</p>
      </section>
      ${log ? `<section class="card"><h2>Sent</h2><ul class="queue">${log}</ul></section>` : ''}
      <p class="fine">AES-256-GCM encryption runs for real in your browser. The key exchange, signature and ground link are shown as a simulation.</p>`;
    $('#sendBtn').addEventListener('click', runSync);
    $('#noteForm').addEventListener('submit', (e) => {
      e.preventDefault(); const v = $('#note').value.trim(); if (!v) return;
      S.queue.push({ key: 'note-' + Date.now(), title: 'Private note', text: v }); save(); renderSync(); renderHeader();
    });
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runSync() {
    document.querySelector('.hero.sync')?.classList.add('sending');
    const ulState = document.querySelector('.ul-state'); if (ulState) ulState.textContent = 'Sending…';
    const btn = $('#sendBtn'); btn.disabled = true; $('#sentTag').hidden = true;
    const ol = $('#pipeline'); ol.hidden = false; ol.innerHTML = '';
    const step = (title, detail) => { const li = document.createElement('li'); li.className = 'run'; li.innerHTML = `<strong>${title}</strong><small>${detail}</small>`; ol.appendChild(li); return li; };
    const finish = (li, detail) => { li.className = 'ok'; if (detail) li.querySelector('small').innerHTML = detail; };
    const body = new TextEncoder().encode(payload());
    let s = step('1 · Connect to ground station', 'Simulated ground link');
    await wait(500); finish(s);
    s = step('2 · Agree a fresh secret key — X25519 + ML-KEM-512', 'Crew device sends 832 B (32 + 800). Ground replies 800 B (32 + 768)…');
    await wait(1100); finish(s, 'Two secrets mixed into one key (HKDF-SHA-256). Safe unless an attacker breaks <b>both</b>. <em>Simulated step.</em>');
    s = step('3 · Encrypt report — AES-256-GCM', 'Encrypting ' + body.length.toLocaleString() + ' B…');
    let ctLen = body.length + 16, preview = '';
    try {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body);
      ctLen = ct.byteLength; preview = hex(ct, 16) + '…';
      await wait(500);
      finish(s, `${body.length.toLocaleString()} B → ${ctLen.toLocaleString()} B ciphertext · <code>${preview}</code> <em>Real encryption in your browser.</em>`);
    } catch (e) { await wait(500); finish(s, `${body.length.toLocaleString()} B → ${ctLen.toLocaleString()} B ciphertext <em>(browser crypto not available here — simulated)</em>`); }
    s = step('4 · Sign report — ML-DSA-44', 'Signing…');
    await wait(900); finish(s, 'Adds a 2,420 B signature. Proves the report came from this crew device and was not changed. <em>Simulated step.</em>');
    const total = ctLen + SIZES.nonce + SIZES.sig;
    s = step('5 · Transmit at 9.6 kbps', `${total.toLocaleString()} B ≈ ${(total * 8 / Q.LINK_BPS).toFixed(1)} s of air time…`);
    await wait(1400); finish(s);
    s = step('6 · Ground checks signature and decrypts', 'Verifying…');
    await wait(700); finish(s, 'Report received (simulated ground) ✓');
    S.sent.push({ label: 'Report ' + Q.fmtDate(new Date()), at: Date.now(), bytes: total, items: S.queue.length + 1 });
    S.queue = []; save(); renderHeader(); toast('Report delivered (simulated ground) ✓');
    btn.disabled = false; btn.textContent = 'Send again'; $('#sentTag').hidden = false;
    const hero = document.querySelector('.hero.sync');
    if (ulState) ulState.textContent = 'Delivered ✓';
    if (hero) { hero.classList.remove('sending'); if (!calm()) { hero.classList.add('launched'); setTimeout(() => hero.classList.remove('launched'), 2600); } }
  }

  // ---------- ABOUT ----------
  function renderAbout() {
    const n = Q.daysLogged;
    $('#view').innerHTML = `
      <section class="card intro">
        <p class="eyebrow">About</p>
        <h1>CrewPulse</h1>
        <p class="lead">A weather forecast for your body. CrewPulse learns <b>your</b> normal from your own readings, shows how you are today and the next 3 days, and lets you see how your choices change the forecast — even with no link to Earth. One scale everywhere: <b>Normal</b> (sun) · <b>Watch</b> (cloud or rain) · <b>Act today</b> (storm).</p>
        <ul class="plain">
          <li><b>Gathers:</b> resting heart rate and HRV (chest Band calm reading), sleep, mood, stress, reaction time, exercise, grip strength and body mass (daily check-in).</li>
          <li><b>Evaluates:</b> compares each value with <b>your own</b> baseline and flags drift.</li>
          <li><b>Acts:</b> every alert has "Do now" steps and a message for your flight surgeon.</li>
          <li><b>Offline first:</b> everything runs and is stored on this device.</li>
          <li><b>Protected:</b> reports to ground use post-quantum cryptography (NIST standards).</li>
        </ul>
      </section>
      <section class="card">
        <h2>Your data</h2>
        <p class="muted">${n ? `${n} day${n === 1 ? '' : 's'} logged since ${Q.fmtDate(Q.startDate)}.` : 'Nothing logged yet.'} Stored only in this browser on this device.</p>
        <div class="settings-row">
          <button class="btn ghost" id="exportBtn" ${n ? '' : 'disabled'}>Save a backup (.json)</button>
          <label class="btn ghost file-btn">Restore a backup<input type="file" id="importFile" accept="application/json,.json" hidden/></label>
          <button class="btn ghost danger" id="wipeBtn" ${n ? '' : 'disabled'}>Delete all my data</button>
        </div>
      </section>
      <section class="card">
        <h2>Covers NASA's five hazards of spaceflight</h2>
        <div class="table-wrap"><table class="sizes"><thead><tr><th>Hazard</th><th>What CrewPulse watches</th></tr></thead><tbody>
          <tr><td>Isolation & confinement</td><td>Mood, stress, feeling low or lonely</td></tr>
          <tr><td>Distance from Earth</td><td>Works offline; reports wait for the next ground link</td></tr>
          <tr><td>Altered gravity</td><td>Heart rate, HRV, exercise, grip strength, body mass, vision changes</td></tr>
          <tr><td>Hostile / closed environment</td><td>Headaches, skin and immune signs (cabin CO₂ sensor: planned)</td></tr>
          <tr><td>Radiation</td><td>Not measured yet — needs a dosimeter (planned)</td></tr></tbody></table></div>
      </section>
      <section class="card">
        <h2>Settings</h2>
        <div class="settings-row">
          <label>Theme<select id="themeSel"><option value="dark" ${S.theme === 'dark' ? 'selected' : ''}>Dark (cabin night)</option><option value="light" ${S.theme === 'light' ? 'selected' : ''}>Light</option></select></label>
        </div>
      </section>
      <section class="card">
        <h2>Data and sources</h2>
        <ul class="plain sources">
          <li><b>Every number in the forecast comes from you</b> — your check-ins and your Band. Nothing is simulated except the clearly labelled Demo Band (which is never saved).</li>
          <li>Five hazards (RIDGE): NASA Human Research Program.</li>
          <li>14-day personal baseline and 3-day averages follow common practice in crew health monitoring.</li>
          <li>Reaction test is a short version of the Psychomotor Vigilance Task used in NASA research.</li>
          <li>Post-quantum standards: NIST FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA).</li>
        </ul>
      </section>
      <section class="card warn"><h2><span class="lvl watch">Caution</span> Not a medical device</h2><p>CrewPulse is decision support. It does not diagnose or treat. Doctors, the crew medical officer and flight surgeons make medical decisions.</p></section>`;
    $('#themeSel').addEventListener('change', (e) => { S.theme = e.target.value; save(); applyTheme(); });
    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([Q.log.export()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'crewpulse-log-' + Q.dateKey() + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { Q.log.import(await file.text()); regen(); renderAll(); toast('Backup restored ✓'); } catch (err) { toast('That file is not a CrewPulse backup'); }
    });
    $('#wipeBtn').addEventListener('click', () => {
      if (!confirm('Delete all your CrewPulse readings from this device? This cannot be undone. Save a backup first if you want to keep them.')) return;
      Q.log.clear(); S.queue = []; S.done = {}; S.levers = []; save(); regen(); renderAll(); toast('All your data was deleted');
    });
  }

  // ---------- GO / CAUTION CHECK ----------
  const TASKS = { eva: 'Spacewalk', dock: 'Docking / robotics', routine: 'Routine work' };
  const GO_RANK = { go: 0, caution: 1, nogo: 2 };
  const GO_WORD = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };
  function goCheck(c, task) {
    const f = fc();
    const sym = (ME.today && ME.today.symptoms) || [];
    const C = f.conditions, R = (w) => Q.WX[w].rank, crit = task !== 'routine';
    let level = 'go';
    const reasons = [], okList = [], fixes = new Set();
    const flag = (l, msg, fix) => { if (GO_RANK[l] > GO_RANK[level]) level = l; reasons.push({ l, msg }); if (fix) fixes.add(fix); };
    const unknown = (what) => flag('caution', `${what}: not enough data to confirm`, 'Keep logging daily so the check can confirm it');
    if (sym.includes('chest')) flag('nogo', 'Chest pain or racing heart reported today', 'See a doctor / the crew medical officer before any task');
    if (sym.includes('vision')) flag(task === 'eva' ? 'nogo' : 'caution', 'Vision change reported today', 'Eye check with a doctor / the crew medical officer');
    const F = C.fatigue, fw = F.wxProj[0], fp = F.prob[0];
    if (fw === 'none') unknown('Fatigue tomorrow');
    else if (fw === 'storm') flag(crit ? 'nogo' : 'caution', `Fatigue tomorrow: act today (${fp}% chance)`, 'Protect an 8.5-hour sleep window tonight');
    else if (R(fw) >= 2 || fp >= 50) flag('caution', `${Q.wxText(F, R(fw) >= 2 ? fw : 'cloudy')} likely tomorrow (${fp}%)`, 'Protect an 8.5-hour sleep window tonight');
    else okList.push(`Fatigue tomorrow: ${Q.WX[fw].word.toLowerCase()} (${fp}% chance it needs attention)`);
    if (f.proj.rt && f.B.rt.mean != null) {
      const rtZ = Q.badZ('rt', f.proj.rt[0], f.B.rt);
      const rtPct = Math.round(((f.proj.rt[0] - f.B.rt.mean) / f.B.rt.mean) * 100);
      if (rtZ >= 3) flag(task === 'dock' ? 'nogo' : 'caution', `Reactions about ${rtPct}% slower than your normal`, 'Re-take the reaction test on the morning of the task');
      else if (rtZ >= 2) flag('caution', `Reactions about ${rtPct}% slower than your normal`, 'Re-take the reaction test on the morning of the task');
      else okList.push('Reactions close to your normal');
    } else unknown('Reaction time');
    if (f.proj.sleep) {
      const sl = f.proj.sleep[0];
      if (sl < 6) flag('caution', `Expected sleep tonight only ${sl.toFixed(1)} h`, 'Protect an 8.5-hour sleep window tonight');
      else okList.push(`Expected sleep tonight ${sl.toFixed(1)} h`);
    } else unknown('Sleep');
    const H = C.heart;
    if (H.wx === 'none') unknown('Heart');
    else if (H.wx === 'storm' || H.wxProj[0] === 'storm') flag(crit ? 'nogo' : 'caution', 'Heart strain is high', 'Heart check with a doctor / the crew medical officer');
    else if (R(H.wx) >= 2) flag('caution', `Heart: ${Q.WX[H.wx].word.toLowerCase()} today`, 'Re-measure resting heart rate before the task');
    else okList.push('Heart within your normal');
    if (task === 'eva') {
      const M = C.muscle;
      if (M.wx === 'none') unknown('Muscle & bone');
      else if (M.wx === 'storm') flag('caution', 'Muscle strength well below your normal — spacewalks are physically hard', 'Plan extra rest breaks during the spacewalk');
      else if (R(M.wx) >= 2) flag('caution', 'Muscle strength below your normal', 'Plan extra rest breaks during the spacewalk');
      else okList.push('Muscle & bone within your normal');
      fixes.add('Radiation is not measured by CrewPulse — check the space-weather forecast');
    }
    if (level !== 'go') fixes.add('Ask a crewmate to double-check critical steps');
    return { level, reasons, okList, fixes: [...fixes] };
  }
  function goPanel() {
    const task = S.goTask || 'eva';
    const r = goCheck(ME, task);
    const lv = S.levers.length;
    const say = { go: 'Good to go — your forecast is within your normal.', caution: 'Possible, with care. See why below.', nogo: 'Not recommended tomorrow. See why below.' }[r.level];
    return `<section class="card gocheck ${r.level}" id="goPanel">
      <div class="go-head"><h2>Go / caution check · tomorrow ${lv ? '<span class="plan">with your plan</span>' : ''}</h2>
        <div class="segs" role="group" aria-label="Task">${Object.entries(TASKS).map(([k, v]) => `<button class="seg ${k === task ? 'on' : ''}" data-gotask="${k}">${v}</button>`).join('')}</div></div>
      <div class="go-verdict"><span class="go-badge ${r.level}">${GO_WORD[r.level]}</span><p><strong>${esc(TASKS[task])}:</strong> ${say}</p></div>
      <div class="go-cols">
        ${r.reasons.length ? `<div><h4>Why</h4><ul class="go-list">${r.reasons.map((x) => `<li class="${x.l}">${esc(x.msg)}</li>`).join('')}</ul></div>` : ''}
        ${r.fixes.length ? `<div><h4>To improve</h4><ul class="go-list fix">${r.fixes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${r.okList.length ? `<div><h4>Looks fine</h4><ul class="go-list okl">${r.okList.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <p class="fine">Recommendation only. The final decision belongs to the crew, the flight surgeon and mission control.</p>
    </section>`;
  }

  // ---------- CREW (medical officer view) ----------
  const COND_KEYS = ['fatigue', 'mood', 'heart', 'muscle'];
  // Radar: the sweep finds "you" in the middle; empty slots are crewmates not yet synced.
  // Each slot blinks as the sweep passes it (delay = angle / 360 × 4 s).
  const RADAR = `<svg class="radar" viewBox="0 0 140 140" aria-hidden="true">
    <circle class="rd-ring" cx="70" cy="70" r="64"/><circle class="rd-ring" cx="70" cy="70" r="44"/><circle class="rd-ring" cx="70" cy="70" r="24"/>
    <path class="rd-axis" d="M70 6V134M6 70H134"/>
    <g class="rd-sweep"><path d="M70 70 L70 6 A64 64 0 0 0 14.6 38 Z"/><path class="rd-edge" d="M70 70 L70 6"/></g>
    ${[[108.1, 48, 60], [50.8, 122.6, 200], [38.8, 52, 300]].map(([x, y, a]) => `<circle class="rd-slot" cx="${x}" cy="${y}" r="5" style="animation-delay:${(a / 90).toFixed(2)}s"/>`).join('')}
    <circle class="rd-ping" cx="70" cy="70" r="11"/><circle class="rd-me" cx="70" cy="70" r="11"/><text class="rd-t" x="70" y="73.5" text-anchor="middle">ME</text></svg>`;
  function renderCrew() {
    const f = fc(), d0 = f.days[0], C = f.conditions;
    const attention = COND_KEYS.some((k) => C[k].ready && (Q.WX[C[k].wx].rank >= 2 || (C[k].prob[0] ?? 0) >= 50));
    const withP = COND_KEYS.map((k) => C[k]).filter((x) => x.prob[0] != null);
    const top = withP.length ? withP.reduce((b, x) => (x.prob[0] > b.prob[0] ? x : b)) : null;
    const g = f.ready ? goCheck(ME, 'eva') : null;
    const B = Q.band, L = B.live();
    const live = B.state === 'live' && L.m.hr ? ` · live ${Math.round(L.m.hr)} bpm${B.source === 'demo' ? ' (demo)' : ''}` : '';
    const row = `<tr>
        <th scope="row"><button class="crew-open" data-crew-open="me"><span class="avatar you">ME</span><span><strong>You</strong><small>${Q.daysLogged} day${Q.daysLogged === 1 ? '' : 's'} logged${esc(live)}</small></span></button></th>
        <td class="today" data-label="Today">${Q.wxIcon(d0.wx, 28)}<span>${esc(d0.text)}</span></td>
        ${COND_KEYS.map((k) => `<td class="cell ${C[k].wx}" data-label="${C[k].label}">${Q.wxIcon(C[k].wx, 26)}<small>${Q.WX[C[k].wx].word}</small></td>`).join('')}
        <td class="risk" data-label="Top risk tomorrow">${top ? `<b>${top.prob[0]}%</b><small>${esc(top.label)}</small>` : '—'}</td>
        <td class="evacell" data-label="Spacewalk">${g ? `<span class="go-badge sm ${g.level}">${GO_WORD[g.level]}</span>` : '—'}</td>
        <td class="msgcell" data-label="Queued">${S.queue.length || '—'}</td></tr>`;
    $('#view').innerHTML = `
      <section class="hero crew-hero">
        <div><p class="eyebrow">Crew medical officer view</p>
        <h1>${!f.ready ? 'Not enough data yet' : attention ? 'You need attention' : 'You are within your normal'}</h1>
        <p class="muted">One screen for the whole crew. Only you are on this device — crewmates appear here when their CrewPulse devices sync.</p></div>
        <figure class="radar-wrap ${!f.ready ? 'none' : attention ? 'watch' : 'ok'}">${RADAR}<figcaption>Crew link · 1 on this device</figcaption></figure>
      </section>
      <section class="card"><div class="table-wrap"><table class="crewtable">
        <thead><tr><th>Crew</th><th>Today</th><th>Fatigue</th><th>Mood</th><th>Heart</th><th>Muscle &amp; bone</th><th>Top risk tomorrow</th><th>Spacewalk check</th><th>Messages queued</th></tr></thead>
        <tbody>${row}</tbody></table></div></section>
      <p class="fine">Your own data. Decision support only — medical decisions belong to doctors, the crew medical officer and flight surgeon.</p>`;
  }

  // ---------- BAND (live chest Band) ----------
  const HEART_SVG = '<svg class="heart" id="heartIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.6.8-1.4 2.3-2.6 4.4-2.6 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let stripRaf = 0, lastWxPaint = 0;
  function renderBand() {
    const B = Q.band, st = B.state;
    const src = { bluetooth: 'Bluetooth', usb: 'USB cable', demo: 'simulated' }[B.source] || '';
    const stText = { off: 'Not connected', connecting: 'Connecting…', live: 'Live · ' + src, lost: 'Connection lost — reconnecting…' }[st];
    const on = st === 'live' || st === 'lost';
    $('#view').innerHTML = `
      <section class="card band-head">
        <div>
          <p class="eyebrow">Your chest Band</p>
          <h1>${on ? esc(B.name) : 'Connect your Band'}</h1>
          <p class="pill-row"><span class="pill"><i class="dot ${st === 'live' ? 'ok' : st === 'off' ? '' : 'watch'}"></i>${stText}</span>${on && B.status.battery != null ? `<span class="pill">Battery ${B.status.battery}%</span>` : ''}</p>
          ${B.error ? `<p class="err">${esc(B.error)}</p>` : ''}
        </div>
        <div class="band-actions">${on
          ? `<button class="btn ghost" data-band="stop">Disconnect</button>${B.source === 'demo' ? (B.demoExercising() ? '<button class="btn" data-band="rest">Stop exercise</button>' : '<button class="btn" data-band="exercise">Simulate 60 s of exercise</button>') + (B.demoStressed() ? '<button class="btn ghost" data-band="unstress">Stop stress</button>' : '<button class="btn ghost" data-band="stress">Simulate stress</button>') + (B.demoIrregularOn() ? '<button class="btn ghost" data-band="unirreg">Stop skipped beats</button>' : '<button class="btn ghost" data-band="irreg">Simulate skipped beats</button>') : ''}`
          : `<button class="btn big" data-band="bt" ${B.hasBluetooth ? '' : 'disabled'}>Connect Band (Bluetooth)</button>
             <button class="btn ghost" data-band="usb" ${B.hasSerial ? '' : 'disabled'}>USB cable</button>
             <button class="btn ghost" data-band="demo">Try Demo Band (simulated)</button>`}</div>
        ${!on && !B.hasBluetooth ? '<p class="hint">Bluetooth needs Chrome or Edge on a laptop or Android phone (not iPhone Safari). The Demo Band works everywhere.</p>' : ''}
      </section>
      <section class="card live-card">
        <div class="hr-big"><span class="heart-wrap">${HEART_SVG}</span><div><b id="liveHR">--</b><small>bpm</small></div></div>
        <canvas id="beatStrip" aria-label="Heartbeat strip"></canvas>
        <dl class="live-grid">
          <div><dt>HRV (RMSSD)</dt><dd id="liveHRV">--</dd></div>
          <div><dt>Signal</dt><dd id="liveQ">--</dd></div>
          <div><dt>Skin temp</dt><dd id="liveT">--</dd></div>
          <div><dt>Activity</dt><dd id="liveA">--</dd></div>
          <div class="rhythm-tile"><dt>Rhythm</dt><dd id="liveRhythm">--</dd></div>
        </dl>
      </section>
      <section class="card live-wx" id="liveWx"><div class="lw-row"><div class="lw-astro" id="lwAstro"></div><div class="lw-body" id="lwBody"></div></div><div id="lwBase"></div></section>
      <section class="card"><h2>Buzz reaction test</h2>
        <p class="muted small">The Band buzzes at random moments for 1 minute — press its button as fast as you can. Same idea as NASA's reaction test (PVT).</p>
        <div id="rtBand"></div></section>
      <p class="fine">${B.source === 'demo' ? 'Demo Band: simulated signal — nothing from it is saved to your log.' : 'Your 2-minute calm reading and buzz test are saved to today’s log (resting heart rate, HRV, reaction time).'} Decision support only — not a medical device.</p>`;
    updateBand(true);
    startStrip();
  }
  // Live body weather = text + a mood astronaut. The astronaut is drawn once and only its mood changes,
  // so its animation never restarts on the 1-second repaint. Mood follows the same live weather as the text.
  const MOOD_ASTRO = `<svg class="mood-astro" viewBox="0 0 120 152" role="img" aria-label="Astronaut">
    <defs><linearGradient id="mVis" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--vis-1)"/><stop offset="1" style="stop-color:var(--vis-2)"/></linearGradient></defs>
    <g class="m-spark"><path d="M12 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/><path d="M106 22 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z"/><path d="M108 86 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z"/></g>
    <text class="m-q" x="100" y="28">?</text>
    <g class="m-bob"><g class="m-body">
      <path class="m-line" d="M86 20 L93 8"/><circle class="m-fill m-ant" cx="94" cy="6" r="3.5"/>
      <path class="m-limb" d="M38 104 Q26 112 24 126"/><circle class="m-fill m-glove" cx="24" cy="129" r="6"/>
      <g class="m-arm"><path class="m-limb" d="M82 104 Q94 112 96 126"/><circle class="m-fill m-glove" cx="96" cy="129" r="6"/></g>
      <rect class="m-fill m-boot" x="40" y="128" width="16" height="16" rx="6"/><rect class="m-fill m-boot" x="64" y="128" width="16" height="16" rx="6"/>
      <rect class="m-fill" x="34" y="92" width="52" height="42" rx="15"/>
      <circle class="m-light" cx="60" cy="112" r="5"/>
      <g class="m-head">
        <circle class="m-fill" cx="60" cy="54" r="40"/>
        <rect class="m-visor" x="29" y="32" width="62" height="48" rx="22"/>
        <path class="m-shine" d="M38 44 Q42 37 50 36"/>
        <g class="m-face f-happy"><path d="M43 55 Q48 48 53 55"/><path d="M67 55 Q72 48 77 55"/><path class="m-mouth" d="M49 63 Q60 76 71 63 Z"/><circle class="m-cheek" cx="40" cy="64" r="3.6"/><circle class="m-cheek" cx="80" cy="64" r="3.6"/></g>
        <g class="m-face f-calm"><g class="m-eyes"><circle class="m-dot" cx="48" cy="54" r="3"/><circle class="m-dot" cx="72" cy="54" r="3"/></g><path d="M52 64 Q60 69 68 64"/></g>
        <g class="m-face f-active"><path d="M42 46 L53 49"/><path d="M78 46 L67 49"/><circle class="m-dot" cx="48" cy="55" r="3"/><circle class="m-dot" cx="72" cy="55" r="3"/><path class="m-mouth" d="M50 62 Q60 72 70 62 Z"/></g>
        <g class="m-face f-uneasy"><path d="M43 47 L53 44"/><path d="M77 47 L67 44"/><g class="m-eyes"><circle class="m-dot" cx="48" cy="55" r="3"/><circle class="m-dot" cx="72" cy="55" r="3"/></g><path d="M50 66 Q55 62 60 66 Q65 70 70 66"/></g>
        <g class="m-face f-anxious"><path d="M41 46 L53 40"/><path d="M79 46 L67 40"/><circle class="m-eye-o" cx="48" cy="54" r="5"/><circle class="m-eye-o" cx="72" cy="54" r="5"/><circle class="m-dot" cx="48" cy="55" r="1.9"/><circle class="m-dot" cx="72" cy="55" r="1.9"/><path d="M50 69 Q60 61 70 69"/></g>
        <g class="m-face f-unsure"><circle class="m-dot" cx="48" cy="54" r="3"/><path d="M67 54 H77"/><path d="M52 66 L68 63"/></g>
        <path class="m-drop d1" d="M94 40 Q90 47 94 49 Q98 47 94 40Z"/><path class="m-drop d2" d="M25 46 Q21 53 25 55 Q29 53 25 46Z"/>
      </g>
    </g></g>
    <ellipse class="m-shadow" cx="60" cy="149" rx="26" ry="2.5"/>
  </svg>`;
  const MOOD_WORD = { happy: 'happy', calm: 'calm', active: 'busy exercising', uneasy: 'a bit uneasy', anxious: 'anxious', unsure: 'unsure' };
  let moodShown = null, moodWant = null, moodSince = 0;
  function liveWxParts() {
    const B = Q.band, L = B.live();
    const eyebrow = '<p class="eyebrow">Your heart right now</p>';
    if (B.calib) {
      const p = B.calibProgress(), left = B.calib.dur * (1 - p);
      return { mood: 'calm', body: `${eyebrow}<h2>Setting your calm baseline</h2><p>Sit still and breathe normally. ${mmss(left)} left.</p>
        <div class="meter"><i style="width:${(p * 100).toFixed(0)}%"></i></div>
        <div class="actions"><button class="btn ghost" data-band="calib-cancel">Cancel</button></div>`, base: '' };
    }
    if (!B.baseline) {
      const live = B.state === 'live';
      return { mood: live ? 'calm' : 'unsure', body: `${eyebrow}<h2>${live ? 'Ready when you are' : 'Waiting for your Band'}</h2><p class="muted">${live ? 'First, record a calm baseline: sit still for a short reading.' : 'Connect a Band, then record a calm baseline.'}</p>
        ${live ? `<div class="actions"><button class="btn" data-band="calib">Start calm reading (${B.source === 'demo' ? '45 s' : '2 min'})</button></div>` : ''}`, base: '' };
    }
    const base = `<div class="base-row"><p class="muted small">Calm baseline: ${B.baseline.hr} bpm · HRV ${B.baseline.rmssd} ms (set ${clock(B.baseline.at)})</p>
      <span class="base-btns"><button class="btn ghost sm" data-band="calib">Redo baseline</button><button class="btn ghost sm" data-band="base-reset">Clear</button></span></div>`;
    if (!L.ready) return { mood: 'unsure', body: `${eyebrow}<h2>Not sure yet</h2><p class="muted">${esc(L.reason)}</p>`, base };
    let title, text, wx = L.wx, mood;
    if (L.active) { wx = 'fair'; mood = 'active'; title = 'Exercising'; text = 'Exercise detected — a higher heart rate is expected. Recovery is measured when you stop.'; }
    else if (B.recovery && !B.recovery.done) { mood = 'active'; title = 'Heart: recovering'; text = `${mmss(B.recovery.secs)} since you stopped · ${Math.round(L.m.hr)} bpm vs calm ${L.b.hr} bpm.`; }
    else if (B.recovery && B.recovery.done && Date.now() - B.recovery.since < 180000) { mood = 'happy'; title = 'Heart: ' + Q.WX[wx].word; text = `Recovered in ${mmss(B.recovery.secs)} ✓ — a quick recovery is a good sign.`; }
    else {
      mood = { clear: 'happy', fair: 'happy', cloudy: 'uneasy', rain: 'anxious', storm: 'anxious' }[wx] || 'calm';
      title = 'Heart: ' + Q.WX[wx].word;
      text = { clear: 'At your calm baseline.', fair: 'Close to your calm baseline.', cloudy: 'Working harder than your calm baseline. Breathe slowly and re-check in 2 minutes.',
        rain: 'Well above your calm baseline at rest. Sit down and breathe slowly. Tell the crew medical officer if it stays high.',
        storm: 'Far above your calm baseline at rest. Stop, sit down, and tell the crew medical officer if it does not settle.' }[wx];
    }
    const d = (x, u) => (x == null ? '--' : Math.round(x) + u);
    const offer = (mood === 'uneasy' || mood === 'anxious') ? '<p><a class="btn sm" href="#support/breathe">Try 2-minute breathing</a></p>' : '';
    return { mood, wx, body: `${eyebrow}<h2>${title}</h2><p>${text}</p>${offer}
      <p class="small">Now: ${d(L.m.hr, ' bpm')} · HRV ${d(L.m.rmssd, ' ms')}</p>`, base };
  }
  function paintLiveWx(all) {
    const a = document.getElementById('lwAstro'), body = document.getElementById('lwBody'), baseEl = document.getElementById('lwBase');
    if (!a || !body) return;
    const P = liveWxParts();
    body.innerHTML = P.body; baseEl.innerHTML = P.base;
    if (!a.firstElementChild) { a.innerHTML = MOOD_ASTRO; moodShown = null; }
    // A new mood must last 3 s before the face changes, so one odd beat does not flip it.
    const now = Date.now();
    if (P.mood !== moodWant) { moodWant = P.mood; moodSince = now; }
    if (moodShown == null || (moodWant !== moodShown && now - moodSince >= 3000)) {
      moodShown = moodWant;
      a.dataset.mood = moodShown;
      a.dataset.wx = P.wx || '';
      a.firstElementChild.setAttribute('aria-label', 'Astronaut looks ' + MOOD_WORD[moodShown]);
    }
  }
  function rtBandHtml() {
    const B = Q.band;
    if (!B.canReaction()) return '<p class="muted">Connect the CrewPulse Band (or the Demo Band) to run this test.</p>';
    if (B.reactionRunning) return '<p><span class="spinner"></span> Test running — wait for the buzz, then press the Band\'s button…</p>';
    const r = B.reaction;
    return `<div class="actions"><button class="btn" data-band="rt">Start buzz test</button>
      ${r ? `<span><b>${r.median} ms</b> median · ${r.lapses} slow response${r.lapses === 1 ? '' : 's'} · ${r.falseStarts} early press${r.falseStarts === 1 ? '' : 'es'} <small class="muted">(${clock(r.at)})</small></span>` : ''}</div>`;
  }
  function updateBand(all) {
    const B = Q.band, m = B.metrics(30, 60);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('liveHR', m.hr ? Math.round(m.hr) : '--');
    set('liveHRV', m.rmssd ? Math.round(m.rmssd) + ' ms' : (B.state === 'live' ? 'collecting…' : '--'));
    set('liveQ', B.state !== 'live' || m.quality == null ? '--' : !m.hr && !B.status.leadsOff ? 'Waiting for beats' : B.status.leadsOff ? 'Pads off — press them on' : m.quality >= 90 ? 'Good' : m.quality >= 60 ? 'Fair' : 'Poor — hold still');
    set('liveT', B.status.temp != null ? B.status.temp.toFixed(1) + ' °C' : '--');
    const act = B.isActive();
    set('liveA', act == null ? '--' : act ? 'Active' : 'Resting');
    const r = B.rhythm(600);
    set('liveRhythm', B.state !== 'live' ? '--' : r.beats < 30 ? 'Checking…' : r.irregular ? `${r.irregular} early beat${r.irregular === 1 ? '' : 's'} · 10 min` : 'Regular');
    const now = Date.now();
    if (all || now - lastWxPaint > 900) { paintLiveWx(all); lastWxPaint = now; }
    if (all) { const r = document.getElementById('rtBand'); if (r) r.innerHTML = rtBandHtml(); }
  }
  function pulse() {
    const h = document.getElementById('heartIcon'); if (!h) return; h.classList.remove('beat'); void h.getBBox(); h.classList.add('beat');
    const w = h.parentElement; if (w && w.classList.contains('heart-wrap')) { w.classList.remove('ping'); void w.offsetWidth; w.classList.add('ping'); }
  }
  // Live heartbeat as a window into deep space: a glowing comet draws the ECG, every beat
  // sends out a ripple and sparks, and stars stream past faster when the heart beats faster.
  function startStrip() {
    cancelAnimationFrame(stripRaf);
    const cv = document.getElementById('beatStrip'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const ecg = (x) => 0.12 * Math.exp(-((x + 0.2) ** 2) / 0.002) - 0.15 * Math.exp(-((x + 0.03) ** 2) / 0.00008)
      + 1.0 * Math.exp(-(x ** 2) / 0.00012) - 0.25 * Math.exp(-((x - 0.035) ** 2) / 0.0001) + 0.25 * Math.exp(-((x - 0.25) ** 2) / 0.004);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: 70 }, () => ({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.3, d: 0.25 + rnd() * 0.9, tw: rnd() * 6.28 }));
    const fx = []; let seen = 0, col = null, colAt = 0, travel = 0, hr = 0, hrAt = -1, last = performance.now() / 1000;
    const span = 6, HEAD = 0.9; // seconds shown; the comet head sits at 90% of the width
    const draw = () => {
      if (!document.body.contains(cv)) return;
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const pnow = performance.now() / 1000, dt = Math.min(0.1, pnow - last); last = pnow;
      if (!col || pnow - colAt > 1) { const c = getComputedStyle(document.documentElement), g = (k) => c.getPropertyValue(k).trim();
        col = { p1: g('--p1'), p2: g('--p2'), p3: g('--p3'), p4: g('--p4'), p5: g('--p5') }; colAt = pnow; }
      const still = calm(), now = Date.now() / 1000;
      const beats = Q.band.beats.filter((b) => b.ok && b.t / 1000 > now - span - 1).map((b) => b.t / 1000);
      if (pnow - hrAt > 0.5) { hr = Q.band.metrics(10, 10).hr || 0; hrAt = pnow; }
      // deep-space backdrop + soft nebula
      let g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#151b3f'); g.addColorStop(1, '#0a0d22');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(W * HEAD, H * 0.5, 0, W * HEAD, H * 0.5, H * 1.6); g.addColorStop(0, col.p2 + '40'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(W * 0.15, H * 1.1, 0, W * 0.15, H * 1.1, H * 1.4); g.addColorStop(0, col.p3 + '26'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // stars stream left; faster with a faster heart
      if (!still) travel += dt * (0.015 + (hr ? hr / 60 : 0.3) * 0.02);
      for (const s of stars) {
        const x = (((s.x - travel * s.d) % 1) + 1) % 1 * W, a = 0.35 + 0.45 * Math.abs(Math.sin(s.tw + pnow * (still ? 0 : 1.3 * s.d)));
        ctx.fillStyle = `rgba(255,255,255,${(a * s.d).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, s.y * H, s.r, 0, 6.283); ctx.fill();
      }
      // the trace (time now-span*HEAD … now maps to 0 … HEAD*W)
      const base = H * 0.62, amp = H * 0.46, xOf = (t) => ((t - (now - span * HEAD)) / span) * W;
      const val = (t) => { let v = 0; for (const bt of beats) { const d = t - bt + 0.3; if (d > -0.5 && d < 0.6) v += ecg(d); } return v; };
      const pts = []; for (let px = 0; px <= W * HEAD; px += 1.5) { const t = now - span * HEAD + (px / W) * span; pts.push([px, base - val(t) * amp]); }
      const head = pts[pts.length - 1];
      g = ctx.createLinearGradient(0, 0, W * HEAD, 0);
      g.addColorStop(0, col.p4 + '00'); g.addColorStop(0.35, col.p4 + 'aa'); g.addColorStop(0.7, col.p2); g.addColorStop(1, col.p3);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [w, a] of [[7, 0.18], [2.4, 1]]) { // soft glow, then crisp line
        ctx.globalAlpha = a; ctx.strokeStyle = g; ctx.lineWidth = w; ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // new beat → ripple + sparks at its peak, which then drift left with the trace
      for (const bt of beats) if (bt > seen) {
        seen = bt; if (still || now - bt > 0.8) continue; // only fresh beats sparkle (not a backlog after a pause)
        fx.push({ kind: 'ring', t0: pnow, bt });
        for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, v = 20 + rnd() * 45; fx.push({ kind: 'spark', t0: pnow, bt, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: [col.p3, col.p5, col.p4][i % 3] }); }
      }
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i], age = pnow - f.t0, life = f.kind === 'ring' ? 1.1 : 0.9;
        if (age > life) { fx.splice(i, 1); continue; }
        const k = age / life, px = xOf(f.bt - 0.3), py = base - amp;
        if (f.kind === 'ring') { ctx.strokeStyle = col.p3; ctx.globalAlpha = 0.7 * (1 - k); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py + amp * 0.35, 6 + k * 38, 0, 6.283); ctx.stroke(); }
        else { ctx.fillStyle = f.c; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(px + f.vx * age, py + f.vy * age + 30 * age * age, 1.8 * (1 - k) + 0.6, 0, 6.283); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      // comet head
      const bump = beats.length ? Math.max(0, 1 - (now - beats[beats.length - 1]) / 0.35) : 0;
      const hb = still ? 0 : (beats.length ? 0.5 + 0.5 * Math.sin(pnow * 6) : 0.5 + 0.5 * Math.sin(pnow * 2));
      g = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 16 + bump * 10);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, col.p3 + 'cc'); g.addColorStop(1, col.p3 + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(head[0], head[1], 16 + bump * 10, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(head[0], head[1], 2.6 + hb * 0.8 + bump * 1.5, 0, 6.283); ctx.fill();
      // labels
      ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.72)';
      if (!beats.length) ctx.fillText(Q.band.state === 'live' ? 'Waiting for heartbeats…' : 'No signal: connect the Band or try the Demo Band', 14, 22);
      else { ctx.fillText('Live · last 6 s', 14, 22); }
      stripRaf = requestAnimationFrame(draw);
    };
    draw();
  }
  function youCard() {
    const B = Q.band, L = B.live(), on = B.state === 'live';
    const small = on ? (L.m.hr ? Math.round(L.m.hr) + ' bpm' : 'waiting…') : B.state === 'lost' ? 'reconnecting…' : 'Band not connected';
    const icon = L.ready && !L.active ? Q.wxIcon(L.wx, 30, 'Heart ' + Q.WX[L.wx].word) : `<svg class="heart sm ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.6.8-1.4 2.3-2.6 4.4-2.6 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>`;
    return `<button class="you-card ${B.state}" data-go="band" aria-current="${currentTab() === 'band'}">
      <span class="avatar you">ME</span><span class="who"><strong>${on ? 'You (live)' : 'Your Band'}</strong><small id="youSmall">${small}</small></span>
      <span class="cb-wx" id="youWx">${icon}</span></button>`;
  }
  let lastYou = 0;
  function updateYou(full) {
    const el = document.querySelector('.you-card'); if (!el) return;
    if (!full && Date.now() - lastYou < 1000) return;
    lastYou = Date.now();
    el.outerHTML = youCard();
  }
  const currentTab = () => (location.hash.slice(1) || 'today').split('/')[0];
  Q.band.on((type) => {
    const tab = currentTab();
    if (tab === 'band') {
      if (type === 'heart') pulse();
      if (type === 'state') renderBand(); else updateBand(type !== 'heart' && type !== 'status' && type !== 'irregular' && type !== 'logged-quiet');
      if (type === 'irregular') { const el = document.querySelector('.rhythm-tile'); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
    }
    if (tab === 'support') { if (type === 'state' && !br) renderSupport(); else updateSupLive(); }
    if (type === 'state') renderHeader();
    if (type === 'logged-quiet') regen();
    if (type === 'logged') { regen(); renderHeader(); toast('Saved to today’s log ✓'); if (tab === 'today') renderToday(); }
    if (tab === 'crew' && type === 'state') renderCrew();
    updateYou(type === 'state' || type === 'calib');
  });
  async function bandCmd(cmd) {
    const B = Q.band;
    try {
      if (cmd === 'bt') await B.connectBluetooth();
      else if (cmd === 'usb') await B.connectUSB();
      else if (cmd === 'demo') { B.startDemo(); toast('Demo Band connected (simulated data)'); }
      else if (cmd === 'stop') B.stop();
      else if (cmd === 'exercise') { B.demoExercise(60); renderBand(); }
      else if (cmd === 'rest') { B.demoRest(); renderBand(); }
      else if (cmd === 'stress' || cmd === 'unstress') { B.demoStress(cmd === 'stress'); renderBand(); }
      else if (cmd === 'irreg' || cmd === 'unirreg') { B.demoIrregular(cmd === 'irreg'); renderBand(); }
      else if (cmd === 'calib') B.startCalibration(B.source === 'demo' ? 45 : 120);
      else if (cmd === 'calib-cancel') B.cancelCalibration();
      else if (cmd === 'base-reset') B.clearBaseline();
      else if (cmd === 'rt') await B.startReaction();
    } catch (e) { B.error = e.message || String(e); if (currentTab() === 'band') renderBand(); }
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-band],[data-go],[data-gotask],[data-goopen],[data-crew-open]');
    if (!t) return;
    e.stopPropagation();
    if (t.dataset.band) return bandCmd(t.dataset.band);
    if (t.dataset.go) { location.hash = '#' + t.dataset.go; return; }
    if (t.dataset.crewOpen) { location.hash = '#today'; return; }
    if (t.dataset.goopen != null) {
      S.goOpen = !S.goOpen; save(); const y = window.scrollY; renderToday(); window.scrollTo(0, y);
      if (S.goOpen) document.getElementById('goPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (t.dataset.gotask) { S.goTask = t.dataset.gotask; save(); const y = window.scrollY; renderToday(); window.scrollTo(0, y); }
  }, true);

  // ---------- EARLY WARNING (rhythm + "fighting something", vs your own normal) ----------
  const EW_WORD = { none: 'No data yet', ok: 'Normal', watch: 'Watch', warn: 'Watch', high: 'Act today' };
  const EW_LVL = { none: 'none', ok: 'ok', watch: 'watch', warn: 'watch', high: 'act' };
  const EW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-5.5 5 11 2.5-5.5h4"/></svg>';
  function ewCard() {
    const w = Q.earlyWarning(ME, Q.band);
    const badge = w.ready ? { ok: 'Normal', watch: 'Watch', act: 'Act today' }[w.level] : 'Learning';
    const lvl = w.ready ? w.level : 'none';
    const sigs = w.signals.map((x) => `<li class="${EW_LVL[x.state]}"><span class="lvl-dot ${EW_LVL[x.state]}" aria-hidden="true"></span>
      <span class="ew-s"><strong>${Q.EW_LABEL[x.m]}</strong><small>${esc(x.text)}</small></span><b>${EW_WORD[x.state]}</b></li>`).join('');
    const key = 'ew-' + w.channel;
    const queued = S.queue.some((q) => q.key === key);
    const acts = w.ready && w.level !== 'ok' ? `<div class="actions">
        ${queued ? `<button class="btn ghost" data-ew="unflag" data-key="${key}">✓ Flagged for the crew medical officer</button>` : `<button class="btn" data-ew="flag">Flag to crew medical officer</button>`}
        <a class="btn ghost" href="#band">Re-check with the Band</a>
        ${w.channel === 'infection' ? '<a class="btn ghost" href="#support">What helps</a>' : ''}</div>` : '';
    return `<section class="card ew-card ${lvl}" id="ewCard">
      <div class="ew-head"><span class="ew-ic">${EW_ICON}</span>
        <div class="ew-t"><p class="eyebrow">Early warning · compared with your own normal</p><h2>${w.title}</h2><p class="muted">${w.text}</p></div>
        <span class="lvl ${lvl}">${badge}</span></div>
      <ul class="ew-sigs">${sigs}</ul>${acts}
      <p class="ew-fine">Why: heart-rhythm changes came first on Apollo 15 (1971) and Mir (1987, 1997); infections cut Apollo 13 and Salyut 7 (1985) short. On Earth, these signals flagged illness before symptoms (Mishra 2020, Smarr 2020). Prototype — not a diagnosis.</p>
    </section>`;
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ew]'); if (!t) return;
    const w = Q.earlyWarning(ME, Q.band);
    if (t.dataset.ew === 'flag' && w.channel) {
      S.queue.push({ key: 'ew-' + w.channel, title: 'Early warning: ' + w.title,
        text: w.signals.filter((x) => x.state !== 'none').map((x) => `${Q.EW_LABEL[x.m]}: ${x.text}`).join('; ') + '. Request flight surgeon review.' });
      toast('Added to your next report');
    }
    if (t.dataset.ew === 'unflag') S.queue = S.queue.filter((q) => q.key !== t.dataset.key);
    save(); renderHeader(); const y = window.scrollY; renderToday(); window.scrollTo(0, y);
  });

  // ---------- SUPPORT (signs of strain → self-help → a person) ----------
  const LIFEBUOY = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M6 6l3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/></svg>';
  let br = null; // running breathing session { start, before, timer }
  const strainNow = () => Q.strain(ME, fc(), Q.band);
  const signsList = (arr) => arr.map((s) => `<li><span>${esc(s.text)}</span><small>${esc(s.src)}</small></li>`).join('');
  function bandSnap(win) {
    const B = Q.band; if (B.state !== 'live') return null;
    const m = B.metrics(win, win);
    return m.hr ? { hr: Math.round(m.hr), hrv: m.rmssd ? Math.round(m.rmssd) : null, demo: B.source === 'demo' } : null;
  }
  function supBanner(f) {
    const s = Q.strain(ME, f, Q.band);
    if (s.level === 'none') return '';
    const sub = s.stress.concat(s.fatigue).slice(0, 2).map((x) => x.text).join(' · ') + (s.persisting ? ' · 3 days in a row' : '');
    return `<a class="card sup-banner ${s.level}" href="#support"><span class="sb-ic">${LIFEBUOY}</span>
      <span class="sb-t"><strong>${Q.strainTitle(s)}</strong><small>${esc(sub)}</small></span>
      <b class="sb-go">${s.kind === 'fatigue' ? 'See what helps' : 'Take 2 minutes'} →</b></a>`;
  }
  function brResultHtml() {
    const r = (S.breaths || [])[0]; if (!r) return '';
    const b = r.before, a = r.after;
    if (!b || !a) return `<p class="muted small">Last session ${clock(r.at)}. Connect the Band next time to see your heart before and after.</p>`;
    const dHR = a.hr - b.hr, dHRV = a.hrv != null && b.hrv != null ? a.hrv - b.hrv : null;
    const hrTxt = dHR <= -2 ? `Heart rate down ${-dHR} bpm` : dHR >= 2 ? `Heart rate up ${dHR} bpm` : 'Heart rate about the same';
    const hrvTxt = dHRV == null ? '' : dHRV >= 3 ? ` · HRV up ${dHRV} ms` : dHRV <= -3 ? ` · HRV down ${-dHRV} ms` : ' · HRV about the same';
    return `<div class="br-result">
      <div class="br-col"><small>Before</small><b>${b.hr} <i>bpm</i></b><span>HRV ${b.hrv ?? '--'} ms</span></div>
      <div class="br-arrow" aria-hidden="true">→</div>
      <div class="br-col"><small>After</small><b>${a.hr} <i>bpm</i></b><span>HRV ${a.hrv ?? '--'} ms</span></div>
      <p class="small br-note"><strong>${hrTxt}${hrvTxt}.</strong> ${a.demo ? 'Demo Band: simulated numbers.' : 'HRV often rises during slow breathing — that is expected and a good sign.'} <span class="muted">(${clock(r.at)})</span></p></div>`;
  }
  function updateSupLive() {
    const el = document.getElementById('brLive'); if (!el) return;
    const s = bandSnap(30);
    el.innerHTML = s ? `Now: ${s.hr} bpm · HRV ${s.hrv ?? '…'} ms${s.demo ? ' (demo)' : ''}` : Q.band.state === 'live' ? 'Reading your heart…' : '<a href="#band">Connect the Band</a> to see your heart before and after.';
  }
  function renderSupport(arg) {
    const s = strainNow();
    const mood = s.level === 'none' ? 'happy' : s.level === 'strong' ? 'anxious' : 'uneasy';
    const intro = { none: 'Nothing worrying in your readings right now. These tools work any time — before a big task, or when you just want a reset.',
      mild: 'Your readings show a few signs. Two minutes of slow breathing often helps. You choose what to do.',
      strong: 'Your readings show clear signs of strain. Try the breathing below, and think about talking to someone.' }[s.level];
    const signs = s.stress.concat(s.fatigue);
    const inPlan = S.levers.includes('call');
    const asked = S.queue.some((q) => q.key === 'sup-cmo');
    const urgentQueued = S.queue.some((q) => q.key === 'sup-urgent');
    const running = !!br;
    const tipsLead = s.fatigue.length ? `<p class="sup-why">${esc(s.fatigue.map((x) => x.text).join(' · '))}</p>` : '';
    $('#view').innerHTML = `
      <section class="card sup-head ${s.level}">
        <div class="lw-row"><div class="lw-astro" data-mood="${mood}">${MOOD_ASTRO}</div>
        <div><p class="eyebrow">Support · just for you</p><h1>${Q.strainTitle(s)}</h1><p>${intro}</p>
          ${signs.length ? `<ul class="signs">${signsList(signs)}</ul>` : ''}
          ${s.persisting ? '<p class="sup-why"><strong>Mood or stress has been heavy 3 days in a row.</strong> That is a good moment to talk to someone — see below.</p>' : ''}
          <p class="fine">These are signs, not a diagnosis.</p></div></div>
      </section>
      <section class="card breathe ${running ? 'running' : ''}" id="breathe">
        <div class="panel-head"><h2>2-minute breathing</h2><span class="tag">6 breaths a minute</span></div>
        <p class="muted">Breathe in for 4 seconds and out for 6. Slow breathing like this lowered stress and anxiety in 24 studies (Goessl et al. 2017). Your Band shows your heart before and after.</p>
        <div class="br-stage">
          <div class="br-orb" id="brOrb"><div class="lw-astro br-astro" data-mood="calm">${MOOD_ASTRO}</div></div>
          <div class="br-info" aria-live="polite"><p class="br-phase" id="brPhase">${running ? '' : 'Ready when you are'}</p>
            <p class="br-time" id="brTime">${mmss(Q.BREATH.dur)}</p><p class="small muted" id="brLive"></p></div>
        </div>
        <div class="actions">${running ? '<button class="btn ghost" data-sup="br-stop">Stop</button>' : '<button class="btn big" data-sup="br-start">Start 2-minute breathing</button>'}</div>
        <div id="brResult">${running ? '' : brResultHtml()}</div>
      </section>
      <section class="card tips">
        <h2>Feeling tired?</h2>${tipsLead}
        <ol class="tip-list">${Q.FATIGUE_TIPS.map((x) => `<li><strong>${esc(x.t)}</strong><small>${esc(x.why)}</small></li>`).join('')}</ol>
        <div class="actions"><a class="btn ghost" href="#checkin">Re-test reaction time</a><a class="btn ghost" href="#today">Go / caution check</a></div>
      </section>
      <section class="card talk">
        <h2>Talk to someone</h2>
        <div class="talk-grid">
          <div class="talk-opt"><h3>Family or a friend</h3><p class="muted">A private call is one of the best mood boosters on long missions.</p>
            ${inPlan ? '<button class="btn ghost" data-sup="call">✓ In today’s plan</button>' : '<button class="btn" data-sup="call">Add a call to today’s plan</button>'}</div>
          <div class="talk-opt"><h3>Crew medical officer or ground</h3><p class="muted">Ask for a private talk with the flight surgeon or a psychologist. Only what you choose is sent.</p>
            <label class="chk"><input type="checkbox" id="supShare" ${S.supShare ? 'checked' : ''}/> <span>Include my signs</span></label>
            ${asked ? '<button class="btn ghost" data-sup="cmo-cancel">✓ Requested — in your next report</button>' : '<button class="btn" data-sup="cmo">Ask for a private talk</button>'}</div>
        </div>
        <div class="urgent">
          <button class="btn danger" data-sup="urgent" aria-expanded="${!!S.supUrgentOpen}">I feel very low or unsafe right now</button>
          <div class="urgent-box" ${S.supUrgentOpen ? '' : 'hidden'}>
            <p><strong>Please talk to a person now.</strong> You do not have to handle this alone.</p>
            <ul><li><strong>In flight:</strong> tell your crew medical officer or commander now, and ask for a private call with the flight surgeon.</li>
              <li><strong>On Earth:</strong> call Tele-MANAS <a href="tel:14416">14416</a> (India, free, 24×7) or your local emergency number (<a href="tel:112">112</a> in India).</li></ul>
            ${urgentQueued ? '<p class="small">✓ Urgent flag is first in your next report. Open <a href="#sync">Sync</a> to send it now.</p>' : '<button class="btn" data-sup="urgent-flag">Flag urgent to ground</button>'}
          </div>
        </div>
      </section>
      <p class="fine">Self-help and decision support only — not therapy and not a diagnosis. Based on: Carter, Buckey et al. 2005 (self-help tools for long missions) · Goessl et al. 2017 (slow-breathing biofeedback) · Nahum-Shani et al. 2018 (support at the right moment) · Rosekind et al. 1995 (short naps).</p>`;
    updateSupLive();
    if (running) tickBr();
    if (arg === 'breathe') setTimeout(() => document.getElementById('breathe')?.scrollIntoView({ block: 'start' }), 0);
  }
  const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);
  function tickBr() {
    if (!br) return;
    const el = (performance.now() - br.start) / 1000;
    if (el >= Q.BREATH.dur) return brFinish(true);
    const ph = Q.breathPhase(el);
    const pEl = document.getElementById('brPhase'), tEl = document.getElementById('brTime'), orb = document.getElementById('brOrb');
    if (pEl) { const txt = (ph.phase === 'in' ? 'Breathe in' : 'Breathe out') + ' · ' + ph.left; if (pEl.textContent !== txt) pEl.textContent = txt; pEl.className = 'br-phase ' + ph.phase; }
    if (tEl) tEl.textContent = mmss(Math.ceil(Q.BREATH.dur - el));
    if (orb && !calm()) orb.style.transform = `scale(${(ph.phase === 'in' ? 1 + 0.2 * ease(ph.p) : 1.2 - 0.2 * ease(ph.p)).toFixed(3)})`;
  }
  function brStart() {
    br = { start: performance.now(), before: bandSnap(30), timer: setInterval(tickBr, 50) };
    if (Q.band.setPacedBreathing) Q.band.setPacedBreathing(true);
    renderSupport();
  }
  function brFinish(done) {
    if (!br) return;
    clearInterval(br.timer);
    if (Q.band.setPacedBreathing) Q.band.setPacedBreathing(false);
    if (done) {
      const after = bandSnap(60);
      if (Q.band.source === 'demo' && Q.band.demoStress) Q.band.demoStress(false); // simulated: the stress eases after breathing
      S.breaths = [{ at: Date.now(), before: br.before, after }].concat(S.breaths || []).slice(0, 10); save();
      toast('Nice work — 2 minutes done ✓');
    }
    br = null;
    if (currentTab() === 'support') renderSupport();
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-sup]'); if (!t) return;
    const k = t.dataset.sup;
    if (k === 'br-start') return brStart();
    if (k === 'br-stop') return brFinish(false);
    if (k === 'call') {
      const set = new Set(S.levers); set.has('call') ? set.delete('call') : set.add('call'); S.levers = [...set];
      toast(set.has('call') ? 'Added to today’s plan — it also updates your forecast' : 'Removed from your plan');
    }
    if (k === 'cmo') {
      const s = strainNow(), signs = s.stress.concat(s.fatigue).map((x) => x.text);
      S.queue.push({ key: 'sup-cmo', title: 'Request: private talk with flight surgeon or psychologist',
        text: S.supShare && signs.length ? 'Crew member asks for a private conversation. Signs they chose to share: ' + signs.join('; ') + '.' : 'Crew member asks for a private conversation.' });
      toast('Added to your next report');
    }
    if (k === 'cmo-cancel') S.queue = S.queue.filter((q) => q.key !== 'sup-cmo');
    if (k === 'urgent') S.supUrgentOpen = !S.supUrgentOpen;
    if (k === 'urgent-flag' && !S.queue.some((q) => q.key === 'sup-urgent')) {
      S.queue.unshift({ key: 'sup-urgent', title: 'URGENT: crew member asks for support now', text: 'Crew member reports feeling very low or unsafe. Please contact them privately as soon as possible.' });
      toast('Urgent flag is first in your next report');
    }
    save(); renderHeader(); const y = window.scrollY; renderSupport(); window.scrollTo(0, y);
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'supShare') { S.supShare = e.target.checked; save(); } });

  // ---------- router ----------
  function applyTheme() {
    const html = document.documentElement;
    html.classList.add('theme-switch'); // no colour fades while the whole theme changes
    html.dataset.theme = S.theme;
    void html.offsetHeight;
    setTimeout(() => html.classList.remove('theme-switch'), 50);
  }
  function route() {
    const [tab, arg] = (location.hash.slice(1) || 'today').split('/');
    document.querySelectorAll('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
    cancelAnimationFrame(stripRaf);
    if (br && tab !== 'support') brFinish(false);
    ({ today: renderToday, support: () => renderSupport(arg), band: renderBand, checkin: renderCheckin, trends: () => renderTrends(arg), crew: renderCrew, sync: renderSync, about: renderAbout }[tab] || renderToday)();
    const v = $('#view'); v.dataset.tab = tab; v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); // cards pop in once per screen visit
    clearTimeout(route.t); route.t = setTimeout(() => v.classList.remove('enter'), 1200);
    updateYou(true);
    save();
  }
  function renderAll() { renderHeader(); renderCrewbar(); route(); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-queue],[data-unqueue],[data-range],[data-del]');
    if (!t) return;
    if (t.dataset.range) { S.range = Number(t.dataset.range); renderTrends(); return; }
    if (t.dataset.del) { S.queue.splice(Number(t.dataset.del), 1); save(); renderHeader(); renderSync(); return; }
    const key = t.dataset.queue || t.dataset.unqueue;
    let a = analysis().alerts.find((x) => x.key === key);
    if (!a && key.startsWith('c-')) {
      const x = fc().conditions[key.slice(2)];
      if (x) a = { key, title: `${x.label}: ${Q.WX[x.wx].word.toLowerCase()} now · ${x.prob[0] ?? '—'}% chance it needs attention tomorrow`, ground: x.ground };
    }
    if (t.dataset.queue && a) { S.queue.push({ key: a.key, title: a.title, text: a.ground }); toast('Added to your next report'); }
    if (t.dataset.unqueue) S.queue = S.queue.filter((q) => q.key !== t.dataset.unqueue);
    save(); renderHeader(); renderToday();
  });
  document.addEventListener('change', (e) => {
    const lvr = e.target.dataset && e.target.dataset.lever;
    if (lvr) {
      const set = new Set(S.levers); e.target.checked ? set.add(lvr) : set.delete(lvr);
      S.levers = [...set]; save();
      const y = window.scrollY; renderToday(); renderCrewbar(); window.scrollTo(0, y);
      toast(e.target.checked ? 'Forecast updated with your plan' : 'Removed from your plan');
      return;
    }
    const d = e.target.dataset && e.target.dataset.done;
    if (!d) return;
    const [key, i] = d.split('|'); const k = 'me|' + key;
    const arr = new Set(S.done[k] || []); e.target.checked ? arr.add(+i) : arr.delete(+i);
    S.done[k] = [...arr]; save();
  });
  window.addEventListener('hashchange', () => { route(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); });
  window.addEventListener('online', renderOffline); window.addEventListener('offline', renderOffline);
  function renderOffline() {
    $('#offlinePill').innerHTML = navigator.onLine
      ? '<i class="dot ok"></i><span class="lg-only">Works offline</span><span class="sm-only">Offline OK</span>'
      : '<i class="dot ok"></i><span class="lg-only">Offline — all data on board</span><span class="sm-only">Offline</span>';
  }

  // ---------- drifting confetti stars (12wave-style), behind the app ----------
  (function makeSpace() {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const space = document.createElement('div'); space.className = 'space'; space.setAttribute('aria-hidden', 'true');
    const layers = [[0.6, 14], [1.4, 10], [2.6, 7]].map(([depth, n], li) => {
      const L = document.createElement('div'); L.className = 'layer'; L.dataset.depth = depth;
      let html = '<div class="drift">';
      for (let i = 0; i < n; i++) {
        const s = (2 + rnd() * 3 + li * 1.4).toFixed(1), kind = rnd() < 0.3 ? 'ring' : rnd() < 0.15 ? 'plus' : 'dot';
        html += `<i class="${kind} c${1 + Math.floor(rnd() * 5)}" style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 100).toFixed(1)}%;--s:${s}px;animation-delay:${(-rnd() * 6).toFixed(1)}s"></i>`;
      }
      L.innerHTML = html + '</div>'; space.appendChild(L); return L;
    });
    const shoot = document.createElement('i'); shoot.className = 'shoot'; space.appendChild(shoot);
    // big flat planets in the corners + a drifting rocket (decorative palette only)
    const P = document.createElement('div'); P.className = 'layer planets'; P.dataset.depth = 0.35;
    P.innerHTML = '<div class="pl pl-sun"></div><div class="pl pl-rose"><i class="pl-ring"></i></div><div class="pl pl-moon"><i class="pl-ring"></i></div><div class="pl pl-tiny"></div>'
      + '<svg class="bg-rocket" viewBox="0 0 64 120"><path class="r-flame" d="M24 82 Q32 116 40 82 Q32 94 24 82Z"/><path class="a-fill" d="M32 4 C48 18 50 46 45 78 H19 C14 46 16 18 32 4Z"/><circle class="a-visor" cx="32" cy="38" r="8"/><path class="a-fill" d="M19 58 L7 80 L19 77Z M45 58 L57 80 L45 77Z"/></svg>';
    space.prepend(P); layers.push(P);
    document.body.prepend(space);
    // gentle parallax with the pointer (mouse only, off for reduced motion)
    if (!matchMedia('(pointer: fine)').matches) return;
    let raf = 0, mx = 0, my = 0;
    window.addEventListener('pointermove', (e) => {
      if (calm()) return;
      mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0;
        layers.forEach((L) => { const d = L.dataset.depth * 10; L.style.transform = `translate3d(${(-mx * d).toFixed(1)}px, ${(-my * d).toFixed(1)}px, 0)`; }); });
    }, { passive: true });
  })();

  // ---------- install as an app ----------
  let installEvt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  function showInstall(on) { ['installBtn', 'installPill'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = !on; }); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!standalone()) showInstall(true); });
  window.addEventListener('appinstalled', () => { installEvt = null; showInstall(false); toast('CrewPulse installed — open it from your apps'); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#installBtn, #installPill')) return;
    if (!installEvt) { toast('Use your browser menu → "Install app" / "Add to Home screen"'); return; }
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null; showInstall(false);
    if (outcome === 'accepted') toast('Installing CrewPulse…');
  });
  if (standalone()) document.documentElement.classList.add('standalone');

  applyTheme(); regen(); renderAll(); renderOffline();
  // new day while the app is open → rebuild from the log
  let lastKey = Q.dateKey();
  const dayCheck = () => { if (Q.dateKey() !== lastKey) { lastKey = Q.dateKey(); regen(); renderAll(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) dayCheck(); });
  setInterval(dayCheck, 60000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
