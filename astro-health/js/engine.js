/* CrewPulse — baseline + drift rules. Decision support only, not a diagnosis. */
(function () {
  const Q = window.CP;
  const nn = (a) => a.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const avg = (a) => { const b = nn(a); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : null; };
  const sd = (a) => { const b = nn(a), m = avg(b); return b.length > 1 ? Math.sqrt(b.reduce((x, y) => x + (y - m) ** 2, 0) / (b.length - 1)) : 0; };
  Q.nn = nn; Q.avg = avg;
  const RANK = { none: -1, ok: 0, watch: 1, act: 2 };
  Q.RANK = RANK;
  Q.worst = (levels) => levels.reduce((w, l) => (RANK[l] > RANK[w] ? l : w), 'ok');

  Q.ADVICE = {
    rhr: { title: 'Resting heart rate is above your normal',
      why: 'It can mean poor sleep, stress, too little water, getting sick, or losing fitness.',
      now: ['Drink water and re-measure after 10 minutes of rest', 'Check for dizziness, chest pain or a racing heart — if yes, call the crew medical officer now', 'Keep your exercise session today'],
      ground: 'Resting HR above personal baseline for 3 days. Request flight surgeon review.' },
    hrv: { title: 'Heart rate variability is below your normal',
      why: 'Low HRV is an early sign of strain: poor recovery, stress or illness.',
      now: ['Take an easier workload today if the schedule allows', 'Do a 5-minute slow-breathing break', 'Protect your sleep window tonight'],
      ground: 'HRV below personal baseline for 3 days.' },
    ib: { title: 'More irregular heartbeats than your normal',
      why: 'Extra early beats are often harmless, but on Apollo 15 and Mir they were the first sign of heart trouble. Low potassium, too little water, stress and poor sleep can all cause them.',
      now: ['Rest, drink water and re-check with the Band later today', 'Avoid heavy exertion until you have re-checked', 'Palpitations, dizziness or chest pain? Call the crew medical officer now'],
      ground: 'Irregular-beat rate above personal baseline. Request ECG review by the flight surgeon.' },
    temp: { title: 'Skin temperature is above your normal',
      why: 'A rise in temperature is often the first sign of an infection, before you feel ill.',
      now: ['Check your temperature with the medical kit thermometer', 'Rest and drink water', 'Chills, pain or feeling unwell? Tell the crew medical officer'],
      ground: 'Skin temperature above personal baseline. Possible early infection; request review.' },
    sleep: { title: 'You are sleeping less than your normal',
      why: 'Short sleep slows reactions and raises error risk on critical tasks.',
      now: ['Protect an 8.5-hour sleep window tonight', 'Dim screens and use the sleep light setting 1 hour before bed', 'Avoid caffeine late in the day'],
      ground: 'Sleep below personal baseline for 3 nights. Ask planners to review schedule.' },
    mood: { title: 'Your mood is lower than usual',
      why: 'Isolation and confinement can wear people down slowly. Spotting it early helps.',
      now: ['Book a private call with family or a friend at the next pass', 'Share a meal or a break with the crew', 'Write down one thing that is bothering you'],
      ground: 'Mood self-check below baseline. Request private psychological conference.' },
    stress: { title: 'Your stress is higher than usual',
      why: 'Long periods of high stress hurt sleep, immunity and teamwork.',
      now: ['Take a 5-minute break away from your task', 'Try slow breathing: 4 s in, 6 s out, for 2 minutes', 'Talk to the commander about workload'],
      ground: 'Stress self-check above baseline. Request workload review.' },
    rt: { title: 'Your reactions are slower than your normal',
      why: 'Slower reactions often mean fatigue. It matters most before robotics, docking or a spacewalk.',
      now: ['Re-take the reaction test before any critical task', 'Ask a crewmate to double-check critical steps today', 'Take a short rest or nap if the schedule allows'],
      ground: 'Reaction time slower than baseline. Flag before critical operations.' },
    exercise: { title: 'You are below your exercise target',
      why: 'Without daily exercise, weightlessness quickly weakens bones, muscles and the heart.',
      now: ['Book make-up time on the resistance device and treadmill', 'Report any equipment problem to the crew', 'Tell the commander if pain is stopping you'],
      ground: 'Exercise below 80% of prescribed target. Request countermeasure plan update.' },
    grip: { title: 'Grip strength has dropped from your normal',
      why: 'Grip is a simple sign of overall muscle loss, which is common in weightlessness.',
      now: ['Add the resistance exercises from your plan today', 'Check you are eating your full protein portion', 'Re-test grip in 3 days'],
      ground: 'Grip strength down vs personal baseline. Request exercise prescription review.' },
    mass: { title: 'Body mass has dropped from your normal',
      why: 'Losing mass in space often means eating too little, which speeds up bone and muscle loss.',
      now: ['Eat your full meal plan and log what you skip', 'Add one snack per day', 'Re-weigh in 3 days'],
      ground: 'Body mass down vs personal baseline. Request nutrition review.' },
  };

  Q.FATIGUE = {
    title: 'Fatigue & stress pattern',
    why: 'Several signs are drifting together: sleep, mood, reaction time and heart recovery. Together they point to building fatigue — easy to miss from the inside.',
    now: ['Protect an 8.5-hour sleep window tonight', 'Re-take the reaction test before any critical task', 'Ask a crewmate to double-check critical steps today', 'Book a private call at the next pass'],
    ground: 'Fatigue pattern: sleep, mood, reaction time and HRV off baseline together. Request private medical conference and schedule review.',
  };
  const FATIGUE_SET = ['sleep', 'mood', 'stress', 'rt', 'hrv'];

  Q.SYMPTOMS = [
    { id: 'headache', label: 'Headache' },
    { id: 'vision', label: 'Blurry or changed vision', level: 'act', title: 'Vision change reported',
      why: 'Changes in vision can be linked to fluid shifts in space (SANS). The flight surgeon should know soon.',
      now: ['Do the vision self-test card in the medical kit', 'Avoid fine visual tasks if vision is blurry'], ground: 'Crew reports vision change. Request eye exam / SANS check.' },
    { id: 'chest', label: 'Chest pain or racing heart', level: 'act', title: 'Chest pain or racing heart',
      why: 'This needs a person, not an app.',
      now: ['Stop work and sit down', 'Call the crew medical officer NOW', 'Follow the medical checklist'], ground: 'Crew reports chest pain / palpitations. URGENT flight surgeon contact.' },
    { id: 'back', label: 'Back pain' },
    { id: 'congestion', label: 'Stuffy nose / head' },
    { id: 'nausea', label: 'Nausea' },
    { id: 'skin', label: 'Skin rash or slow healing', level: 'watch', title: 'Skin rash or slow healing',
      why: 'The immune system can weaken in space. Rashes and slow healing are common early signs.',
      now: ['Photograph the area daily', 'Keep it clean and covered'], ground: 'Crew reports skin rash / slow healing. Possible immune change.' },
    { id: 'lonely', label: 'Feeling low or lonely', level: 'watch', title: 'Feeling low or lonely',
      why: 'Feeling cut off is normal on long missions, and it helps to act early.',
      now: ['Book a private call with family or a friend', 'Spend a break with the crew'], ground: 'Crew reports feeling low / lonely. Offer private psychological conference.' },
  ];

  // Your "normal" = your first readings (up to 14). Needs at least MIN_DAYS readings.
  function baselineFor(m, s) {
    const M = Q.METRICS[m];
    const vals = nn(s).slice(0, Q.BASE_DAYS);
    if (M.base === 'target') return vals.length >= Q.MIN_DAYS
      ? { mean: M.target, label: `Daily target ${M.target} ${M.unit}`, ready: true }
      : { mean: null, ready: false, n: vals.length, label: `Target ${M.target} ${M.unit} · counts after ${Q.MIN_DAYS} days (${vals.length} of ${Q.MIN_DAYS})` };
    if (vals.length < Q.MIN_DAYS) return { mean: null, sd: null, n: vals.length, ready: false, label: `Building your normal: ${vals.length} of ${Q.MIN_DAYS} readings` };
    return { mean: avg(vals), sd: Math.max(M.sdMin || 0, sd(vals)), n: vals.length, ready: true,
      label: vals.length >= Q.BASE_DAYS ? `Your first ${Q.BASE_DAYS} readings` : `Your first ${vals.length} readings (early normal)` };
  }

  // last value + 3-reading average from the last 7 days
  function recentOf(s, win = 7) {
    const n = s.length; let today = null, todayIdx = -1; const last = [];
    for (let i = n - 1; i >= Math.max(0, n - win); i--) {
      if (s[i] === null || s[i] === undefined) continue;
      if (todayIdx < 0) { today = s[i]; todayIdx = i; }
      if (last.length < 3) last.push(s[i]);
    }
    return { today, todayIdx, recent: last.length ? avg(last) : null, count: last.length };
  }
  Q.recentOf = recentOf;

  Q.analyzeMetric = function (m, s) {
    const M = Q.METRICS[m];
    const b = baselineFor(m, s);
    const r = recentOf(s, M.base === 'pre' ? 14 : 7); // weekly readings get 14 days
    const out = { m, today: r.today, todayIdx: r.todayIdx, recent: r.recent, baseline: b, z: null, pct: null, level: 'none', note: '', readings: nn(s).length };
    if (r.recent === null) { out.note = 'No recent reading'; return out; }
    if (!b.ready) { out.note = b.label; return out; }
    if (M.base === 'target') {
      out.pct = ((r.recent - b.mean) / b.mean) * 100;
      out.level = r.recent < 0.6 * b.mean ? 'act' : r.recent < 0.8 * b.mean ? 'watch' : 'ok';
      return out;
    }
    out.z = (r.recent - b.mean) / b.sd;
    out.pct = ((r.recent - b.mean) / b.mean) * 100;
    if (M.pct) { const bad = M.dir === 'up' ? out.pct : -out.pct; out.level = bad >= M.pct[1] ? 'act' : bad >= M.pct[0] ? 'watch' : 'ok'; }
    else { const bad = M.dir === 'up' ? out.z : -out.z; out.level = bad >= 3 ? 'act' : bad >= 2 ? 'watch' : 'ok'; }
    return out;
  };

  Q.analyze = function (c) {
    const metrics = {};
    for (const m in Q.METRICS) metrics[m] = Q.analyzeMetric(m, c.series[m]);
    const alerts = [];
    const flagged = (m) => metrics[m].level === 'watch' || metrics[m].level === 'act';
    const fatigueHits = FATIGUE_SET.filter(flagged);
    const useCluster = fatigueHits.length >= 2;
    if (useCluster) alerts.push({ key: 'fatigue', level: Q.worst(fatigueHits.map((m) => metrics[m].level)), ...Q.FATIGUE, metrics: fatigueHits, shared: false });
    for (const m of Object.keys(Q.METRICS)) {
      if (!flagged(m) || (useCluster && FATIGUE_SET.includes(m)) || !Q.ADVICE[m]) continue;
      alerts.push({ key: m, level: metrics[m].level, ...Q.ADVICE[m], metrics: [m], shared: false });
    }
    // symptoms from today's check-in
    const sym = (c.today && c.today.symptoms) || [];
    for (const sy of Q.SYMPTOMS) {
      if (!sym.includes(sy.id) || !sy.level) continue;
      alerts.push({ key: 'sym-' + sy.id, level: sy.level, title: sy.title, why: sy.why, now: sy.now, ground: sy.ground, metrics: [], shared: false, symptom: true });
    }
    alerts.sort((a, b) => RANK[b.level] - RANK[a.level]);
    const domains = {};
    for (const d in Q.DOMAINS) domains[d] = 'none';
    for (const m in metrics) { const d = Q.METRICS[m].domain; if (metrics[m].level !== 'none') domains[d] = domains[d] === 'none' ? metrics[m].level : Q.worst([domains[d], metrics[m].level]); }
    const ready = Object.values(metrics).filter((x) => x.level !== 'none').length;
    return { metrics, alerts, personal: alerts, shared: [], domains, readyMetrics: ready, overall: alerts.length ? Q.worst(alerts.map((a) => a.level)) : 'ok' };
  };

  Q.fmt = function (m, v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toFixed(Q.METRICS[m] ? Q.METRICS[m].dec : 0);
  };
})();
