/* CrewPulse — tiny SVG charts (no libraries, so it works offline). */
(function () {
  const Q = window.CP;

  Q.sparkline = function (vals, level) {
    const v = vals.filter((x) => x !== null);
    if (v.length < 2) return '';
    const w = 120, h = 32, p = 2;
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((y, i) => [p + (i * (w - 2 * p)) / (v.length - 1), h - p - ((y - lo) / span) * (h - 2 * p)]);
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
    const last = pts[pts.length - 1];
    return `<svg class="spark ${level}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5"/></svg>`;
  };

  // Condition mini chart: last 14 days (solid) + 3-day forecast (dashed). Gaps = days with no data.
  Q.condSpark = function (hist, proj, wx) {
    const pr = (proj || []).map((v) => (v == null ? null : v));
    const all = hist.concat(pr), w = 120, h = 36, p = 3;
    const known = all.filter((v) => v != null);
    if (!known.length) return `<svg class="cspark none" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line class="cs-th" x1="${p}" x2="${w - p}" y1="${h / 2}" y2="${h / 2}"/></svg>`;
    const hi = Math.max(4, ...known), n = all.length;
    const x = (i) => p + (i * (w - 2 * p)) / (n - 1), y = (v) => h - p - (Math.max(0, v) / hi) * (h - 2 * p);
    const line = (arr, off) => { let d = '', pen = false; arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i + off).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; }); return d; };
    let li = -1; for (let i = hist.length - 1; i >= 0; i--) if (hist[i] != null) { li = i; break; }
    const yr = y(2.2);
    return `<svg class="cspark ${wx}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <line class="cs-th" x1="${p}" x2="${w - p}" y1="${yr}" y2="${yr}"/>
      <path class="cs-h" d="${line(hist, 0)}"/>
      ${li >= 0 && pr.some((v) => v != null) ? `<path class="cs-f" d="M${x(li).toFixed(1)} ${y(hist[li]).toFixed(1)}${pr.map((v, k) => (v == null ? '' : 'L' + x(hist.length + k).toFixed(1) + ' ' + y(v).toFixed(1))).join('')}"/>` : ''}
      ${li >= 0 ? `<circle class="cs-now" cx="${x(li)}" cy="${y(hist[li])}" r="2.6"/>` : ''}</svg>`;
  };

  // Full trend chart with personal baseline band, event markers and forecast.
  Q.trendChart = function (m, series, analysis, range, proj) {
    if (proj && proj.some((v) => v == null)) proj = null;
    const F = proj ? proj.length : 0;
    const M = Q.METRICS[m];
    const start = Math.max(0, series.length - range);
    const idx = [];
    for (let i = start; i < series.length; i++) if (series[i] !== null) idx.push(i);
    const W = 760, H = 300, L = 48, R = 34, T = 18, B = 34;
    if (!idx.length) {
      // Empty state: a faint heartbeat trace with a pulse running along it, and dots for readings toward "your normal".
      const y0 = T + (H - T - B) * 0.42, beat = 120;
      let ecg = `M${L + 10} ${y0}`;
      for (let bx = L + 10; bx + beat <= W - R - 10; bx += beat) ecg += `h30l6 -6l6 6h8l4 8l7 -46l7 56l5 -18h9q7 -12 14 0h${beat - 96}`;
      const n = Math.min(analysis.readings || 0, Q.MIN_DAYS), need = !analysis.baseline.ready;
      const dots = need ? Array.from({ length: Q.MIN_DAYS }, (_, k) => `<circle class="nd-dot ${k < n ? 'on' : ''}" cx="${W / 2 + (k - (Q.MIN_DAYS - 1) / 2) * 22}" cy="${y0 + 92}" r="5"/>`).join('') +
        `<text class="ax" x="${W / 2}" y="${y0 + 116}" text-anchor="middle">${n} of ${Q.MIN_DAYS} readings to learn your normal</text>` : '';
      return `<svg class="trend empty" viewBox="0 0 ${W} ${H}" role="img" aria-label="No ${M.label} readings yet"><rect class="band" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
        <path class="idle-trace" d="${ecg}"/><path class="idle-pulse" pathLength="1" d="${ecg}"/>
        <text class="ax big" x="${W / 2}" y="${y0 + 66}" text-anchor="middle">No readings in this range yet</text>${dots}</svg>`;
    }
    const b = analysis.baseline.ready ? analysis.baseline : { mean: null };
    let band = null, line = null;
    if (b.mean != null && b.sd) band = [b.mean - 2 * b.sd, b.mean + 2 * b.sd];
    if (M.base === 'target' && b.mean != null) line = { y: 0.8 * b.mean, label: '80% of target' };
    if (M.base === 'pre' && b.mean != null) line = { y: b.mean * (1 + (M.dir === 'up' ? 1 : -1) * M.pct[0] / 100), label: M.pct[0] + '% change' };

    const vals = idx.map((i) => series[i]).concat(proj || []);
    const ext = vals.concat(band || [], line ? [line.y] : [], b.mean != null ? [b.mean] : []);
    let lo = Math.min(...ext), hi = Math.max(...ext);
    const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
    const x = (i) => L + ((i - start) / Math.max(1, series.length - 1 + F - start)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    let s = `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${M.label} trend over the last ${range} days">`;
    // grid
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(M.dec > 0 ? 1 : 0)}</text>`;
    }
    if (band) s += `<rect class="band" x="${L}" width="${W - L - R}" y="${y(band[1])}" height="${y(band[0]) - y(band[1])}"><title>Your normal range</title></rect>`;
    if (b.mean != null && true) s += `<line class="base" x1="${L}" x2="${W - R}" y1="${y(b.mean)}" y2="${y(b.mean)}"/>`;
    if (line) s += `<line class="thresh" x1="${L}" x2="${W - R}" y1="${y(line.y)}" y2="${y(line.y)}"/><text class="ax thresh-t" x="${W - R}" y="${y(line.y) - 5}" text-anchor="end">${line.label}</text>`;
    // data
    const d = idx.map((i, k) => (k ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(series[i]).toFixed(1)).join('');
    s += `<path class="data" pathLength="1" d="${d}"/>`;
    idx.forEach((i) => { s += `<circle class="fc-pt" cx="${x(i).toFixed(1)}" cy="${y(series[i]).toFixed(1)}" r="2.2"/>`; });
    // 3-day average
    const ma = idx.map((i) => { const w = series.slice(Math.max(start, i - 2), i + 1).filter((v) => v !== null); return [i, w.reduce((a, c) => a + c, 0) / w.length]; });
    s += `<path class="avg" pathLength="1" d="${ma.map((p, k) => (k ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('')}"/>`;
    if (F) {
      const n0 = idx[idx.length - 1], fx0 = x(series.length - 0.5);
      const ma0 = ma[ma.length - 1][1];
      const unc = (k) => (b.sd ? b.sd * 0.45 * k : Math.abs(proj[k - 1]) * 0.04 * k);
      const up = proj.map((v, k) => x(series.length + k).toFixed(1) + ' ' + y(v + unc(k + 1)).toFixed(1));
      const dn = proj.map((v, k) => x(series.length + k).toFixed(1) + ' ' + y(v - unc(k + 1)).toFixed(1)).reverse();
      s += `<rect class="fc-zone" x="${fx0}" y="${T}" width="${W - R - fx0}" height="${H - T - B}"/><text class="ax" x="${fx0 + 4}" y="${T + 10}">Forecast</text>`;
      s += `<path class="fc-cone" d="M${x(n0).toFixed(1)} ${y(ma0).toFixed(1)}L${up.join('L')}L${dn.join('L')}Z"/>`;
      s += `<path class="fc-line" d="M${x(n0).toFixed(1)} ${y(ma0).toFixed(1)}${proj.map((v, k) => 'L' + x(series.length + k).toFixed(1) + ' ' + y(v).toFixed(1)).join('')}"/>`;
      proj.forEach((v, k) => { s += `<circle class="fc-pt" cx="${x(series.length + k)}" cy="${y(v)}" r="3"/>`; });
    }
    const li = idx[idx.length - 1];
    s += `<circle class="last-ring ${analysis.level}" cx="${x(li)}" cy="${y(series[li])}" r="5"/><circle class="last ${analysis.level}" cx="${x(li)}" cy="${y(series[li])}" r="5"/>`;
    // x labels
    const step = Math.max(1, Math.round(range / 6));
    for (let i = series.length - 1 + F; i >= start; i -= step) s += `<text class="ax" x="${x(i)}" y="${H - 12}" text-anchor="middle">${Q.dayLabel(i)}</text>`;
    s += '</svg>';
    return s;
  };
})();
