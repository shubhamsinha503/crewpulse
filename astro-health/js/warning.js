/* CrewPulse — Early Warning Index.
   Four signals, each compared with YOUR own normal (Earth "normal ranges" mislead in weightlessness):
     1. irregular heartbeats   → heart rhythm  (Apollo 15 1971, Mir 1987 and 1997)
     2. resting heart rate up  ┐
     3. HRV down               ├ "your body may be fighting something" (Apollo 13 1970, Salyut 7 1985)
     4. skin temperature up    ┘
   Earth evidence: resting heart rate vs personal baseline flagged 63% of COVID cases before symptoms
   (Mishra et al. 2020); continuous temperature found fever before symptoms (Smarr et al. 2020).
   Prototype built on published evidence — not validated for diagnosis. */
(function () {
  const Q = window.CP;
  const RECENT_DAYS = 4; // a reading older than this does not count as "now"

  // z of a single reading vs your normal, signed so that + = worse
  function badZ(m, v, b) {
    if (v == null || !b || !b.ready || b.mean == null) return null;
    const M = Q.METRICS[m];
    const z = (v - b.mean) / Math.max(M.sdMin || 0, b.sd || 0, 1e-6);
    return M.dir === 'down' ? -z : z;
  }
  // latest readings within the last RECENT_DAYS days, newest first: [{ v, z, ago }]
  function latest(c, m, b, k) {
    const s = c.series[m], out = [];
    for (let i = s.length - 1; i >= 0 && s.length - 1 - i < RECENT_DAYS && out.length < k; i--) {
      if (s[i] != null) out.push({ v: s[i], z: badZ(m, s[i], b), ago: s.length - 1 - i });
    }
    return out;
  }
  const fmt = (m, v) => (v == null ? '—' : Q.fmt(m, v));

  Q.earlyWarning = function (c, B) {
    const a = Q.analyze(c);
    const sig = {};
    // resting HR and HRV: worse than normal on the last 2 readings (z ≥ 1) = a real shift, not one odd day
    for (const m of ['rhr', 'hrv']) {
      const b = a.metrics[m].baseline, L = latest(c, m, b, 2);
      if (!b.ready) { sig[m] = { m, state: 'none', text: b.label }; continue; }
      if (!L.length) { sig[m] = { m, state: 'none', text: 'No calm reading in the last few days' }; continue; }
      const two = L.length >= 2 && L.every((x) => x.z >= 1);
      const one = L[0].z >= 1.5;
      const state = two ? 'warn' : one ? 'watch' : 'ok';
      const word = m === 'rhr' ? (state === 'ok' ? 'normal' : 'up') : (state === 'ok' ? 'normal' : 'down');
      sig[m] = { m, state, now: L[0].v, base: b.mean,
        text: `${fmt(m, L[0].v)} ${Q.METRICS[m].unit} · normal ${fmt(m, b.mean)}${two ? ` · ${word} 2 readings in a row` : one ? ` · ${word} today` : ''}` };
    }
    // skin temperature: one reading clearly above your normal is enough (fever is fast)
    {
      const b = a.metrics.temp.baseline, L = latest(c, 'temp', b, 1);
      if (!b.ready) sig.temp = { m: 'temp', state: 'none', text: a.metrics.temp.readings ? b.label : 'Needs the skin probe on the Band' };
      else if (!L.length) sig.temp = { m: 'temp', state: 'none', text: 'No reading in the last few days' };
      else {
        const d = L[0].v - b.mean;
        const state = d >= 1.0 ? 'high' : L[0].z >= 1.5 && d >= 0.4 ? 'warn' : 'ok';
        sig.temp = { m: 'temp', state, now: L[0].v, base: b.mean, text: `${fmt('temp', L[0].v)} °C · normal ${fmt('temp', b.mean)}${state === 'ok' ? '' : ` · +${d.toFixed(1)} °C`}` };
      }
    }
    // irregular beats: today's rate (or the live rate) vs your normal
    {
      const b = a.metrics.ib.baseline, L = latest(c, 'ib', b, 1);
      const live = B && B.state === 'live' ? B.rhythm(600) : null;
      const liveOk = live && live.beats >= 100;
      const rate = liveOk ? live.perK : L.length ? L[0].v : null;
      const src = liveOk ? (B.source === 'demo' ? 'live, Demo Band (simulated)' : 'live, last 10 min') : 'today';
      const normal = b.ready ? b.mean : null;
      if (rate == null) sig.ib = { m: 'ib', state: 'none', text: a.metrics.ib.readings ? b.label : 'Wear the Band for 5+ minutes to start' };
      else {
        // before your normal is learned: watch at 10 per 1,000, act at 30
        const limit = normal == null ? 10 : Math.max(normal + Math.max(3, 2 * (b.sd || 0)), 3);
        const high = normal == null ? 30 : Math.max(10, 3 * normal, limit);
        const state = rate >= high ? 'high' : rate >= limit ? 'warn' : 'ok';
        sig.ib = { m: 'ib', state, now: rate, base: normal, live: liveOk,
          text: `${rate.toFixed(1)} per 1,000 beats (${src})${normal != null ? ` · normal ${normal.toFixed(1)}` : ' · your normal is still being learned'}` };
      }
    }

    // channels
    const bad = (x) => x.state === 'warn' || x.state === 'high';
    const infectionCount = ['rhr', 'hrv', 'temp'].filter((m) => bad(sig[m])).length;
    const infection = sig.temp.state === 'high' || infectionCount === 3 ? 'act' : infectionCount >= 2 || (sig.temp.state === 'warn' && infectionCount >= 1) ? 'watch' : 'ok';
    const rhythm = sig.ib.state === 'high' ? 'act' : sig.ib.state === 'warn' ? 'watch' : 'ok';
    const rank = { ok: 0, watch: 1, act: 2 };
    const level = rank[infection] >= rank[rhythm] ? infection : rhythm;
    const ready = ['rhr', 'hrv', 'ib', 'temp'].filter((m) => sig[m].state !== 'none').length;

    let title, text, ch = null;
    if (!ready) { title = 'Early warning is getting ready'; text = 'It starts after 3 calm readings with the Band. Wear the Band for 5+ minutes a day so it can learn your heart rhythm.'; }
    else if (level === 'ok') { title = 'No early warning signs'; text = 'Your heart rhythm, resting heart rate, HRV and temperature look like your normal.'; }
    else if (rank[rhythm] >= rank[infection]) {
      ch = 'rhythm';
      title = rhythm === 'act' ? 'Many irregular heartbeats' : 'More irregular heartbeats than your normal';
      text = rhythm === 'act'
        ? 'Tell the crew medical officer today. Rest, drink water and avoid heavy exertion until you are checked. Palpitations, dizziness or chest pain? Call now.'
        : 'Often harmless, but worth watching: rest, drink water and re-check with the Band later. Palpitations, dizziness or chest pain? Call the crew medical officer now.';
    } else {
      ch = 'infection';
      title = infection === 'act' ? 'Your body is likely fighting something' : 'Your body may be fighting something';
      text = infection === 'act'
        ? 'Tell the crew medical officer today. Rest, drink water, take your temperature with the kit thermometer, and lighten your workload.'
        : 'Signs often show 1–3 days before you feel ill. Rest, drink water, protect your sleep and re-check tonight.';
    }
    return { level, ready, title, text, channel: ch, infection, rhythm, signals: [sig.ib, sig.rhr, sig.hrv, sig.temp] };
  };
  Q.EW_LABEL = { ib: 'Heart rhythm', rhr: 'Resting heart rate', hrv: 'HRV', temp: 'Skin temperature' };
})();
