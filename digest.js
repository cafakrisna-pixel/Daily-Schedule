// Asisten harian -> Telegram: email, keuangan, berita, rencana. Node 20+.
const fs = require('fs');
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

// ---------- berita (Google News RSS) ----------
const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
async function fetchNews() {
  const topics = (E.NEWS_TOPICS || 'ekonomi bisnis Indonesia|politik Indonesia|IHSG rupiah|kebijakan pemerintah ekonomi').split('|');
  const out = [];
  for (const q of topics) {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=id&gl=ID&ceid=ID:id`);
    const x = await r.text();
    for (const it of [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6)) {
      const t = (it[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      if (t) out.push(`[${q}] ${dec(t)}`);
    }
  }
  return [...new Set(out)];
}

// ---------- AI ----------
async function gemini(text) {
  const models = [...new Set([E.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'].filter(Boolean))];
  let last = '';
  for (const model of models) for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text }] }] }) });
    const j = await r.json(); const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (t) { console.log('Model dipakai:', model); return t; }
    last = model + ': ' + JSON.stringify(j).slice(0, 250);
    if (![503, 429].includes(r.status)) break;
    await new Promise(s => setTimeout(s, 6000 * (i + 1)));
  }
  throw new Error('Gemini gagal. ' + last);
}
async function summarize(text) {
  if (LLM === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: E.CLAUDE_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 2500, messages: [{ role: 'user', content: text }] }) });
    const j = await r.json(); const t = j.content?.[0]?.text; if (!t) throw new Error('Claude gagal: ' + JSON.stringify(j).slice(0, 200)); return t;
  }
  return gemini(text);
}

async function telegram(text) {
  for (let i = 0; i < text.length; i += 3800) {
    const r = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: text.slice(i, i + 3800), disable_web_page_preview: true }) });
    if (!r.ok) throw new Error('Telegram gagal: ' + (await r.text()));
  }
}

const PROMPT = d => `Kamu asisten pribadi dan analis bisnis. Susun laporan pagi dalam Bahasa Indonesia, teks polos tanpa markdown (boleh pakai huruf kapital untuk judul bagian dan tanda "-" untuk poin), ringkas dan tajam, dengan 4 bagian:

1) EMAIL: kelompokkan URGENT (balas hari ini), PENTING (minggu ini), ABAIKAN (satu baris). Untuk URGENT/PENTING sebut pengirim, inti 1 kalimat, saran tindakan. Penilaian hanya dari pengirim dan subjek, jangan mengarang isi email.
2) KEUANGAN: tampilkan angka persis dari data, lalu 2-3 insight atau saran hemat berdasarkan data itu. Jangan mengarang angka. Jika data kosong, ajak mencatat.
3) BERITA & ISU: pilih 5-6 isu terpenting bisnis dan politik dari daftar judul. Tiap isu: apa yang terjadi (1 kalimat) dan dampak atau implikasi bagi pelaku bisnis (1 kalimat). Tulis bahwa analisis berdasar judul berita, bukan isi lengkapnya.
4) RENCANA HARI INI: 3-5 prioritas dengan blok waktu singkat, diambil dari tugas terbuka dan email urgent.

DATA EMAIL:
${d.emails}

DATA KEUANGAN:
${d.fin}

DAFTAR JUDUL BERITA:
${d.news}

TUGAS TERBUKA:
${d.tasks}`;

async function main() {
  const st = loadState();
  let log = [];
  try { log = await pollTelegram(st); } catch (e) { log = ['(Gagal membaca pesan Telegram: ' + e.message + ')']; }
  saveState(st);
  if (log.length) console.log('Tercatat:', log.length);
  if (!FULL) { if (log.length) await telegram('Tercatat:\n- ' + log.join('\n- ')); return; }

  const d = { emails: 'Tidak ada data.', news: 'Tidak ada data.', fin: financeText(financeStats(st)) };
  const notes = [];
  try { const e = await fetchEmails(); d.emails = e.length ? e.join('\n') : 'Tidak ada email baru yang belum dibaca.'; console.log('Email:', e.length); } catch (e) { notes.push('Email gagal: ' + e.message); }
  try { const n = await fetchNews(); d.news = n.length ? n.join('\n') : 'Tidak ada berita.'; console.log('Berita:', n.length); } catch (e) { notes.push('Berita gagal: ' + e.message); }
  const open = st.tasks.filter(t => !t.done);
  d.tasks = open.length ? open.map(t => `#${t.id} ${t.t}`).join('\n') : 'Belum ada tugas. Kirim ke bot: "tugas <isi tugas>".';

  const date = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  let body;
  try { body = await summarize(PROMPT(d)); }
  catch (e) { notes.push('Ringkasan AI gagal: ' + e.message); body = `EMAIL\n${d.emails}\n\nKEUANGAN\n${d.fin}\n\nBERITA\n${d.news}\n\nTUGAS\n${d.tasks}`; }
  const footer = '\n\nPerintah: masuk 5jt gaji | keluar 25rb makan siang | tugas <isi> | selesai <no> | batal';
  await telegram(`Laporan ${date}\n` + (log.length ? `\nTercatat sejak kemarin:\n- ${log.join('\n- ')}\n` : '') + '\n' + body + (notes.length ? `\n\nCatatan: ${notes.join('; ')}` : '') + footer);
  console.log('Terkirim ke Telegram');
}

module.exports = { parseAmount, parseCmd, applyCmd, financeStats, financeText };
if (require.main === module) main().catch(async e => { console.error(e); try { await telegram('Digest gagal: ' + e.message); } catch {} process.exit(1); });
