/* CrewPulse — "body weather" forecast.
   Turns your own readings into 4 conditions, rates today like weather,
   and projects the next 3 days from recent trends. Simple and explainable on
   purpose: it extends the recent trend, it is not a medical prediction. */
(function () {
  const Q = window.CP;
  const avg = (a) => { const b = a.filter((v) => v != null); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : null; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  Q.HORIZON = 3;

  Q.WX = {
    // One status scale everywhere (Normal / Watch / Act today). The weather icons stay as pictures only.
    clear: { word: 'Normal', rank: 0, lvl: 'ok' },
    fair: { word: 'Normal', rank: 1, lvl: 'ok' },
    cloudy: { word: 'Watch', rank: 2, lvl: 'watch' },
    rain: { word: 'Watch', rank: 3, lvl: 'watch' },
    storm: { word: 'Act today', rank: 4, lvl: 'act' },
    none: { word: 'Not enough data', rank: -1, lvl: 'none' },
  };
  const wxOf = (s) => (s >= 3 ? 'storm' : s >= 2.2 ? 'rain' : s >= 1.4 ? 'cloudy' : s >= 0.7 ? 'fair' : 'clear');
  Q.wxOf = wxOf;

  Q.CONDITIONS = {
    fatigue: { label: 'Fatigue', storm: 'Fatigue', feels: 'tired, slower reactions', weights: { sleep: 0.35, rt: 0.3, hrv: 0.2, stress: 0.15 },
      why: 'Sleep, reaction time and heart recovery drifting together point to building fatigue. It is easy to miss from the inside.',
      now: ['Protect an 8.5-hour sleep window tonight', 'Re-take the reaction test before any critical task', 'Ask a crewmate to double-check critical steps today'],
      ground: 'Fatigue building: sleep, reaction time and HRV off personal baseline. Request schedule review.' },
    mood: { label: 'Mood', storm: 'Low mood', feels: 'low, stressed', weights: { mood: 0.6, stress: 0.4 },
      why: 'Isolation and confinement wear people down slowly. Acting early keeps a cloudy patch from becoming a long rainy spell.',
      now: ['Book a private call with family or a friend at the next pass', 'Share a meal or a break with the crew', 'Write down one thing that is bothering you'],
      ground: 'Mood and stress off baseline. Request private psychological conference.' },
    heart: { label: 'Heart', storm: 'Heart strain', feels: 'heart working harder', weights: { rhr: 0.6, hrv: 0.4 },
      why: 'A higher resting heart rate with lower HRV can mean poor recovery, too little water, illness or loss of fitness.',
      now: ['Drink water and re-measure after 10 minutes of rest', 'Dizziness, chest pain or racing heart? Call the crew medical officer now', 'Keep your exercise session today'],
      ground: 'Resting HR up / HRV down vs personal baseline. Request flight surgeon review.' },
    muscle: { label: 'Muscle & bone', storm: 'Muscle loss', feels: 'weaker grip, missed workouts', weights: { grip: 0.45, exercise: 0.4, mass: 0.15 },
      why: 'Without daily exercise, weightlessness quickly weakens muscles and bones. Grip strength is an early warning sign.',
      now: ['Book make-up time on the resistance device and treadmill', 'Eat your full protein portion', 'Re-test grip strength in 3 days'],
      ground: 'Grip strength down vs personal baseline, exercise below target. Request countermeasure plan update.' },
  };

  // "What changes the forecast" levers. Effects are rough, typical recovery
  // estimates for the demo, clearly labelled in the UI.
  // Each lever pulls a projection back toward your normal. Skipped for metrics with no data yet.
  const pull = (p, B, m, f) => { if (!p[m] || !B[m] || B[m].mean == null) return; p[m] = p[m].map((v, k) => (v == null ? v : v - (v - B[m].mean) * (Array.isArray(f) ? f[k] : f))); };
  Q.LEVERS = [
    { id: 'sleep', label: 'Sleep 8.5 h tonight', conds: ['fatigue', 'mood'],
      apply(p, B) { if (p.sleep && B.sleep.mean != null) p.sleep = p.sleep.map((v) => (v == null ? v : Math.max(v, B.sleep.mean + 0.2)));
        pull(p, B, 'rt', [0.5, 0.75, 0.9]); pull(p, B, 'hrv', [0.4, 0.6, 0.8]); pull(p, B, 'stress', 0.3); } },
    { id: 'call', label: 'Call family or a friend', conds: ['mood'],
      apply(p, B) { pull(p, B, 'mood', [0.4, 0.5, 0.6]); pull(p, B, 'stress', [0.3, 0.4, 0.5]); } },
    { id: 'workout', label: 'Make-up exercise sessions', conds: ['muscle', 'heart'],
      apply(p, B) { if (p.exercise) p.exercise = p.exercise.map((v) => (v == null ? v : B.exercise.mean));
        if (p.grip && p.grip[0] != null) { const g = p.grip[0]; p.grip = p.grip.map(() => g); }
        pull(p, B, 'rhr', [0.2, 0.3, 0.4]); } },
  ];

  // How "bad" a single reading is, on one shared scale (0 = your normal).
  function badZ(m, v, b) {
    const M = Q.METRICS[m];
    if (v == null || !b || b.mean == null) return null;
    if (M.base === 'early') return ((M.dir === 'up' ? 1 : -1) * (v - b.mean)) / b.sd;
    if (M.base === 'pre') { const pct = ((v - b.mean) / b.mean) * 100; return (M.dir === 'up' ? pct : -pct) / 2.5; }
    if (M.base === 'target') return (1 - v / b.mean) / 0.1;
    return null;
  }
  Q.badZ = badZ;

  const LIMITS = { sleep: [0, 14], mood: [1, 5], stress: [1, 5], exercise: [0, 400], rt: [150, 900] };
  // Trend line through your last (up to 7) readings from the past 14 days, damped, 3 days ahead.
  // Needs a ready baseline and 3+ recent readings; otherwise no projection.
  function project(m, s, b) {
    const n = s.length; const pts = [];
    for (let i = Math.max(0, n - 14); i < n; i++) if (s[i] != null) pts.push([i, s[i]]);
    if (!b || b.mean == null || pts.length < 3) return null;
    const use = pts.slice(-7);
    const xm = avg(use.map((p) => p[0])), ym = avg(use.map((p) => p[1]));
    let num = 0, den = 0;
    use.forEach(([x, y]) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
    const slope = den ? num / den : 0;
    const last = avg(use.slice(-3).map((p) => p[1]));
    const gap = n - 1 - use[use.length - 1][0]; // days since your last reading
    let acc = gap * 0.5;
    const L = LIMITS[m];
    return [1, 2, 3].map((k) => { acc += 0.9 ** (k - 1); const v = last + slope * acc; return L ? clamp(v, L[0], L[1]) : v; });
  }
  Q.project = project;

  // weighted badness over the metrics that have data (weights re-scaled); null if none do
  function score(cond, vals, B) {
    let t = 0, w = 0;
    for (const [m, wt] of Object.entries(Q.CONDITIONS[cond].weights)) {
      const z = badZ(m, vals[m], B[m]);
      if (z == null) continue;
      t += wt * Math.max(0, z); w += wt;
    }
    return w ? t / w : null;
  }
  const prob = (s, k) => (s == null ? null : Math.round(clamp(100 / (1 + Math.exp(-((s - 2.2) * 2.2) / (1 + 0.15 * k))), 3, 97) / 5) * 5);
  const wxOrNone = (s) => (s == null ? 'none' : wxOf(s));
  Q.wxText = (C, wx) => (wx === 'none' ? 'Not enough data' : wx === 'storm' ? C.storm + ' — act today' : wx === 'rain' || wx === 'cloudy' ? C.storm + ' — watch' : 'All normal');

  const DAY = 86400000;
  const dayName = (k) => new Date(Date.now() + k * DAY).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

  Q.forecast = function (c, checkin, levers) {
    const B = {}, proj = {}, today = {};
    for (const m in Q.METRICS) {
      const s = c.series[m];
      const a = Q.analyzeMetric(m, s);
      B[m] = a.baseline.ready ? a.baseline : { mean: null };
      proj[m] = project(m, s, B[m]);
      today[m] = B[m].mean == null ? null : a.recent;
    }
    const base = JSON.parse(JSON.stringify(proj));
    const active = (levers || []).filter((id) => Q.LEVERS.some((l) => l.id === id));
    for (const id of active) Q.LEVERS.find((l) => l.id === id).apply(proj, B);

    const sym = (checkin && checkin.symptoms) || [];
    const conditions = {};
    for (const key in Q.CONDITIONS) {
      const C = Q.CONDITIONS[key];
      const bump = key === 'mood' && sym.includes('lonely') ? 1 : 0;
      const raw = score(key, today, B);
      const s0 = raw == null ? (bump || null) : raw + bump;
      const at = (src, k) => { const v = {}; for (const m in C.weights) v[m] = src[m] ? src[m][k] : null; const sc = score(key, v, B); return sc == null ? null : sc + bump * 0.5; };
      const sProj = [0, 1, 2].map((k) => at(proj, k));
      const sBase = [0, 1, 2].map((k) => at(base, k));
      // last 14 days: each day = readings in a 3-day window (null if none)
      const hist = [];
      for (let i = Q.N - 14; i < Q.N; i++) {
        if (i < 0) { hist.push(null); continue; }
        const v = {}; for (const m in C.weights) v[m] = avg(c.series[m].slice(Math.max(0, i - 2), i + 1));
        hist.push(score(key, v, B));
      }
      const drivers = [];
      for (const m in C.weights) {
        const z = badZ(m, today[m], B[m]);
        if (z == null || z < 1) continue;
        const M = Q.METRICS[m];
        let streak = 0;
        for (let i = Q.N - 1; i >= 0; i--) { const zi = badZ(m, c.series[m][i], B[m]); if (zi == null) continue; if (zi < 1) break; streak++; }
        const normWord = M.base === 'target' ? 'target' : 'your normal';
        drivers.push({ m, z, text: `${M.short} ${Q.fmt(m, today[m])} ${M.unit} — ${normWord} ${Q.fmt(m, B[m].mean)}`, streak });
      }
      drivers.sort((a, b) => b.z * C.weights[b.m] - a.z * C.weights[a.m]);
      if (bump) drivers.push({ m: null, text: 'You reported feeling low or lonely today' });
      const missing = Object.keys(C.weights).filter((m) => B[m].mean == null);
      conditions[key] = { key, ...C, ready: s0 != null, missing, score: s0, wx: wxOrNone(s0), hist, proj: sProj, prob: sProj.map(prob), probBase: sBase.map(prob), wxProj: sProj.map(wxOrNone), drivers };
    }

    // Headline = the worst condition that has data
    const list = Object.values(conditions).filter((x) => x.ready);
    const days = [0, 1, 2, 3].map((k) => {
      const label = k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : dayName(k);
      const opts = list.map((c2) => ({ c: c2, s: k === 0 ? c2.score : c2.proj[k - 1] })).filter((o) => o.s != null);
      if (!opts.length) return { k, label, wx: 'none', text: 'Not enough data', cond: null, prob: null };
      const pick = opts.reduce((w, x) => (x.s > w.s ? x : w), opts[0]);
      const wx = wxOf(pick.s);
      return { k, label, wx, text: Q.wxText(pick.c, wx), cond: pick.c.key, prob: k === 0 ? null : pick.c.prob[k - 1] };
    });
    return { conditions, days, proj, B, levers: active, ready: list.length > 0, readyCount: list.length };
  };

  // ---- weather icons: one line-icon set (24 grid, scaled), tinted by status in CSS ----
  const SUN = (cx, cy, r, rays = true) => {
    let g = `<circle cx="${cx}" cy="${cy}" r="${r}" class="fillsoft"/>`;
    if (rays) for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r1 = r + 2.2, r2 = r + 4.4; g += `<line x1="${(cx + Math.cos(a) * r1).toFixed(2)}" y1="${(cy + Math.sin(a) * r1).toFixed(2)}" x2="${(cx + Math.cos(a) * r2).toFixed(2)}" y2="${(cy + Math.sin(a) * r2).toFixed(2)}"/>`; }
    return g;
  };
  const CLOUD = (dx, dy, soft) => `<path${soft ? ' class="fillsoft"' : ''} transform="translate(${dx} ${dy})" d="M7 18.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.2 4.7 4.7 0 0 0 7 18.5z"/>`;
  Q.wxIcon = function (wx, size = 48, label) {
    let g = '';
    if (wx === 'clear') g = SUN(12, 12, 4.2);
    else if (wx === 'fair') g = SUN(8.5, 8.5, 3, true) + CLOUD(2, 2, true);
    else if (wx === 'cloudy') g = CLOUD(-1.5, -2.5, false) + CLOUD(1.5, 1, true);
    else if (wx === 'rain') g = CLOUD(0, -2, true) + '<line x1="8.5" y1="19" x2="7.5" y2="21.5"/><line x1="12.5" y1="19" x2="11.5" y2="21.5"/><line x1="16.5" y1="19" x2="15.5" y2="21.5"/>';
    else if (wx === 'storm') g = CLOUD(0, -3, true) + '<path d="M12.8 15.2 10.4 19h3l-1.8 3.8"/>';
    else g = '<circle cx="12" cy="12" r="7" stroke-dasharray="2.5 2.5"/><line x1="9" y1="12" x2="15" y2="12"/>';
    return `<svg class="wx wx-${wx}" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${label || Q.WX[wx].word}">${g}</svg>`;
  };
})();
