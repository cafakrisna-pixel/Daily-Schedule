// Ringkasan email harian -> Telegram (versi App Password / IMAP, tanpa OAuth)
const { ImapFlow } = require('imapflow');
const E = process.env;
for (const k of Object.keys(E)) if (typeof E[k] === 'string') E[k] = E[k].trim();
const need = ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
for (const k of need) if (!E[k]) throw new Error('Env belum diisi: ' + k);
const LLM = E.LLM || 'gemini';

async function fetchEmails() {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: E.GMAIL_USER, pass: E.GMAIL_APP_PASSWORD.replace(/\s+/g, '') } });
  await client.connect();
  const out = [];
  const lock = await client.getMailboxLock('INBOX');
  try {
    let uids;
    try { uids = await client.search({ gmraw: E.GMAIL_QUERY || 'is:unread newer_than:1d -category:promotions -category:social' }, { uid: true }); }
    catch { uids = await client.search({ seen: false, since: new Date(Date.now() - 86400000) }, { uid: true }); }
    uids = (uids || []).slice(-30);
    if (uids.length) {
      for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
        const f = m.envelope.from?.[0];
        out.push(`Dari: ${f?.name || ''} <${f?.address || ''}>\nSubjek: ${m.envelope.subject || '(tanpa subjek)'}`);
      }
    }
  } finally { lock.release(); }
  await client.logout();
  return out;
}

const PROMPT = emails => `Kamu asisten pribadi. Dari daftar email (pengirim dan subjek) berikut, buat ringkasan harian dalam Bahasa Indonesia, teks polos tanpa markdown, dengan format:
URGENT (perlu dibalas hari ini)
PENTING (minggu ini)
BISA DIABAIKAN (satu baris saja)
Untuk tiap email urgent/penting: pengirim, inti 1 kalimat, dan saran tindakan. Jika tidak ada, tulis "Tidak ada". Nilai prioritas hanya dari pengirim dan subjek.

${emails.join('\n---\n')}`;

async function gemini(text) {
  const models = [...new Set([E.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'].filter(Boolean))];
  let last = '';
  for (const model of models) {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }) });
      const j = await r.json();
      const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (t) { console.log('Model dipakai:', model); return t; }
      last = model + ': ' + JSON.stringify(j).slice(0, 250);
      if (![503, 429].includes(r.status)) break;
      await new Promise(s => setTimeout(s, 6000 * (i + 1)));
    }
  }
  throw new Error('Gemini gagal. ' + last);
}

async function summarize(text) {
  if (LLM === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: E.CLAUDE_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: text }] }) });
    const j = await r.json(); return j.content?.[0]?.text || JSON.stringify(j);
  }
  return gemini(text);
}
async function telegram(text) {
  for (let i = 0; i < text.length; i += 3800) {
    const r = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: text.slice(i, i + 3800) }) });
    if (!r.ok) throw new Error('Telegram gagal: ' + (await r.text()));
  }
}

(async () => {
  const emails = await fetchEmails();
  console.log('Email ditemukan:', emails.length);
  const date = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  if (!emails.length) return telegram(`Ringkasan ${date}\n\nTidak ada email baru yang belum dibaca.`);
  await telegram(`Ringkasan ${date} (${emails.length} email)\n\n` + await summarize(PROMPT(emails)));
  console.log('Terkirim ke Telegram');
})().catch(async e => { console.error(e); try { await telegram('Digest gagal: ' + e.message); } catch {} process.exit(1); });
