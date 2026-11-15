/* CrewPulse — Support: notices signs of strain and offers simple, evidence-based self-help,
   with an easy path to a person (crew medical officer / ground).
   It never diagnoses. It says "signs of strain", not "anxiety" or "depression".
   Evidence: Carter, Buckey et al. 2005 (self-guided help for crews, Virtual Space Station);
   Goessl, Curtiss & Hofmann 2017 (slow-breathing HRV biofeedback lowers stress and anxiety);
   Nahum-Shani et al. 2018 (just-in-time support, triggered by sensed state);
   Rosekind et al. 1995 (short planned naps restore alertness). */
(function () {
  const Q = window.CP;
  const rank = (wx) => (Q.WX[wx] ? Q.WX[wx].rank : -1);

  // Signs of strain from: live Band (now), today's check-in, recent days, and the forecast.
  // Each sign: { text, src, w } — w 1 = mild, 2 = strong.
  Q.strain = function (c, f, B) {
    const stress = [], fatigue = [];
    const v = (c.today && c.today.values) || {};
    const sym = (c.today && c.today.symptoms) || [];

    // live Band: heart working harder than your calm baseline while resting
    if (B && B.state === 'live' && B.baseline) {
      const L = B.live();
      if (L.ready && !L.active && !(B.recovery && !B.recovery.done)) {
        if (rank(L.wx) >= 3) stress.push({ text: `Heart rate ${Math.round(L.m.hr)} bpm while resting — well above your calm ${L.b.hr} bpm`, src: B.source === 'demo' ? 'Demo Band (simulated)' : 'Band, live', w: 2, live: true });
        else if (rank(L.wx) === 2) stress.push({ text: `Heart working harder than your calm baseline while resting`, src: B.source === 'demo' ? 'Demo Band (simulated)' : 'Band, live', w: 1, live: true });
      }
    }
    // today's check-in
    if (v.stress != null && v.stress >= 4) stress.push({ text: `You rated stress ${v.stress} of 5 today`, src: 'Check-in', w: v.stress >= 5 ? 2 : 1 });
    if (v.mood != null && v.mood <= 2) stress.push({ text: `You rated mood ${v.mood} of 5 today`, src: 'Check-in', w: v.mood <= 1 ? 2 : 1 });
    if (sym.includes('lonely')) stress.push({ text: 'You said you feel low or lonely', src: 'Check-in', w: 1 });
    if (v.sleep != null && v.sleep < 6) fatigue.push({ text: `You slept ${v.sleep} h`, src: 'Check-in', w: v.sleep < 5 ? 2 : 1 });
    const a = Q.analyze(c);
    const rt = a.metrics.rt;
    if (rt && rt.today != null && (rt.level === 'watch' || rt.level === 'act')) fatigue.push({ text: 'Reaction time slower than your normal', src: 'Reaction test', w: rt.level === 'act' ? 2 : 1 });
    // forecast (only if nothing more direct already says it)
    const fm = f && f.conditions.mood, ff = f && f.conditions.fatigue;
    if (!stress.length && fm && fm.ready && rank(fm.wx) >= 3) stress.push({ text: `Mood forecast: ${Q.wxText(fm, fm.wx).toLowerCase()}`, src: 'Forecast', w: 1 });
    if (!fatigue.length && ff && ff.ready && rank(ff.wx) >= 3) fatigue.push({ text: `Fatigue forecast: ${Q.wxText(ff, ff.wx).toLowerCase()}`, src: 'Forecast', w: 1 });

    // persisting: mood ≤ 2 or stress ≥ 4 on each of the last 3 days → time to talk to a person
    const last3 = (s) => s.slice(-3);
    const mo = last3(c.series.mood), st = last3(c.series.stress);
    let strainedDays = 0;
    for (let i = 0; i < 3; i++) if ((mo[i] != null && mo[i] <= 2) || (st[i] != null && st[i] >= 4)) strainedDays++;
    const persisting = strainedDays >= 3;

    const all = stress.concat(fatigue);
    const total = all.reduce((x, s) => x + s.w, 0);
    const level = !all.length ? 'none' : all.some((s) => s.w >= 2) || total >= 3 || persisting ? 'strong' : 'mild';
    const kind = stress.length && fatigue.length ? 'both' : stress.length ? 'stress' : fatigue.length ? 'fatigue' : 'none';
    return { level, kind, stress, fatigue, persisting, live: all.some((s) => s.live) };
  };

  // Plain-language headline for a strain result.
  Q.strainTitle = (s) => (s.level === 'none' ? 'No signs of strain right now'
    : s.kind === 'fatigue' ? 'Signs of tiredness today'
      : s.kind === 'both' ? 'Signs of stress and tiredness today' : 'Signs of stress today');

  // Fatigue tips (NASA fatigue countermeasures; short naps per Rosekind et al. 1995).
  Q.FATIGUE_TIPS = [
    { t: 'Take a 20–30 minute nap if your schedule allows', why: 'Short planned naps restore alertness. Longer naps can leave you groggy.' },
    { t: 'Swap or double-check safety-critical tasks today', why: 'Tired brains miss steps. Use the Go / caution check before a spacewalk, docking or robotics.' },
    { t: 'Caffeine early in your shift, none in the 6 hours before sleep', why: 'It helps now but steals sleep tonight.' },
    { t: 'Protect tonight’s sleep: dark, cool, quiet; screens off 30 minutes before', why: 'Sleep is the only full fix for fatigue.' },
    { t: 'Re-test your reaction time after resting', why: 'See whether you have bounced back before a demanding task.' },
  ];

  // Paced breathing: 6 breaths a minute (in 4 s, out 6 s) — the slow rate used in HRV biofeedback.
  Q.BREATH = { inS: 4, outS: 6, dur: 120 };
  Q.breathPhase = function (elapsedS) {
    const cyc = Q.BREATH.inS + Q.BREATH.outS, t = elapsedS % cyc;
    return t < Q.BREATH.inS
      ? { phase: 'in', left: Math.ceil(Q.BREATH.inS - t), p: t / Q.BREATH.inS }
      : { phase: 'out', left: Math.ceil(cyc - t), p: (t - Q.BREATH.inS) / Q.BREATH.outS };
  };
})();
