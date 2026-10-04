// Info grafis (HTML -> PNG lewat Chrome headless) untuk dikirim ke Telegram.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COL = { risiko: '#c0392b', peluang: '#2f855a', netral: '#7a7f8c' };
const NAVY = '#1f2a44', GOLD = '#e0a72e', FONT = '"Liberation Sans",Arial,"DejaVu Sans",sans-serif';
const rp = n => 'Rp' + Math.round(n).toLocaleString('id-ID');
const short = n => n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace('.', ',') + ' jt' : n >= 1e3 ? Math.round(n / 1e3) + ' rb' : String(n);
const clamp = (n, a, b) => Math.min(b, Math.max(a, Math.round(+n) || a));
const SEK = { vape: 'Vape', infrastruktur: 'Kontraktor Infrastruktur', keduanya: 'Kedua sektor' };

const page = (w, h, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}body{width:${w}px;height:${h}px;overflow:hidden;background:#f4f1ea;font-family:${FONT};color:#25282f}table{border-collapse:collapse}</style></head><body>${body}</body></html>`;
const header = (t, s) => `<table style="width:100%;background:${NAVY}"><tr><td style="padding:22px 30px"><div style="font-size:13px;letter-spacing:3px;color:${GOLD}">${esc(s)}</div><div style="font-size:30px;font-weight:bold;color:#fff;margin-top:4px">${esc(t)}</div></td></tr></table>`;
const card = (title, inner, extra = '') => `<div style="background:#fff;border:1px solid #e3dfd2;padding:14px 16px;${extra}"><div style="font-size:15px;font-weight:bold;color:${NAVY};margin-bottom:8px">${esc(title)}</div>${inner}</div>`;
const kpi = (n, l, c) => `<td style="width:25%;padding:0 6px"><div style="background:#fff;border:1px solid #e3dfd2;border-top:6px solid ${c};padding:14px 8px;text-align:center"><div style="font-size:34px;font-weight:bold;color:${c}">${esc(n)}</div><div style="font-size:13px;color:#555;margin-top:2px">${esc(l)}</div></div></td>`;

function donut(parts, size = 190) {
  const r = 62, C = 2 * Math.PI * r, tot = parts.reduce((s, p) => s + p.value, 0);
  let off = 0, s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 160 160" font-family="Arial,sans-serif"><circle cx="80" cy="80" r="${r}" fill="none" stroke="#eceae3" stroke-width="26"/>`;
  if (tot) parts.forEach(p => { const len = p.value / tot * C; if (len > 0) s += `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${p.color}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`; off += len; });
  return s + `<text x="80" y="88" font-size="28" font-weight="bold" fill="${NAVY}" text-anchor="middle">${tot}</text></svg>`;
}
function hbars(rows, w = 440, color = GOLD, fmt = v => v) {
  const lw = 120, bw = w - lw - 90, rh = 34, max = Math.max(1, ...rows.map(r => r[1]));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${rows.length * rh + 4}" font-family="Arial,sans-serif">`;
  rows.forEach((r, k) => { const y = k * rh + 4, bwid = Math.max(3, r[1] / max * bw);
    s += `<text x="${lw - 8}" y="${y + 17}" font-size="13" fill="#333" text-anchor="end">${esc(String(r[0]).slice(0, 14))}</text><rect x="${lw}" y="${y + 3}" width="${bwid}" height="20" fill="${color}"/><text x="${lw + bwid + 6}" y="${y + 18}" font-size="12" fill="#333">${esc(fmt(r[1]))}</text>`; });
  return s + '</svg>';
}
function stacked(rows, w = 440) {
  const lw = 150, bw = w - lw - 10, rh = 32, max = Math.max(1, ...rows.map(r => r.risiko + r.peluang + r.netral));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${rows.length * rh + 4}" font-family="Arial,sans-serif">`;
  rows.forEach((r, k) => { const y = k * rh + 4; let x = lw;
    s += `<text x="${lw - 8}" y="${y + 17}" font-size="12" fill="#333" text-anchor="end">${esc(r.label)}</text>`;
    ['risiko', 'peluang', 'netral'].forEach(t => { const wd = r[t] / max * bw; if (!r[t]) return;
      s += `<rect x="${x}" y="${y}" width="${wd}" height="22" fill="${COL[t]}"/>${wd > 14 ? `<text x="${x + wd / 2}" y="${y + 16}" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">${r[t]}</text>` : ''}`; x += wd; });
    if (!(r.risiko + r.peluang + r.netral)) s += `<text x="${lw + 4}" y="${y + 16}" font-size="12" fill="#999">0</text>`; });
  return s + '</svg>';
}
function matrix(isu) {
  const ox = 52, oy = 14, c = 62, W = 380, H = 372;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Arial,sans-serif">`;
  for (let k = 1; k <= 5; k++) for (let d = 1; d <= 5; d++) { const sc = k * d;
    s += `<rect x="${ox + (k - 1) * c}" y="${oy + (5 - d) * c}" width="${c}" height="${c}" fill="${sc >= 16 ? '#f6d5d1' : sc >= 9 ? '#fbeccc' : '#eef0f3'}" stroke="#fff" stroke-width="2"/>`; }
  for (let i = 1; i <= 5; i++) s += `<text x="${ox + (i - .5) * c}" y="${oy + 5 * c + 16}" font-size="12" fill="#555" text-anchor="middle">${i}</text><text x="${ox - 10}" y="${oy + (5 - i + .5) * c + 4}" font-size="12" fill="#555" text-anchor="end">${i}</text>`;
  s += `<text x="${ox + 2.5 * c}" y="${H - 6}" font-size="12" font-weight="bold" fill="${NAVY}" text-anchor="middle">Kemungkinan terjadi</text><text transform="translate(13 ${oy + 2.5 * c}) rotate(-90)" font-size="12" font-weight="bold" fill="${NAVY}" text-anchor="middle">Dampak bisnis</text>`;
  const cells = {}; isu.forEach(i => (cells[i.kemungkinan + ',' + i.dampak] = cells[i.kemungkinan + ',' + i.dampak] || []).push(i));
  const offs = [[[0, 0]], [[-15, 0], [15, 0]], [[-15, -12], [15, -12], [0, 13]], [[-15, -12], [15, -12], [-15, 13], [15, 13]]];
  Object.values(cells).forEach(l => l.forEach((i, k) => { const o = offs[Math.min(l.length, 4) - 1][k % 4], cx = ox + (i.kemungkinan - .5) * c + o[0], cy = oy + (5 - i.dampak + .5) * c + o[1];
    s += `<circle cx="${cx}" cy="${cy}" r="12" fill="${COL[i.arah]}"/><text x="${cx}" y="${cy + 4}" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">${i.no}</text>`; }));
  return s + '</svg>';
}
const legend = `<span style="color:${COL.risiko}">&#9632;</span> Risiko &nbsp; <span style="color:${COL.peluang}">&#9632;</span> Peluang &nbsp; <span style="color:${COL.netral}">&#9632;</span> Netral`;

// d: {date, email:{urgent,penting,abaikan}, fin:{inM,outM,net,top,outWeek,count}, tasksOpen, tasksDone, issuesHigh}
function dashboardHtml(d) {
  const e = d.email, tot = e.urgent + e.penting + e.abaikan, f = d.fin;
  const flow = hbars([['Masuk', f.inM], ['Keluar', f.outM]], 440, GOLD, short).replace(/fill="#e0a72e"/, `fill="${COL.peluang}"`).replace(/fill="#e0a72e"/, `fill="${COL.risiko}"`);
  const body = header('Dashboard Harian', d.date.toUpperCase()) +
    `<table style="width:100%;margin:18px 0 0"><tr>${kpi(tot, 'Email baru', NAVY)}${kpi(e.urgent, 'Urgent hari ini', COL.risiko)}${kpi((f.net < 0 ? '-' : '') + short(Math.abs(f.net)), 'Selisih bulan ini', f.net < 0 ? COL.risiko : COL.peluang)}${kpi(d.tasksOpen, 'Tugas terbuka', GOLD)}</tr></table>` +
    `<table style="width:100%;margin-top:14px"><tr><td style="width:50%;padding:0 6px;vertical-align:top">${card('Prioritas Email', `<table><tr><td>${donut([{ value: e.urgent, color: COL.risiko }, { value: e.penting, color: GOLD }, { value: e.abaikan, color: '#b9bdc7' }])}</td><td style="padding-left:14px;font-size:14px;line-height:2"><span style="color:${COL.risiko}">&#9632;</span> Urgent: <b>${e.urgent}</b><br><span style="color:${GOLD}">&#9632;</span> Penting: <b>${e.penting}</b><br><span style="color:#b9bdc7">&#9632;</span> Abaikan: <b>${e.abaikan}</b></td></tr></table>`, 'height:230px')}</td>` +
    `<td style="padding:0 6px;vertical-align:top">${card('Arus Kas Bulan Ini', flow + `<div style="font-size:13px;color:#555;margin-top:6px">Pengeluaran 7 hari terakhir: <b>${rp(f.outWeek)}</b><br>Total: masuk ${rp(f.inM)}, keluar ${rp(f.outM)}</div>`, 'height:230px')}</td></tr></table>` +
    `<div style="padding:14px 6px 0">${card('Pengeluaran per Kategori (bulan ini)', f.top.length ? hbars(f.top, 880, GOLD, rp) : '<div style="color:#888;font-size:14px">Belum ada data. Kirim ke bot: keluar 25rb makan siang</div>', 'height:260px')}</div>` +
    `<div style="padding:12px 30px;font-size:12px;color:#888">Dibuat otomatis oleh asisten harian. Email dinilai dari pengirim dan subjek.</div>`;
  return page(1000, 900, body);
}

function industryHtml(a, meta) {
  const isu = a.isu.slice(0, 5), hi = a.isu.filter(i => i.arah === 'risiko' && i.dampak >= 4).length, op = a.isu.filter(i => i.arah === 'peluang').length;
  const cnt = (key, vals) => vals.map(([v, l]) => { const r = { label: l, risiko: 0, peluang: 0, netral: 0 }; a.isu.filter(i => i[key] === v).forEach(i => r[i.arah]++); return r; });
  const rows = isu.map(i => `<tr><td style="width:40px;vertical-align:top;padding:8px 0"><div style="width:28px;height:28px;line-height:28px;border-radius:14px;background:${COL[i.arah]};color:#fff;text-align:center;font-weight:bold;font-size:14px">${i.no}</div></td><td style="padding:8px 0;border-bottom:1px solid #eee;vertical-align:top"><div style="font-size:15px;font-weight:bold;color:${NAVY}">${esc(i.judul.slice(0, 90))}</div><div style="font-size:12px;color:#777;margin:2px 0">${esc(SEK[i.sektor])} | ${esc(i.jenis)} | ${esc(i.arah)} | ${esc(i.horizon)}</div><div style="font-size:13px;line-height:1.4">${esc(i.implikasi.slice(0, 150))}</div></td></tr>`).join('');
  const body = header('Politik & Regulasi: Vape dan Infrastruktur', 'INTELIJEN INDUSTRI | ' + meta.date.toUpperCase()) +
    `<div style="padding:14px 30px 0;font-size:14px;line-height:1.5">${esc(a.ringkasan.slice(0, 330))}</div>` +
    `<table style="width:100%;margin-top:12px"><tr>${kpi(a.isu.length, 'Isu relevan', NAVY)}${kpi(hi, 'Risiko tinggi', COL.risiko)}${kpi(op, 'Peluang', COL.peluang)}${kpi(meta.sources, 'Sumber dibaca', GOLD)}</tr></table>` +
    `<table style="width:100%;margin-top:12px"><tr><td style="width:46%;padding:0 6px;vertical-align:top">${card('Peta Prioritas Isu', matrix(a.isu) + `<div style="font-size:11px;color:#555;text-align:center">${legend}</div>`)}</td>` +
    `<td style="padding:0 6px;vertical-align:top">${card('Isu per Sektor', stacked(cnt('sektor', [['vape', 'Vape'], ['infrastruktur', 'Kontraktor Infra'], ['keduanya', 'Kedua sektor']])), 'margin-bottom:10px')}${card('Isu per Horizon Waktu', stacked(cnt('horizon', [['<3 bulan', '< 3 bulan'], ['3-12 bulan', '3-12 bulan'], ['>12 bulan', '> 12 bulan']])) + `<div style="font-size:11px;color:#555;margin-top:4px">${legend}</div>`)}</td></tr></table>` +
    `<div style="padding:12px 6px 0">${card('Isu Teratas', `<table style="width:100%">${rows || '<tr><td>Tidak ada isu relevan.</td></tr>'}</table>`)}</div>`;
  return page(1000, 1120, body);
}

function normalize(a) {
  const isu = (a.isu || []).map(i => ({ judul: i.judul || '-', sektor: ['vape', 'infrastruktur', 'keduanya'].includes(i.sektor) ? i.sektor : 'keduanya', jenis: i.jenis || 'regulasi',
    dampak: clamp(i.dampak, 1, 5), kemungkinan: clamp(i.kemungkinan, 1, 5), arah: ['risiko', 'peluang', 'netral'].includes(i.arah) ? i.arah : 'netral',
    horizon: ['<3 bulan', '3-12 bulan', '>12 bulan'].includes(i.horizon) ? i.horizon : '3-12 bulan', apa: i.apa_terjadi || '', implikasi: i.implikasi || '', aksi: i.aksi || '', ref: (i.ref || []).map(Number).filter(Boolean) }))
    .sort((x, y) => y.dampak * y.kemungkinan - x.dampak * x.kemungkinan).slice(0, 8);
  isu.forEach((x, k) => x.no = k + 1);
  return { ringkasan: a.ringkasan_eksekutif || '', isu, skenario: a.skenario || {}, watchlist: a.watchlist || [], rekomendasi: a.rekomendasi || [] };
}
module.exports = { dashboardHtml, industryHtml, normalize };
