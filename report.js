// Pembuat HTML laporan eksekutif (dicetak jadi PDF oleh Chrome). CSS sengaja sederhana agar stabil.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COL = { risiko: '#c0392b', peluang: '#2f855a', netral: '#7a7f8c' };
const NAVY = '#1f2a44', GOLD = '#e0a72e';
const clamp = (n, a, b) => Math.min(b, Math.max(a, Math.round(+n) || a));
const SEK = { vape: 'Vape', infrastruktur: 'Kontraktor Infrastruktur', keduanya: 'Kedua sektor' };

function normalize(a) {
  const isu = (a.isu || []).map(i => ({
    judul: i.judul || '-',
    sektor: ['vape', 'infrastruktur', 'keduanya'].includes(i.sektor) ? i.sektor : 'keduanya',
    jenis: i.jenis || 'regulasi',
    dampak: clamp(i.dampak, 1, 5), kemungkinan: clamp(i.kemungkinan, 1, 5),
    arah: ['risiko', 'peluang', 'netral'].includes(i.arah) ? i.arah : 'netral',
    horizon: ['<3 bulan', '3-12 bulan', '>12 bulan'].includes(i.horizon) ? i.horizon : '3-12 bulan',
    apa: i.apa_terjadi || i.apa || '', implikasi: i.implikasi || '', aksi: i.aksi || '',
    ref: (i.ref || []).map(Number).filter(Boolean)
  })).sort((x, y) => y.dampak * y.kemungkinan - x.dampak * x.kemungkinan).slice(0, 8);
  isu.forEach((x, k) => x.no = k + 1);
  return { ringkasan: a.ringkasan_eksekutif || '', isu, skenario: a.skenario || {}, watchlist: a.watchlist || [], rekomendasi: a.rekomendasi || [] };
}

function matrixSvg(isu) {
  const ox = 52, oy = 16, c = 68, W = 430, H = 400;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif">`;
  for (let k = 1; k <= 5; k++) for (let d = 1; d <= 5; d++) {
    const sc = k * d, fill = sc >= 16 ? '#f6d5d1' : sc >= 9 ? '#fbeccc' : '#eef0f3';
    s += `<rect x="${ox + (k - 1) * c}" y="${oy + (5 - d) * c}" width="${c}" height="${c}" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`;
  }
  for (let i = 1; i <= 5; i++) {
    s += `<text x="${ox + (i - 0.5) * c}" y="${oy + 5 * c + 16}" font-size="11" fill="#555" text-anchor="middle">${i}</text>`;
    s += `<text x="${ox - 10}" y="${oy + (5 - i + 0.5) * c + 4}" font-size="11" fill="#555" text-anchor="end">${i}</text>`;
  }
  s += `<text x="${ox + 2.5 * c}" y="${H - 8}" font-size="12" fill="${NAVY}" font-weight="bold" text-anchor="middle">Kemungkinan terjadi</text>`;
  s += `<text transform="translate(14 ${oy + 2.5 * c}) rotate(-90)" font-size="12" fill="${NAVY}" font-weight="bold" text-anchor="middle">Dampak bisnis</text>`;
  const cells = {};
  isu.forEach(i => { const key = i.kemungkinan + ',' + i.dampak; (cells[key] = cells[key] || []).push(i); });
  const offs = { 1: [[0, 0]], 2: [[-16, 0], [16, 0]], 3: [[-16, -13], [16, -13], [0, 14]], 4: [[-16, -13], [16, -13], [-16, 14], [16, 14]] };
  Object.values(cells).forEach(list => list.forEach((i, idx) => {
    const o = (offs[Math.min(list.length, 4)] || offs[4])[idx % 4];
    const cx = ox + (i.kemungkinan - 0.5) * c + o[0], cy = oy + (5 - i.dampak + 0.5) * c + o[1];
    s += `<circle cx="${cx}" cy="${cy}" r="13" fill="${COL[i.arah]}"/><text x="${cx}" y="${cy + 4}" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">${i.no}</text>`;
  }));
  return s + '</svg>';
}

function barsSvg(rows) {
  const W = 430, lw = 150, bw = 230, rh = 30, H = rows.length * rh + 6;
  const max = Math.max(1, ...rows.map(r => r.risiko + r.peluang + r.netral));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif">`;
  rows.forEach((r, k) => {
    const y = k * rh + 4; let x = lw;
    s += `<text x="${lw - 8}" y="${y + 16}" font-size="11" fill="#333" text-anchor="end">${esc(r.label)}</text>`;
    ['risiko', 'peluang', 'netral'].forEach(t => {
      const w = r[t] / max * bw; if (!r[t]) return;
      s += `<rect x="${x}" y="${y}" width="${w}" height="20" fill="${COL[t]}"/>`;
      if (w > 14) s += `<text x="${x + w / 2}" y="${y + 14}" font-size="11" fill="#fff" font-weight="bold" text-anchor="middle">${r[t]}</text>`;
      x += w;
    });
    if (!(r.risiko + r.peluang + r.netral)) s += `<text x="${lw + 4}" y="${y + 14}" font-size="11" fill="#999">0</text>`;
  });
  return s + '</svg>';
}

const countBy = (isu, key, vals) => vals.map(([v, label]) => {
  const r = { label, risiko: 0, peluang: 0, netral: 0 };
  isu.filter(i => i[key] === v).forEach(i => r[i.arah]++); return r;
});
const lst = a => (a || []).length ? '<ul style="margin:4px 0 0 18px;padding:0">' + a.map(x => `<li style="margin-bottom:4px">${esc(x)}</li>`).join('') + '</ul>' : '<div style="color:#888">-</div>';
const badge = (t, bg) => `<span style="display:inline-block;background:${bg};color:#fff;font-size:10px;padding:2px 8px;border-radius:9px;margin-right:4px">${esc(t)}</span>`;

function buildReportHtml(raw, sources, meta) {
  const a = normalize(raw), isu = a.isu;
  const hi = isu.filter(i => i.arah === 'risiko' && i.dampak >= 4).length;
  const op = isu.filter(i => i.arah === 'peluang').length;
  const kpi = (n, l, c) => `<td style="width:25%;padding:0 4px"><div style="background:#fff;border:1px solid #e3dfd2;border-top:4px solid ${c};padding:10px 6px;text-align:center"><div style="font-size:26px;font-weight:bold;color:${c}">${n}</div><div style="font-size:10px;color:#555">${l}</div></div></td>`;
  const srcLink = n => { const s = sources[n - 1]; return s ? `<div style="font-size:10px;color:#555;margin-top:2px">[${n}] <a href="${esc(s.link)}" style="color:#1f4e8c">${esc(s.title.slice(0, 95))}</a> <span style="color:#999">(${esc(s.src)})</span></div>` : ''; };
  const cards = isu.map(i => `
  <div style="border:1px solid #e3dfd2;border-left:6px solid ${COL[i.arah]};background:#fff;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid">
    <div style="font-size:13px;font-weight:bold;color:${NAVY}"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:${COL[i.arah]};color:#fff;text-align:center;font-size:11px;margin-right:6px">${i.no}</span>${esc(i.judul)}</div>
    <div style="margin:6px 0">${badge(SEK[i.sektor], NAVY)}${badge(i.jenis, '#5b6b8c')}${badge(i.arah, COL[i.arah])}${badge('horizon ' + i.horizon, '#8a6d1d')}${badge('skor ' + i.dampak * i.kemungkinan + '/25', '#444')}</div>
    <div style="font-size:11px;line-height:1.5"><b>Apa yang terjadi.</b> ${esc(i.apa)}</div>
    <div style="font-size:11px;line-height:1.5;margin-top:4px"><b>Implikasi bisnis.</b> ${esc(i.implikasi)}</div>
    <div style="font-size:11px;line-height:1.5;margin-top:4px;background:#f7f5f0;padding:5px 7px"><b>Aksi disarankan.</b> ${esc(i.aksi)}</div>
    ${i.ref.slice(0, 3).map(srcLink).join('')}
  </div>`).join('') || '<p>Tidak ada isu relevan yang teridentifikasi pada periode ini.</p>';
  const srcList = sources.map((s, k) => `<tr><td style="width:26px;color:#888;vertical-align:top">${k + 1}</td><td style="padding-bottom:3px"><span style="color:${s.kind === 'video' ? '#c0392b' : '#1f4e8c'};font-weight:bold">${s.kind === 'video' ? 'VIDEO' : 'BERITA'}</span> <a href="${esc(s.link)}" style="color:#222;text-decoration:none">${esc(s.title.slice(0, 120))}</a> <span style="color:#888">- ${esc(s.src)}${s.date ? ', ' + esc(s.date) : ''}</span></td></tr>`).join('');
  const legend = `<span style="color:${COL.risiko}">&#9632;</span> Risiko &nbsp; <span style="color:${COL.peluang}">&#9632;</span> Peluang &nbsp; <span style="color:${COL.netral}">&#9632;</span> Netral`;

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Executive Summary</title>
<style>@page{size:A4;margin:12mm}body{margin:0;font-family:"Liberation Sans",Arial,"DejaVu Sans",sans-serif;color:#25282f;background:#f7f5f0;font-size:12px}
h2{font-size:15px;color:${NAVY};margin:18px 0 8px;border-bottom:2px solid ${GOLD};padding-bottom:4px;page-break-after:avoid}a{word-break:break-all}table{border-collapse:collapse}</style></head><body>
<table style="width:100%;background:${NAVY};color:#fff"><tr><td style="padding:18px 20px">
<div style="font-size:11px;letter-spacing:2px;color:${GOLD}">EXECUTIVE SUMMARY</div>
<div style="font-size:22px;font-weight:bold;margin:4px 0">Politik &amp; Regulasi: Industri Vape dan Kontraktor Infrastruktur</div>
<div style="font-size:11px;color:#cfd3dc">${esc(meta.date)} &nbsp;|&nbsp; Cakupan: ${esc(meta.period)} &nbsp;|&nbsp; ${sources.length} sumber (berita &amp; YouTube)</div></td></tr></table>

<h2>1. Ringkasan Eksekutif</h2>
<div style="background:#fff;border:1px solid #e3dfd2;padding:12px;font-size:12px;line-height:1.6">${esc(a.ringkasan) || 'Tidak ada ringkasan.'}</div>
<table style="width:100%;margin-top:10px"><tr>${kpi(isu.length, 'Isu relevan', NAVY)}${kpi(hi, 'Risiko tinggi', COL.risiko)}${kpi(op, 'Peluang', COL.peluang)}${kpi(sources.length, 'Sumber dianalisis', GOLD)}</tr></table>

<h2>2. Peta Prioritas dan Sebaran Isu</h2>
<table style="width:100%"><tr><td style="width:55%;vertical-align:top;text-align:center;background:#fff;border:1px solid #e3dfd2;padding:8px">
<div style="font-size:11px;font-weight:bold;color:${NAVY}">Matriks Dampak vs Kemungkinan</div>${matrixSvg(isu)}<div style="font-size:10px;color:#555">Angka mengacu ke nomor isu pada bagian 3. ${legend}</div></td>
<td style="vertical-align:top;padding-left:10px"><div style="background:#fff;border:1px solid #e3dfd2;padding:8px;margin-bottom:8px;text-align:center"><div style="font-size:11px;font-weight:bold;color:${NAVY}">Isu per Sektor</div>${barsSvg(countBy(isu, 'sektor', [['vape', 'Vape'], ['infrastruktur', 'Kontraktor Infrastruktur'], ['keduanya', 'Kedua sektor']]))}<div style="font-size:10px;color:#555">${legend}</div></div>
<div style="background:#fff;border:1px solid #e3dfd2;padding:8px;text-align:center"><div style="font-size:11px;font-weight:bold;color:${NAVY}">Isu per Horizon Waktu</div>${barsSvg(countBy(isu, 'horizon', [['<3 bulan', '< 3 bulan'], ['3-12 bulan', '3-12 bulan'], ['>12 bulan', '> 12 bulan']]))}<div style="font-size:10px;color:#555">${legend}</div></div></td></tr></table>

<h2 style="page-break-before:always">3. Rincian Analisis per Isu</h2>${cards}

<h2>4. Skenario, Rekomendasi, dan Pantauan</h2>
<table style="width:100%"><tr>
<td style="width:50%;vertical-align:top;padding-right:6px"><div style="background:#fff;border:1px solid #e3dfd2;padding:10px;font-size:11px;line-height:1.5"><b style="color:${NAVY}">Skenario Vape</b><div>${esc(a.skenario.vape || '-')}</div><br><b style="color:${NAVY}">Skenario Kontraktor Infrastruktur</b><div>${esc(a.skenario.infrastruktur || '-')}</div></div></td>
<td style="vertical-align:top;padding-left:6px"><div style="background:#fff;border:1px solid #e3dfd2;padding:10px;font-size:11px;line-height:1.5"><b style="color:${NAVY}">Rekomendasi Strategis</b>${lst(a.rekomendasi)}<br><b style="color:${NAVY}">Pantauan (Watchlist)</b>${lst(a.watchlist)}</div></td></tr></table>

<h2 style="page-break-before:always">5. Daftar Sumber</h2><table style="width:100%;font-size:10px">${srcList}</table>
<p style="font-size:9px;color:#777;margin-top:16px;border-top:1px solid #ddd;padding-top:6px">Catatan metodologi: analisis disusun otomatis oleh AI dari judul, cuplikan, dan metadata berita serta video YouTube, bukan dari isi lengkapnya. Skor dampak dan kemungkinan adalah penilaian relatif. Dokumen ini bukan nasihat hukum, pajak, atau keuangan. Verifikasi aturan pada sumber resmi (JDIH, Kemenkeu, DJBC, Kementerian PU) sebelum mengambil keputusan.</p>
</body></html>`;
}
module.exports = { buildReportHtml, normalize };
