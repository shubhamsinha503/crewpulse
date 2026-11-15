/* CrewPulse — the chest Band connection.
   Sources: real Band over Bluetooth (Web Bluetooth), USB cable (Web Serial),
   or the built-in Demo Band, which sends the SAME packet format so the whole
   pipeline is tested before the hardware is ready. */
(function () {
  const Q = window.CP;

  // Bluetooth IDs — the Band firmware must use exactly these.
  const UUID = {
    service: '96540001-67d5-4fb0-a943-737a4c4c8ff5', // CrewPulse service
    status: '96540002-67d5-4fb0-a943-737a4c4c8ff5', // notify, every 10 s, 8 bytes
    reaction: '96540003-67d5-4fb0-a943-737a4c4c8ff5', // notify, after a test, 4 bytes
    control: '96540004-67d5-4fb0-a943-737a4c4c8ff5', // write: commands
    ecg: '96540005-67d5-4fb0-a943-737a4c4c8ff5', // notify, optional raw ECG
  };
  const CMD = { reaction: 0x01, ecgOn: 0x02, ecgOff: 0x03, history: 0x04, setTime: 0x05 };
  Q.BAND_UUID = UUID;

  const BASE_KEY = 'crewpulse-band-baseline';
  const loadBase = () => { try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch (e) { return null; } };
  const saveBase = (b) => { try { localStorage.setItem(BASE_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ } };

  const listeners = new Set();
  const B = (Q.band = {
    state: 'off', // off | connecting | live | lost
    source: null, // bluetooth | usb | demo
    name: '',
    error: '',
    bpm: null,
    beats: [], // { t, rr, ok }
    lastBeatAt: 0,
    status: { temp: null, activity: null, quality: null, battery: null, leadsOff: false, moving: false, at: 0 },
    reaction: null, // { median, lapses, falseStarts, at }
    reactionRunning: false,
    baseline: loadBase(), // { hr, rmssd, at }
    calib: null, // { start, dur }
    recovery: null, // { since, done, secs }
    hasBluetooth: !!(navigator.bluetooth),
    hasSerial: !!(navigator.serial),
    UUID,
  });
  B.on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = (type) => listeners.forEach((f) => { try { f(type); } catch (e) { console.error(e); } });

  // ---------- packet parsing (shared by all sources) ----------
  function parseHeart(dv) {
    const flags = dv.getUint8(0);
    let i = 1;
    const bpm = flags & 1 ? dv.getUint16(i, true) : dv.getUint8(i);
    i += flags & 1 ? 2 : 1;
    if (flags & 8) i += 2; // energy expended field
    const rr = [];
    if (flags & 16) for (; i + 1 < dv.byteLength; i += 2) rr.push((dv.getUint16(i, true) * 1000) / 1024);
    return { bpm, rr };
  }
  function parseStatus(dv) {
    // "Unknown" markers for sensors not fitted yet: temp -32768, activity 65535, battery 255
    const t = dv.getInt16(0, true), a = dv.getUint16(2, true), b = dv.byteLength > 6 ? dv.getUint8(6) : 255;
    return {
      temp: t === -32768 ? null : t / 100,
      activity: a === 0xffff ? null : a,
      quality: dv.getUint8(4),
      leadsOff: !!(dv.getUint8(5) & 1),
      moving: !!(dv.getUint8(5) & 2),
      battery: b === 255 ? null : b,
    };
  }
  function parseReaction(dv) {
    return { median: dv.getUint16(0, true), lapses: dv.getUint8(2), falseStarts: dv.getUint8(3) };
  }
  B._parse = { parseHeart, parseStatus, parseReaction }; // exposed for tests

  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  let rejectRun = 0;
  function addBeat(rr) {
    const t = Date.now();
    const recent = B.beats.filter((b) => b.ok).slice(-7).map((b) => b.rr);
    const med = median(recent);
    let ok = rr >= 300 && rr <= 2000 && (recent.length < 3 || Math.abs(rr - med) / med <= 0.2);
    if (!ok && rr >= 300 && rr <= 2000 && ++rejectRun >= 4) { ok = true; } // heart rate genuinely changed
    if (ok) rejectRun = 0;
    B.beats.push({ t, rr, ok });
    B.lastBeatAt = t;
    detectIrregular(t);
    const cut = t - 10 * 60 * 1000;
    while (B.beats.length && B.beats[0].t < cut) B.beats.shift();
  }
  // Irregular (early) beat = a short gap followed by a long "compensatory" pause that together
  // add up to about two normal gaps — the classic pattern of an extra beat on an ECG.
  // Random noise (extra or missed detections) does not fit this pattern, so it is not counted.
  // Early beats are kept out of heart rate and HRV (standard practice), but counted here.
  function detectIrregular(t) {
    const n = B.beats.length; if (n < 3) return;
    const cur = B.beats[n - 1], prev = B.beats[n - 2];
    if (prev.ect || prev.post) return;
    const ref = B.beats.slice(0, n - 2).filter((b) => b.ok).slice(-7).map((b) => b.rr);
    if (ref.length < 5 || B.status.leadsOff) return;
    const M = median(ref), sum = prev.rr + cur.rr;
    if (prev.rr < 0.8 * M && cur.rr > 1.1 * M && sum > 1.7 * M && sum < 2.3 * M) {
      prev.ect = true; prev.ok = false; cur.post = true; cur.ok = false; rejectRun = 0;
      countDay(0, 1);
      emit('irregular');
    }
  }
  // Rhythm over the last few minutes: beats looked at, irregular beats, rate per 1,000 beats.
  B.rhythm = function (winS = 600) {
    const since = Date.now() - winS * 1000;
    const w = B.beats.filter((b) => b.t >= since && (b.ok || b.ect));
    const irregular = w.filter((b) => b.ect).length;
    return { beats: w.length, irregular, perK: w.length ? (irregular / w.length) * 1000 : null };
  };
  // Today's running count (real Band only), saved as "irregular beats per 1,000" in today's log.
  const DAY_KEY = 'crewpulse-rhythm-day';
  let day = (() => { try { return JSON.parse(localStorage.getItem(DAY_KEY) || 'null'); } catch (e) { return null; } })();
  let lastDaySave = 0;
  function countDay(beats, irregular) {
    if (B.source === 'demo' || !Q.log) return;
    const k = Q.dateKey();
    if (!day || day.k !== k) day = { k, beats: 0, irregular: 0 };
    day.beats += beats; day.irregular += irregular;
    const now = Date.now();
    if (now - lastDaySave > 30000 || irregular) {
      lastDaySave = now;
      try { localStorage.setItem(DAY_KEY, JSON.stringify(day)); } catch (e) { /* ignore */ }
      if (day.beats >= 300) toLog({ ib: Math.round((day.irregular / day.beats) * 10000) / 10 }, true); // needs ~5 min of clean beats
    }
  }
  B.rhythmToday = () => (day && day.k === Q.dateKey() ? { ...day, perK: day.beats ? (day.irregular / day.beats) * 1000 : null } : null);

  function onHeart(p) {
    B.bpm = p.bpm;
    if (p.rr.length) { p.rr.forEach(addBeat); if (!B.status.leadsOff && (B.status.quality == null || B.status.quality >= 60)) countDay(p.rr.length, 0); }
    else if (p.bpm) addBeat(60000 / p.bpm); // strap without beat gaps: approximate (no rhythm check)
    checkCalibration();
    trackRecovery();
    emit('heart');
  }
  // Validation hook: feed beat gaps (ms) straight into the same pipeline (used by tools/validate-mitbih).
  B._feedRR = (rr) => onHeart({ bpm: Math.round(60000 / rr), rr: [rr] });
  function onStatus(s) { Object.assign(B.status, s, { at: Date.now() }); trackRecovery(); emit('status'); }
  // Real Band results go into today's log. Demo Band results never do.
  const toLog = (values, quiet) => { if (B.source === 'demo' || !Q.log) return; Q.log.record(values, { source: 'band' }); emit(quiet ? 'logged-quiet' : 'logged'); };
  function onReaction(r) {
    B.reaction = { ...r, at: Date.now() }; B.reactionRunning = false; emit('reaction');
    if (r.median > 0) toLog({ rt: Math.round(r.median) });
  }

  // ---------- live metrics ----------
  B.metrics = function (hrWin = 30, hrvWin = 60) {
    const now = Date.now();
    const inWin = (s) => B.beats.filter((b) => b.t >= now - s * 1000);
    const okHR = inWin(hrWin).filter((b) => b.ok);
    const hr = okHR.length >= 3 ? 60000 / (okHR.reduce((a, b) => a + b.rr, 0) / okHR.length) : null;
    const w = inWin(hrvWin);
    let sum = 0, n = 0;
    for (let i = 1; i < w.length; i++) if (w[i].ok && w[i - 1].ok) { const d = w[i].rr - w[i - 1].rr; sum += d * d; n++; }
    const rmssd = n >= 10 ? Math.sqrt(sum / n) : null;
    const q30 = inWin(30);
    let quality = q30.length ? Math.round((q30.filter((b) => b.ok || b.ect || b.post).length / q30.length) * 100) : null;
    if (B.status.leadsOff) quality = 0;
    if (B.status.quality != null && Date.now() - B.status.at < 30000 && quality != null) quality = Math.min(quality, B.status.quality);
    const stale = now - B.lastBeatAt > 5000;
    return { hr: stale ? null : hr, rmssd: stale ? null : rmssd, quality: stale ? 0 : quality, beats: okHR.length };
  };

  const ACTIVE = 300; // activity counts per 10 s above this = moving / exercising
  B.isActive = () => (B.status.activity != null && Date.now() - B.status.at < 25000 ? B.status.activity > ACTIVE || B.status.moving : null);

  // Heart recovery after activity — a known sign of fitness and strain.
  let wasActive = false;
  function trackRecovery() {
    const active = B.isActive();
    if (active) { wasActive = true; B.recovery = null; return; }
    if (active === false && wasActive) { wasActive = false; B.recovery = { since: Date.now(), done: false, secs: 0 }; }
    if (B.recovery && !B.recovery.done && B.baseline) {
      const m = B.metrics(15, 60);
      B.recovery.secs = Math.round((Date.now() - B.recovery.since) / 1000);
      if (m.hr && m.hr <= B.baseline.hr * 1.1) B.recovery.done = true;
    }
  }

  // Calm reading: sets the live baseline and (real Band only) saves resting HR + HRV to today's log.
  B.startCalibration = function (dur = 120) { B.calib = { start: Date.now(), dur }; emit('calib'); };
  B.cancelCalibration = function () { B.calib = null; emit('calib'); };
  function checkCalibration() {
    if (!B.calib) return;
    const el = (Date.now() - B.calib.start) / 1000;
    if (el < B.calib.dur) return;
    const m = B.metrics(B.calib.dur, B.calib.dur);
    if (!m.hr || !m.rmssd || (m.quality ?? 0) < 70) { B.calib = null; B.error = 'Baseline failed: signal too messy. Sit still and try again.'; emit('calib'); return; }
    B.baseline = { hr: Math.round(m.hr), rmssd: Math.round(m.rmssd), at: Date.now() };
    if (B.source !== 'demo') saveBase(B.baseline);
    B.calib = null; B.error = ''; emit('calib');
    const temp = B.status.temp != null && Date.now() - B.status.at < 30000 ? Math.round(B.status.temp * 10) / 10 : null;
    toLog(temp != null ? { rhr: B.baseline.hr, hrv: B.baseline.rmssd, temp } : { rhr: B.baseline.hr, hrv: B.baseline.rmssd });
  }
  B.calibProgress = () => (B.calib ? Math.min(1, (Date.now() - B.calib.start) / 1000 / B.calib.dur) : 0);
  B.clearBaseline = () => { B.baseline = null; saveBase(null); emit('calib'); };

  // Live "Heart" condition vs your calm baseline.
  B.live = function () {
    const m = B.metrics(30, 60);
    const active = B.isActive();
    if (!m.hr) return { m, ready: false, reason: B.state === 'live' ? 'Waiting for heartbeats…' : 'Band not connected' };
    if (!B.baseline) return { m, ready: false, reason: 'Set a 2-minute calm baseline first' };
    if ((m.quality ?? 100) < 60) return { m, ready: false, reason: 'Signal messy — hold still' };
    const b = B.baseline;
    const zHR = (m.hr - b.hr) / Math.max(3, b.hr * 0.06);
    const zHRV = m.rmssd ? (b.rmssd - m.rmssd) / Math.max(4, b.rmssd * 0.25) : 0;
    const score = 0.6 * Math.max(0, zHR) + 0.4 * Math.max(0, zHRV);
    return { m, ready: true, active, score, wx: Q.wxOf(score), zHR, zHRV, b };
  };

  // ---------- Bluetooth (real Band, or any standard heart-rate strap) ----------
  let bt = { device: null, control: null, retries: 0 };
  B.connectBluetooth = async function () {
    if (!navigator.bluetooth) throw new Error('This browser has no Bluetooth support. Use Chrome or Edge on a laptop or Android phone.');
    B.stop();
    setState('connecting', 'bluetooth');
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'CrewPulse' }, { services: ['heart_rate'] }],
        optionalServices: ['heart_rate', 'battery_service', UUID.service],
      });
      bt = { device, control: null, retries: 0 };
      B.name = device.name || 'Heart-rate device';
      device.addEventListener('gattserverdisconnected', onBtLost);
      await btSetup(device);
    } catch (e) {
      setState('off', null);
      if (e && e.name === 'NotFoundError') return; // user closed the picker
      throw e;
    }
  };
  async function btSetup(device) {
    const server = await device.gatt.connect();
    const hrS = await server.getPrimaryService('heart_rate');
    const hrC = await hrS.getCharacteristic('heart_rate_measurement');
    hrC.addEventListener('characteristicvaluechanged', (e) => onHeart(parseHeart(e.target.value)));
    await hrC.startNotifications();
    try { // CrewPulse extras (only on our Band)
      const cp = await server.getPrimaryService(UUID.service);
      const st = await cp.getCharacteristic(UUID.status);
      st.addEventListener('characteristicvaluechanged', (e) => onStatus(parseStatus(e.target.value)));
      await st.startNotifications();
      const rc = await cp.getCharacteristic(UUID.reaction);
      rc.addEventListener('characteristicvaluechanged', (e) => onReaction(parseReaction(e.target.value)));
      await rc.startNotifications();
      bt.control = await cp.getCharacteristic(UUID.control);
      const now = new DataView(new ArrayBuffer(5)); now.setUint8(0, CMD.setTime); now.setUint32(1, Math.floor(Date.now() / 1000), true);
      await bt.control.writeValue(now.buffer); // the Band has no clock
    } catch (e) { bt.control = null; } // a normal heart-rate strap: heart data only
    try {
      const bs = await server.getPrimaryService('battery_service');
      const bl = await bs.getCharacteristic('battery_level');
      B.status.battery = (await bl.readValue()).getUint8(0);
    } catch (e) { /* optional */ }
    bt.retries = 0;
    setState('live', 'bluetooth');
  }
  async function onBtLost() {
    if (B.source !== 'bluetooth' || !bt.device) return;
    setState('lost', 'bluetooth');
    while (bt.device && bt.retries < 6 && B.state === 'lost') {
      bt.retries++;
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** bt.retries)));
      try { await btSetup(bt.device); return; } catch (e) { /* try again */ }
    }
    if (B.state === 'lost') { B.error = 'Band out of range. Press Connect again.'; setState('off', null); }
  }

  // ---------- USB cable backup (Web Serial) ----------
  // Firmware prints lines:  HR,<bpm>,<rr ms>[,<rr ms>]  |  ST,<temp*100>,<activity>,<quality>,<flags>,<battery>  |  RT,<median>,<lapses>,<falseStarts>
  let usb = { port: null, reader: null, writer: null };
  B.connectUSB = async function () {
    if (!navigator.serial) throw new Error('This browser has no USB serial support. Use Chrome or Edge on a laptop.');
    B.stop();
    setState('connecting', 'usb');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      usb.port = port; B.name = 'Band (USB cable)';
      usb.writer = port.writable.getWriter();
      setState('live', 'usb');
      readUSB();
    } catch (e) { setState('off', null); if (e && e.name === 'NotFoundError') return; throw e; }
  };
  async function readUSB() {
    const dec = new TextDecoder(); let buf = '';
    try {
      usb.reader = usb.port.readable.getReader();
      for (;;) {
        const { value, done } = await usb.reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
      }
    } catch (e) { /* unplugged */ }
    if (B.source === 'usb') { B.error = 'USB cable disconnected.'; setState('off', null); }
  }
  function handleLine(line) {
    const p = line.split(',');
    if (p[0] === 'HR') onHeart({ bpm: +p[1], rr: p.slice(2).map(Number).filter((x) => x > 0) });
    else if (p[0] === 'ST') {
      const n = (s) => (s == null || s === '' ? null : +s); // empty field = sensor not fitted
      onStatus({ temp: n(p[1]) == null ? null : n(p[1]) / 100, activity: n(p[2]), quality: n(p[3]), leadsOff: !!(n(p[4]) & 1), moving: !!(n(p[4]) & 2), battery: n(p[5]) });
    }
    else if (p[0] === 'RT') onReaction({ median: +p[1], lapses: +p[2], falseStarts: +p[3] });
  }

  // ---------- Demo Band (simulator) ----------
  const sim = { timer: null, statusTimer: null, hr: 64, t: 0, exercise: false, exUntil: 0, temp: 33.7, stress: false, paced: false, ectopic: false, n: 0, comp: 0 };
  B.startDemo = function () {
    B.stop();
    B.name = 'Demo Band (simulated)';
    setState('live', 'demo');
    sim.hr = 64; sim.t = 0; sim.exercise = false; sim.stress = false; sim.paced = false; sim.ectopic = false; sim.n = 0; sim.comp = 0;
    const beat = () => {
      if (B.source !== 'demo') return;
      if (sim.exercise && Date.now() > sim.exUntil) sim.exercise = false;
      // simulated stress: faster, steadier heart; slow breathing: calmer heart, bigger breath-linked swings (period 10 s)
      const target = sim.exercise ? 128 : sim.stress && !sim.paced ? 88 : sim.paced ? 61 : 64;
      sim.hr += (target - sim.hr) * (sim.exercise ? 0.06 : 0.025) + (Math.random() - 0.5) * 0.6;
      const amp = sim.paced ? 70 : sim.stress ? 9 : Math.max(4, 42 - (sim.hr - 64) * 0.55); // breathing-linked variability, shrinks with effort
      let rr = 60000 / sim.hr + amp * Math.sin((2 * Math.PI * sim.t) / (sim.paced ? 10 : 4.3)) + (Math.random() - 0.5) * 10;
      // simulated early beat every ~5th beat, then a compensatory pause
      if (sim.comp) { rr = sim.comp; sim.comp = 0; }
      else if (sim.ectopic && ++sim.n % 5 === 0) { const base = rr; rr = base * 0.62; sim.comp = base * 2 - rr; }
      sim.t += rr / 1000;
      const dv = new DataView(new ArrayBuffer(4));
      dv.setUint8(0, 0x10); dv.setUint8(1, Math.round(60000 / rr)); dv.setUint16(2, Math.round((rr * 1024) / 1000), true);
      onHeart(parseHeart(dv)); // same parser as the real Band
      sim.timer = setTimeout(beat, rr);
    };
    beat();
    const status = () => {
      sim.temp += (33.8 - sim.temp) * 0.1 + (Math.random() - 0.5) * 0.05;
      const dv = new DataView(new ArrayBuffer(8));
      dv.setInt16(0, Math.round(sim.temp * 100), true);
      dv.setUint16(2, sim.exercise ? 900 + Math.round(Math.random() * 200) : Math.round(Math.random() * 40), true);
      dv.setUint8(4, 97); dv.setUint8(5, sim.exercise ? 2 : 0); dv.setUint8(6, 86);
      onStatus(parseStatus(dv));
    };
    status();
    sim.statusTimer = setInterval(status, 3000); // faster than the real 10 s so the demo reacts quickly
  };
  B.demoExercise = function (seconds = 60) { sim.exercise = true; sim.exUntil = Date.now() + seconds * 1000; emit('status'); };
  B.demoRest = function () { sim.exercise = false; emit('status'); };
  B.demoExercising = () => B.source === 'demo' && sim.exercise;
  B.demoStress = function (on) { sim.stress = !!on; emit('status'); };
  B.demoStressed = () => B.source === 'demo' && sim.stress;
  B.demoIrregular = function (on) { sim.ectopic = !!on; sim.n = 0; emit('status'); };
  B.demoIrregularOn = () => B.source === 'demo' && sim.ectopic;
  // Called by the breathing coach. Only the Demo Band reacts; a real heart reacts by itself.
  B.setPacedBreathing = function (on) { sim.paced = !!on; };

  // ---------- commands ----------
  B.startReaction = async function () {
    B.reactionRunning = true; emit('reaction');
    if (B.source === 'bluetooth' && bt.control) return bt.control.writeValue(new Uint8Array([CMD.reaction]));
    if (B.source === 'usb' && usb.writer) return usb.writer.write(new TextEncoder().encode('R\n'));
    if (B.source === 'demo') {
      setTimeout(() => {
        const dv = new DataView(new ArrayBuffer(4));
        dv.setUint16(0, 262 + Math.round(Math.random() * 40), true); dv.setUint8(2, Math.random() < 0.2 ? 1 : 0); dv.setUint8(3, 0);
        onReaction(parseReaction(dv));
      }, 6000); // shortened for the demo; the real test runs 1 minute on the Band
      return;
    }
    B.reactionRunning = false; emit('reaction');
    throw new Error('This device has no buzz test. Connect the CrewPulse Band.');
  };
  B.canReaction = () => B.state === 'live' && (B.source === 'demo' || B.source === 'usb' || (B.source === 'bluetooth' && !!bt.control));

  // ---------- stop / state ----------
  B.stop = function () {
    clearTimeout(sim.timer); clearInterval(sim.statusTimer);
    if (bt.device) { const d = bt.device; bt.device = null; try { d.removeEventListener('gattserverdisconnected', onBtLost); if (d.gatt.connected) d.gatt.disconnect(); } catch (e) { /* ignore */ } }
    if (usb.port) { const u = usb; usb = { port: null, reader: null, writer: null }; (async () => { try { await u.reader?.cancel(); u.writer?.releaseLock(); await u.port.close(); } catch (e) { /* ignore */ } })(); }
    B.beats = []; B.bpm = null; B.lastBeatAt = 0; B.calib = null; B.recovery = null; B.reactionRunning = false;
    B.status = { temp: null, activity: null, quality: null, battery: null, leadsOff: false, moving: false, at: 0 };
    if (B.state !== 'off') setState('off', null);
  };
  function setState(state, source) { B.state = state; B.source = source; if (state !== 'off') B.error = ''; emit('state'); }
})();
