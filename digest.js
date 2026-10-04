// Asisten harian -> Telegram: email, keuangan, berita, rencana. Node 20+.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ig = require('./infographic.js');
const E = process.env;
for (const k of Object.keys(E)) if (typeof E[k] === 'string') E[k] = E[k].trim();
const LLM = E.LLM || 'gemini';
const FULL = !E.SCHEDULE || E.SCHEDULE === '0 0 * * *'; // jalan pagi = laporan penuh; jalan sore = catat saja
const STATE_FILE = 'state.json';

// ---------- data ----------
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { offset: 0, tx: [], tasks: [], nextTask: 1 }; } };
const saveState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
const rp = n => 'Rp' + Math.round(n).toLocaleString('id-ID');
const wibDate = ts => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD

// ---------- perintah dari Telegram ----------
function parseAmount(tok) {
  const m = String(tok || '').toLowerCase().match(/^([\d.,]+)(rb|ribu|k|jt|juta)?$/);
  if (!m) return null;
  let n;
  if (m[2]) { n = parseFloat(m[1].replace(',', '.')); n *= /^(jt|juta)$/.test(m[2]) ? 1e6 : 1e3; }
  else n = parseInt(m[1].replace(/[.,]/g, ''), 10);
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}
function parseCmd(text) {
  const t = String(text || '').trim(); let m;
  if ((m = t.match(/^(masuk|keluar)\s+(\S+)\s*(.*)$/i))) {
    const a = parseAmount(m[2]);
    if (!a) return { err: 'Nominal tidak terbaca: ' + m[2] };
    return { type: 'tx', dir: m[1].toLowerCase() === 'masuk' ? 'in' : 'out', amount: a, note: m[3] || '-' };
  }
  if ((m = t.match(/^tugas\s+(.+)$/i))) return { type: 'task', text: m[1] };
  if ((m = t.match(/^selesai\s+(\d+)$/i))) return { type: 'done', id: +m[1] };
  if (/^batal$/i.test(t)) return { type: 'undo' };
  return null;
}
function applyCmd(st, c, ts) {
  if (c.err) return c.err;
  if (c.type === 'tx') {
    const cat = (c.note.split(/\s+/)[0] || 'lainnya').toLowerCase();
    st.tx.push({ d: wibDate(ts), dir: c.dir, a: c.amount, note: c.note, cat });
    return `${c.dir === 'in' ? 'Masuk' : 'Keluar'} ${rp(c.amount)} (${c.note})`;
  }
  if (c.type === 'task') { st.tasks.push({ id: st.nextTask, t: c.text, done: false }); return `Tugas #${st.nextTask++}: ${c.text}`; }
  if (c.type === 'done') { const t = st.tasks.find(x => x.id === c.id); if (!t) return `Tugas #${c.id} tidak ditemukan`; t.done = true; return `Selesai: #${t.id} ${t.t}`; }
  if (c.type === 'undo') { const x = st.tx.pop(); return x ? `Dibatalkan: ${x.dir === 'in' ? 'masuk' : 'keluar'} ${rp(x.a)} (${x.note})` : 'Tidak ada transaksi untuk dibatalkan'; }
}
async function pollTelegram(st) {
  const r = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${st.offset || 0}&timeout=0`);
  const j = await r.json();
  if (!j.ok) throw new Error('getUpdates: ' + JSON.stringify(j).slice(0, 200));
  const log = [];
  for (const u of j.result) {
    st.offset = u.update_id + 1;
    const m = u.message;
    if (!m?.text || String(m.chat.id) !== String(E.TELEGRAM_CHAT_ID)) continue;
    const c = parseCmd(m.text);
    if (c) { const l = applyCmd(st, c, m.date * 1000); if (l) log.push(l); }
  }
  return log;
}

// ---------- ringkasan keuangan ----------
function financeStats(st, now = Date.now()) {
  const today = wibDate(now), month = today.slice(0, 7);
  const week = wibDate(now - 6 * 864e5);
  const mt = st.tx.filter(t => t.d.startsWith(month));
  const sum = (arr, dir) => arr.filter(t => t.dir === dir).reduce((s, t) => s + t.a, 0);
  const cats = {};
  mt.filter(t => t.dir === 'out').forEach(t => cats[t.cat] = (cats[t.cat] || 0) + t.a);
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const wk = st.tx.filter(t => t.d >= week);
  const inM = sum(mt, 'in'), outM = sum(mt, 'out');
  return { month, inM, outM, net: inM - outM, outWeek: sum(wk, 'out'), top, count: mt.length };
}
function financeText(f) {
  if (!f.count) return 'Belum ada transaksi bulan ini. Kirim ke bot: "keluar 25rb makan siang" atau "masuk 5jt gaji".';
  return `Bulan ${f.month}: masuk ${rp(f.inM)}, keluar ${rp(f.outM)}, selisih ${rp(f.net)}.\nPengeluaran 7 hari terakhir: ${rp(f.outWeek)}.\nKategori terbesar: ${f.top.map(([k, v]) => `${k} ${rp(v)}`).join(', ') || '-'}.`;
}

// ---------- email (IMAP + App Password) ----------
async function fetchEmails() {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: E.GMAIL_USER, pass: (E.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') } });
  await client.connect();
  const out = [];
  const lock = await client.getMailboxLock('INBOX');
  try {
    let uids;
    try { uids = await client.search({ gmraw: E.GMAIL_QUERY || 'is:unread newer_than:1d -category:promotions -category:social' }, { uid: true }); }
    catch { uids = await client.search({ seen: false, since: new Date(Date.now() - 864e5) }, { uid: true }); }
    uids = (uids || []).slice(-30);
    if (uids.length) for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
      const f = m.envelope.from?.[0];
      out.push(`Dari: ${f?.name || ''} <${f?.address || ''}> | Subjek: ${m.envelope.subject || '(tanpa subjek)'}`);
    }
  } finally { lock.release(); }
  await client.logout();
  return out;
}

// ---------- sumber industri: Google News RSS + YouTube ----------
const dec = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const VAPE = (E.VAPE_TOPICS || 'regulasi rokok elektrik vape|cukai rokok elektrik vape|larangan penjualan vape pemerintah|aturan turunan PP 28 2024 rokok elektronik|Bea Cukai vape likuid').split('|');
const INFRA = (E.INFRA_TOPICS || 'anggaran infrastruktur Kementerian PU|regulasi jasa konstruksi kontraktor|kebijakan pengadaan proyek pemerintah tender|proyek strategis nasional pembayaran kontraktor|kebijakan BUMN karya|IKN anggaran pembangunan').split('|');
const YT = (E.YT_QUERIES || 'regulasi cukai vape rokok elektrik|kebijakan anggaran infrastruktur kontraktor|politik regulasi jasa konstruksi').split('|');
async function fetchNews() {
  const out = [];
  for (const q of [...VAPE, ...INFRA]) {
    try {
      const x = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=id&gl=ID&ceid=ID:id`)).text();
      for (const it of [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6)) {
        const g = re => dec((it[1].match(re) || [])[1]);
        const title = g(/<title>([\s\S]*?)<\/title>/); if (!title) continue;
        out.push({ kind: 'berita', title, src: g(/<source[^>]*>([\s\S]*?)<\/source>/) || 'Google News', link: g(/<link>([\s\S]*?)<\/link>/), date: g(/<pubDate>([\s\S]*?)<\/pubDate>/).slice(5, 16) });
      }
    } catch {}
  }
  const seen = new Set();
  return out.filter(i => !seen.has(i.title) && seen.add(i.title)).slice(0, 55);
}
async function fetchYoutube() {
  if (!E.YOUTUBE_API_KEY) return [];
  const out = [], after = new Date(Date.now() - 7 * 864e5).toISOString();
  for (const q of YT) {
    try {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=7&regionCode=ID&relevanceLanguage=id&publishedAfter=${after}&q=${encodeURIComponent(q)}&key=${E.YOUTUBE_API_KEY}`)).json();
      if (j.error) throw new Error(j.error.message);
      for (const v of j.items || []) out.push({ kind: 'video', title: dec(v.snippet.title), src: dec(v.snippet.channelTitle), link: 'https://www.youtube.com/watch?v=' + v.id.videoId, date: v.snippet.publishedAt.slice(0, 10), desc: dec(v.snippet.description).slice(0, 160) });
    } catch (e) { console.log('YouTube gagal:', e.message); }
  }
  const seen = new Set();
  return out.filter(i => !seen.has(i.link) && seen.add(i.link)).slice(0, 18);
}

// ---------- AI ----------
async function gemini(text, json) {
  const models = [...new Set([E.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'].filter(Boolean))];
  let last = '';
  for (const model of models) for (let i = 0; i < 3; i++) {
    const body = { contents: [{ parts: [{ text }] }] }; if (json) body.generationConfig = { responseMimeType: 'application/json' };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (t) { console.log('Model dipakai:', model); return t; }
    last = model + ': ' + JSON.stringify(j).slice(0, 250);
    if (![503, 429].includes(r.status)) break;
    await new Promise(s => setTimeout(s, 6000 * (i + 1)));
  }
  throw new Error('Gemini gagal. ' + last);
}
async function ai(text) {
  if (LLM === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: E.CLAUDE_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 3500, messages: [{ role: 'user', content: text }] }) });
    const j = await r.json(); const t = j.content?.[0]?.text; if (!t) throw new Error('Claude gagal: ' + JSON.stringify(j).slice(0, 200)); return t;
  }
  return gemini(text, true);
}
const askJson = async p => { const t = await ai(p); return JSON.parse(t.replace(/^```json|^```|```$/gim, '').trim()); };

const P_INDUSTRI = (src, date) => `Hari ini ${date}. Kamu analis kebijakan untuk pelaku industri VAPE (rokok elektrik) dan KONTRAKTOR INFRASTRUKTUR di Indonesia. Dari daftar sumber bernomor di bawah, pilih HANYA isu politik, regulasi, dan kebijakan fiskal/anggaran yang berpengaruh langsung pada dua sektor itu. Abaikan berita yang tidak relevan. Maksimal 8 isu; jika sedikit yang relevan, kembalikan lebih sedikit. Jangan mengarang fakta di luar sumber; analisis hanya berdasar judul/cuplikan sehingga nyatakan ketidakpastian bila perlu.
Kembalikan JSON saja:
{"ringkasan_eksekutif":"3-4 kalimat inti, tegas","isu":[{"judul":"","sektor":"vape|infrastruktur|keduanya","jenis":"regulasi|politik|fiskal","dampak":1-5,"kemungkinan":1-5,"arah":"risiko|peluang|netral","horizon":"<3 bulan|3-12 bulan|>12 bulan","apa_terjadi":"1-2 kalimat","implikasi":"1-2 kalimat dampak bisnis","aksi":"1 kalimat aksi","ref":[nomor sumber]}],"skenario":{"vape":"","infrastruktur":""},"watchlist":["",""],"rekomendasi":["",""]}

SUMBER:
${src.map((s, i) => `[${i + 1}] (${s.kind}) ${s.title} | ${s.src} | ${s.date}${s.desc ? ' | ' + s.desc : ''}`).join('\n')}`;

const P_HARIAN = d => `Kamu asisten pribadi. Dari data berikut kembalikan JSON saja, Bahasa Indonesia:
{"email":{"urgent":[{"pengirim":"","inti":"1 kalimat","aksi":"saran singkat"}],"penting":[{"pengirim":"","inti":"","aksi":""}],"abaikan_jumlah":0},"insight_keuangan":["2-3 insight/saran hemat dari data, jangan mengarang angka"],"rencana":[{"waktu":"08.00-09.30","kegiatan":""}]}
Aturan: urgent = perlu dibalas hari ini; penting = minggu ini; sisanya masuk abaikan_jumlah. Nilai hanya dari pengirim dan subjek. Rencana 3-5 blok dari tugas terbuka dan email urgent.

EMAIL:
${d.emails}

KEUANGAN:
${d.fin}

TUGAS TERBUKA:
${d.tasks}`;

// ---------- Telegram ----------
async function telegram(text) {
  for (let i = 0; i < text.length; i += 3800) {
    const r = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: text.slice(i, i + 3800), disable_web_page_preview: true }) });
    if (!r.ok) throw new Error('Telegram gagal: ' + (await r.text()));
  }
}
async function telegramPhoto(file, caption) {
  const fd = new FormData(); fd.append('chat_id', E.TELEGRAM_CHAT_ID); fd.append('caption', caption.slice(0, 900));
  fd.append('photo', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
  const r = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error('sendPhoto gagal: ' + (await r.text()));
}
function renderPng(html, name, w, h) {
  const f = path.resolve(name + '.html'), out = path.resolve(name + '.png'); fs.writeFileSync(f, html);
  let last = '';
  for (const b of [E.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean)) {
    try { execFileSync(b, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${out}`, 'file://' + f], { stdio: 'pipe', timeout: 90000 }); if (fs.existsSync(out)) return out; } catch (e) { last = e.message.slice(0, 150); }
  }
  throw new Error('Chrome gagal membuat gambar: ' + last);
}

async function main() {
  const st = loadState();
  let log = [];
  try { log = await pollTelegram(st); } catch (e) { log = ['(Gagal membaca pesan Telegram: ' + e.message + ')']; }
  saveState(st);
  if (!FULL) { if (log.length) await telegram('Tercatat:\n- ' + log.join('\n- ')); return; }

  const notes = [], date = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  const fin = financeStats(st), open = st.tasks.filter(t => !t.done);
  const d = { emails: 'Tidak ada data.', fin: financeText(fin), tasks: open.length ? open.map(t => `#${t.id} ${t.t}`).join('\n') : 'Belum ada tugas.' };
  try { const e = await fetchEmails(); d.emails = e.length ? e.join('\n') : 'Tidak ada email baru yang belum dibaca.'; d.n = e.length; } catch (e) { notes.push('Email gagal: ' + e.message); }

  // 1) analisis harian (email, keuangan, rencana)
  let h = null;
  try { h = await askJson(P_HARIAN(d)); } catch (e) { notes.push('Ringkasan harian AI gagal: ' + e.message); }
  const em = h?.email || {}, urg = em.urgent || [], pen = em.penting || [], abn = +em.abaikan_jumlah || 0;
  const line = x => `- ${x.pengirim}: ${x.inti} -> ${x.aksi}`;

  // 2) analisis industri (vape + kontraktor infrastruktur)
  let ind = null, nSrc = 0;
  try {
    const src = [...await fetchNews(), ...await fetchYoutube()]; nSrc = src.length;
    if (src.length) ind = ig.normalize(await askJson(P_INDUSTRI(src, date)));
    else notes.push('Sumber berita kosong');
  } catch (e) { notes.push('Analisis industri gagal: ' + e.message); }

  // pesan teks
  const top = (ind?.isu || []).slice(0, 3).map(i => `- [${i.arah.toUpperCase()}] ${i.judul} (${i.sektor}): ${i.implikasi}`);
  const txt = [`Laporan ${date}`,
    log.length ? `\nTercatat sejak kemarin:\n- ${log.join('\n- ')}` : '',
    h ? `\nEMAIL\nURGENT (${urg.length}):\n${urg.map(line).join('\n') || '-'}\nPENTING (${pen.length}):\n${pen.map(line).join('\n') || '-'}\nABAIKAN: ${abn} email` : `\nEMAIL\n${d.emails}`,
    `\nKEUANGAN\n${d.fin}${h?.insight_keuangan?.length ? '\n' + h.insight_keuangan.map(x => '- ' + x).join('\n') : ''}`,
    top.length ? `\nISU KUNCI VAPE & INFRASTRUKTUR (detail di gambar)\n${top.join('\n')}` : '',
    h?.rencana?.length ? `\nRENCANA HARI INI\n${h.rencana.map(r => `- ${r.waktu}: ${r.kegiatan}`).join('\n')}` : `\nTUGAS\n${d.tasks}`,
    notes.length ? `\nCatatan: ${notes.join('; ')}` : '',
    '\nPerintah: masuk 5jt gaji | keluar 25rb makan siang | tugas <isi> | selesai <no> | batal'].filter(Boolean).join('\n');
  await telegram(txt);

  // info grafis
  try {
    const dash = renderPng(ig.dashboardHtml({ date, email: { urgent: urg.length, penting: pen.length, abaikan: abn }, fin, tasksOpen: open.length }), 'dashboard', 1000, 900);
    await telegramPhoto(dash, `Dashboard harian ${date}`);
    if (ind) await telegramPhoto(renderPng(ig.industryHtml(ind, { date, sources: nSrc }), 'industri', 1000, 1120), `Peta isu politik & regulasi: vape dan kontraktor infrastruktur (${nSrc} sumber)`);
  } catch (e) { await telegram('Info grafis gagal dibuat: ' + e.message); }
  console.log('Terkirim ke Telegram');
}

module.exports = { parseAmount, parseCmd, applyCmd, financeStats, financeText, main };
if (require.main === module) main().catch(async e => { console.error(e); try { await telegram('Digest gagal: ' + e.message); } catch {} process.exit(1); });
