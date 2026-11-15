// Validate CrewPulse's irregular-beat detector on the MIT-BIH Arrhythmia Database (PhysioNet).
// It runs the app's own js/band.js (not a copy) and feeds it the beat-to-beat gaps from the
// cardiologist beat labels, then compares what the app flags with what the cardiologists labelled.
//
// What this tests: the rhythm logic (early beat + compensatory pause), given correct beat times.
// What it does NOT test: the Band's own heartbeat detection on a real, noisy chest signal.
//
// Usage:  node validate.mjs [dataDir]      (downloads the 48 small .atr label files if missing)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAND_JS = path.resolve(HERE, '../../astro-health/js/band.js');
const DATA = path.resolve(process.argv[2] || path.join(HERE, 'data'));
const FS_HZ = 360;
const ALL = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 111, 112, 113, 114, 115, 116, 117, 118, 119, 121, 122, 123, 124,
  200, 201, 202, 203, 205, 207, 208, 209, 210, 212, 213, 214, 215, 217, 219, 220, 221, 222, 223, 228, 230, 231, 232, 233, 234];
const PACED = [102, 104, 107, 217]; // excluded, as in the AAMI EC57 standard
const RECORDS = ALL.filter((r) => !PACED.includes(r));

// MIT annotation codes → AAMI classes
const CLASS = { 1: 'N', 2: 'N', 3: 'N', 11: 'N', 34: 'N', 25: 'N', 4: 'S', 7: 'S', 8: 'S', 9: 'S', 35: 'S', 5: 'V', 10: 'V', 41: 'V', 6: 'F', 12: 'Q', 13: 'Q', 38: 'Q' };

async function ensureData() {
  fs.mkdirSync(DATA, { recursive: true });
  for (const r of RECORDS) {
    const f = path.join(DATA, `${r}.atr`);
    if (fs.existsSync(f) && fs.statSync(f).size > 0) continue;
    const res = await fetch(`https://physionet.org/files/mitdb/1.0.0/${r}.atr`);
    if (!res.ok) throw new Error(`download ${r}.atr failed: ${res.status}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
}

// MIT format annotation reader: 16-bit words, code = top 6 bits, time step = low 10 bits.
function readAtr(file) {
  const b = fs.readFileSync(file);
  const out = [];
  let t = 0, i = 0;
  while (i + 1 < b.length) {
    const w = b.readUInt16LE(i); i += 2;
    const code = w >> 10, val = w & 0x3ff;
    if (code === 0 && val === 0) break;
    if (code === 59) { // SKIP: 32-bit interval, high word first
      const hi = b.readUInt16LE(i), lo = b.readUInt16LE(i + 2); i += 4;
      t += ((hi << 16) | lo) | 0; continue;
    }
    if (code === 60 || code === 61 || code === 62) continue; // NUM / SUB / CHN
    if (code === 63) { i += val + (val & 1); continue; } // AUX string
    t += val;
    if (CLASS[code]) out.push({ t, cls: CLASS[code] });
  }
  return out;
}

// Fresh copy of the app's band.js for each record, with a controllable clock.
function freshBand() {
  let now = 0;
  class FakeDate extends Date { static now() { return now; } }
  const ctx = { window: { CP: {} }, localStorage: { getItem: () => null, setItem() {} }, navigator: {}, console, setTimeout, clearTimeout, setInterval, clearInterval, Date: FakeDate, Math, JSON, Array, Object, Number, String, Set, Map, Promise, DataView, ArrayBuffer, Uint8Array };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(BAND_JS, 'utf8'), ctx, { filename: 'band.js' });
  return { B: ctx.window.CP.band, setNow: (ms) => { now = ms; } };
}

function runRecord(r) {
  const beats = readAtr(path.join(DATA, `${r}.atr`));
  const { B, setNow } = freshBand();
  const flagged = new Set();
  let cur = -1;
  B.on((type) => { if (type === 'irregular') flagged.add(cur - 1); });
  for (let k = 1; k < beats.length; k++) {
    cur = k;
    const rr = ((beats[k].t - beats[k - 1].t) / FS_HZ) * 1000;
    setNow(Math.round((beats[k].t / FS_HZ) * 1000));
    B._feedRR(rr);
  }
  const c = { r, beats: beats.length, N: 0, S: 0, V: 0, F: 0, Q: 0, tpS: 0, tpV: 0, fpN: 0, flagF: 0, flagQ: 0, flags: flagged.size };
  beats.forEach((b, k) => { c[b.cls]++; if (!flagged.has(k)) return;
    if (b.cls === 'S') c.tpS++; else if (b.cls === 'V') c.tpV++; else if (b.cls === 'N') c.fpN++; else if (b.cls === 'F') c.flagF++; else c.flagQ++; });
  return c;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
function pearson(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sx * sy); }
const ranks = (a) => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length);
  for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };

await ensureData();
const rows = RECORDS.map(runRecord);
const T = rows.reduce((a, c) => { for (const k of Object.keys(c)) if (k !== 'r') a[k] = (a[k] || 0) + c[k]; return a; }, {});
const tp = T.tpS + T.tpV, ect = T.S + T.V, judged = tp + T.fpN; // F and Q flags are neither right nor wrong (AAMI style)
const hours = RECORDS.length * (650000 / FS_HZ / 3600);
const trueRate = rows.map((c) => (1000 * (c.S + c.V)) / c.beats), detRate = rows.map((c) => (1000 * (c.tpS + c.tpV + c.fpN + c.flagF + c.flagQ)) / c.beats);

const result = {
  records: RECORDS.length, hours: +hours.toFixed(1), beats: T.beats,
  ectopic: { total: ect, sensitivity: pct(tp, ect), precision: pct(tp, judged) },
  ventricular: { total: T.V, caught: T.tpV, sensitivity: pct(T.tpV, T.V) },
  supraventricular: { total: T.S, caught: T.tpS, sensitivity: pct(T.tpS, T.S) },
  falseAlarms: { onNormalBeats: T.fpN, perHour: +(T.fpN / hours).toFixed(1), perThousandNormal: +((1000 * T.fpN) / T.N).toFixed(2) },
  flagsOnFusionOrUnknown: T.flagF + T.flagQ,
  rateAgreement: { pearson: +pearson(trueRate, detRate).toFixed(3), spearman: +pearson(ranks(trueRate), ranks(detRate)).toFixed(3) },
};
console.log(JSON.stringify(result, null, 2));
console.log('\nrecord  beats   V    S   caughtV caughtS falseN  trueRate detRate (per 1000)');
for (let i = 0; i < rows.length; i++) { const c = rows[i];
  console.log(`${c.r}  ${String(c.beats).padStart(6)} ${String(c.V).padStart(4)} ${String(c.S).padStart(4)} ${String(c.tpV).padStart(7)} ${String(c.tpS).padStart(7)} ${String(c.fpN).padStart(6)}  ${trueRate[i].toFixed(1).padStart(8)} ${detRate[i].toFixed(1).padStart(7)}`); }
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify({ result, rows: rows.map((c, i) => ({ ...c, trueRate: +trueRate[i].toFixed(2), detRate: +detRate[i].toFixed(2) })) }, null, 2));
