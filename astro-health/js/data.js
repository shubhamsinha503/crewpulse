/* CrewPulse — YOUR data only (except the labelled ?sample mode, which is simulated and kept in memory).
   Everything comes from a day-by-day log stored on this device:
   - the Band's 2-minute calm reading (resting heart rate, HRV)
   - the daily check-in (sleep, mood, stress, symptoms, reaction time, exercise, grip, mass)
   No simulated people, no simulated cabin data. Days you didn't measure stay empty. */
(function () {
  const Q = (window.CP = window.CP || {});

  // base: how your personal "normal" is set
  //  early = your first readings (up to 14 days) — real missions use 14 days
  //  pre   = same, but judged by % change (good for slow loss, e.g. strength)
  //  target= a fixed daily target
  Q.METRICS = {
    rhr: { label: 'Resting heart rate', short: 'Resting HR', unit: 'bpm', dir: 'up', domain: 'heart', base: 'early', dec: 0, sdMin: 1.5, src: 'Band · 2-min calm reading' },
    hrv: { label: 'Heart rate variability (RMSSD)', short: 'HRV', unit: 'ms', dir: 'down', domain: 'heart', base: 'early', dec: 0, sdMin: 3, src: 'Band · 2-min calm reading' },
    ib: { label: 'Irregular heartbeats (per 1,000 beats)', short: 'Irregular beats', unit: '/1000', dir: 'up', domain: 'heart', base: 'early', dec: 1, sdMin: 1.5, src: 'Band ECG · counted while you wear it' },
    temp: { label: 'Skin temperature (calm reading)', short: 'Skin temp', unit: '°C', dir: 'up', domain: 'heart', base: 'early', dec: 1, sdMin: 0.25, src: 'Band skin probe · calm reading' },
    sleep: { label: 'Sleep duration', short: 'Sleep', unit: 'h', dir: 'down', domain: 'sleep', base: 'early', dec: 1, sdMin: 0.3, src: 'Check-in' },
    mood: { label: 'Mood (self-check)', short: 'Mood', unit: '/5', dir: 'down', domain: 'mind', base: 'early', dec: 1, sdMin: 0.4, src: 'Check-in' },
    stress: { label: 'Stress (self-check)', short: 'Stress', unit: '/5', dir: 'up', domain: 'mind', base: 'early', dec: 1, sdMin: 0.4, src: 'Check-in' },
    rt: { label: 'Reaction time (short PVT)', short: 'Reaction', unit: 'ms', dir: 'up', domain: 'mind', base: 'early', dec: 0, sdMin: 8, src: 'Check-in test or Band buzz test' },
    exercise: { label: 'Exercise time', short: 'Exercise', unit: 'min', dir: 'down', domain: 'bone', base: 'target', target: 30, dec: 0, src: 'Check-in' },
    grip: { label: 'Grip strength', short: 'Grip', unit: 'kg', dir: 'down', domain: 'bone', base: 'pre', pct: [5, 8], dec: 1, src: 'Check-in (weekly)' },
    mass: { label: 'Body mass', short: 'Body mass', unit: 'kg', dir: 'down', domain: 'bone', base: 'pre', pct: [3, 5], dec: 1, src: 'Check-in (weekly)' },
  };
  Q.DOMAINS = {
    heart: { label: 'Heart', hazard: 'Altered gravity' },
    bone: { label: 'Bone & muscle', hazard: 'Altered gravity' },
    sleep: { label: 'Sleep', hazard: 'Isolation & distance' },
    mind: { label: 'Mind', hazard: 'Isolation & confinement' },
  };
  Q.EVENTS = [];
  Q.LINK_BPS = 9600;
  Q.MIN_DAYS = 3; // readings needed before a metric gets a "normal"
  Q.BASE_DAYS = 14; // full personal baseline

  // ---------- dates (local time) ----------
  const pad = (n) => String(n).padStart(2, '0');
  Q.dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  Q.parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const DAY = 86400000;
  const daysBetween = (a, b) => Math.round((Q.parseKey(b) - Q.parseKey(a)) / DAY);
  Q.fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  // ---------- the log (this device only) ----------
  const LOG_KEY = 'crewpulse-log-v1';

  // ---------- sample mode (?sample) ----------
  // A clearly labelled, simulated 21-day log so visitors and judges can see every screen with data.
  // It lives in memory only: your real log is never read, changed or saved over. Leave with "Exit sample".
  const SAMPLE_FLAG = 'crewpulse-sample';
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.has('sample')) sessionStorage.setItem(SAMPLE_FLAG, '1');
    if (qs.has('real')) sessionStorage.removeItem(SAMPLE_FLAG);
    Q.SAMPLE = sessionStorage.getItem(SAMPLE_FLAG) === '1';
  } catch (e) { Q.SAMPLE = false; }
  function sampleLog() {
    const days = {}, now = new Date();
    const wob = (i, a) => Math.sin(i * 1.7) * a;
    for (let k = 20; k >= 0; k--) {
      const i = 20 - k, drift = Math.max(0, i - 14) / 6; // a gentle fatigue/strain drift over the last 6 days
      const v = {
        rhr: Math.round(58 + wob(i, 1.5) + drift * 6), hrv: Math.round(56 + wob(i, 3) - drift * 14),
        temp: +(33.4 + wob(i, 0.12) + drift * 0.5).toFixed(1), ib: +(1.2 + Math.abs(wob(i, 0.5)) + drift * 1.5).toFixed(1),
        sleep: +(7.1 + wob(i, 0.35) - drift * 1.8).toFixed(1), mood: +(4 + wob(i, 0.3) - drift * 1.3).toFixed(1),
        stress: +(2 + wob(i, 0.3) + drift * 1.4).toFixed(1), rt: Math.round(282 + wob(i, 8) + drift * 45),
        exercise: Math.round(45 + wob(i, 10) - drift * 15),
      };
      if (i % 7 === 0 || k === 0) { v.grip = +(41 - i * 0.05).toFixed(1); v.mass = +(72.4 - i * 0.02).toFixed(1); }
      days[Q.dateKey(new Date(now.getTime() - k * DAY))] = { values: v, symptoms: [], sources: {}, at: Date.now() - k * DAY };
    }
    return { v: 1, days, sample: true };
  }
  Q.exitSample = () => { try { sessionStorage.removeItem(SAMPLE_FLAG); } catch (e) {} location.href = location.pathname + '#today'; };

  let LOG;
  if (Q.SAMPLE) LOG = sampleLog();
  else {
    try { LOG = JSON.parse(localStorage.getItem(LOG_KEY) || 'null'); } catch (e) { LOG = null; }
    if (!LOG || typeof LOG !== 'object' || !LOG.days) LOG = { v: 1, days: {} };
  }
  const persist = () => { if (Q.SAMPLE) return; try { localStorage.setItem(LOG_KEY, JSON.stringify(LOG)); } catch (e) { /* storage blocked */ } };

  // label every screen while sample data is showing
  if (Q.SAMPLE) addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.className = 'sample-banner';
    b.innerHTML = '<span><b>Sample data</b> · simulated 3-week log so you can explore every screen. Your own data is not touched.</span><button type="button">Exit sample</button>';
    b.querySelector('button').onclick = Q.exitSample;
    document.body.prepend(b);
  });

  Q.log = {
    days: () => Object.keys(LOG.days).filter((k) => hasData(LOG.days[k])).sort(),
    get: (key = Q.dateKey()) => LOG.days[key] || null,
    // merge values (and optionally symptoms) into a day; source tells where they came from
    record(values, { key = Q.dateKey(), symptoms, source } = {}) {
      const d = LOG.days[key] || (LOG.days[key] = { values: {}, symptoms: [], sources: {}, at: 0 });
      for (const m in values) {
        const v = values[m];
        if (v === '' || v == null || Number.isNaN(Number(v)) || !Q.METRICS[m]) continue;
        d.values[m] = Number(v);
        if (source) d.sources[m] = source;
      }
      if (symptoms) d.symptoms = symptoms.slice();
      d.at = Date.now();
      persist();
      return d;
    },
    clear() { LOG = { v: 1, days: {} }; persist(); },
    export() { return JSON.stringify(LOG, null, 2); },
    import(json) { const o = JSON.parse(json); if (!o || !o.days) throw new Error('Not a CrewPulse log'); LOG = o; persist(); },
  };
  function hasData(d) { return !!d && ((d.values && Object.keys(d.values).length > 0) || (d.symptoms && d.symptoms.length > 0)); }

  // ---------- build "you" from the log ----------
  // series[m] = one slot per calendar day from your first logged day to today (null = not measured)
  const MAX_DAYS = 180;
  Q.build = function () {
    const today = Q.dateKey();
    const keys = Q.log.days();
    let start = keys.length ? keys[0] : today;
    if (daysBetween(start, today) > MAX_DAYS - 1) start = Q.dateKey(new Date(Q.parseKey(today).getTime() - (MAX_DAYS - 1) * DAY));
    const N = Math.max(1, daysBetween(start, today) + 1);
    const startDate = Q.parseKey(start);
    const series = {};
    for (const m in Q.METRICS) series[m] = new Array(N).fill(null);
    for (const k of keys) {
      const i = daysBetween(start, k);
      if (i < 0 || i >= N) continue;
      const v = LOG.days[k].values || {};
      for (const m in v) if (series[m]) series[m][i] = v[m];
    }
    Q.N = N;
    Q.PRE_DAYS = 0;
    Q.TODAY_MD = N; // "log day" number of today
    Q.startDate = startDate;
    Q.md = (i) => i + 1;
    Q.dayLabel = (i) => Q.fmtDate(new Date(startDate.getTime() + i * DAY));
    Q.daysLogged = keys.length;
    const todayEntry = Q.log.get(today) || { values: {}, symptoms: [] };
    return { id: 'me', name: 'You', first: 'Your', role: 'Your own data', series, today: todayEntry, priorDose: 0 };
  };
})();
