// Ringkasan email harian -> Telegram. Node 20+, tanpa dependency.
const E = process.env;
for (const k of Object.keys(E)) if (typeof E[k] === 'string') E[k] = E[k].trim();
const chk = (n, f) => console.log(n, 'panjang=' + (E[n] || '').length, 'format_ok=' + f(E[n] || ''));
chk('GOOGLE_CLIENT_ID', v => v.endsWith('.apps.googleusercontent.com'));
chk('GOOGLE_CLIENT_SECRET', v => v.startsWith('GOCSPX-'));
chk('GOOGLE_REFRESH_TOKEN', v => v.startsWith('1//'));
console.log('CLIENT_ID_DIPAKAI', E.GOOGLE_CLIENT_ID);
const need = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID'];
for (const k of need) if (!E[k]) throw new Error('Env belum diisi: ' + k);
const LLM = E.LLM || 'gemini'; // 'gemini' (ada free tier) atau 'claude' (berbayar)

async function gmailToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: E.GOOGLE_CLIENT_ID, client_secret: E.GOOGLE_CLIENT_SECRET, refresh_token: E.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const j = await r.json(); if (!j.access_token) throw new Error('Gagal token Gmail: ' + JSON.stringify(j));
  return j.access_token;
}

async function fetchEmails(tok) {
  const h = { Authorization: 'Bearer ' + tok };
  const q = encodeURIComponent(E.GMAIL_QUERY || 'is:unread newer_than:1d -category:promotions -category:social');
  const list = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=30`, { headers: h })).json();
  const out = [];
  for (const m of list.messages || []) {
    const d = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: h })).json();
    const g = n => (d.payload?.headers || []).find(x => x.name === n)?.value || '';
    out.push(`Dari: ${g('From')}\nSubjek: ${g('Subject')}\nCuplikan: ${d.snippet}`);
  }
  return out;
}

const PROMPT = emails => `Kamu asisten pribadi. Dari daftar email berikut, buat ringkasan harian dalam Bahasa Indonesia, teks polos tanpa markdown, dengan format:
URGENT (perlu dibalas hari ini)
PENTING (minggu ini)
BISA DIABAIKAN (satu baris saja)
Untuk tiap email urgent/penting: pengirim, inti 1 kalimat, dan saran tindakan. Jika tidak ada, tulis "Tidak ada".

${emails.join('\n---\n')}`;

async function summarize(text) {
  if (LLM === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: E.CLAUDE_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: text }] }) });
    const j = await r.json(); return j.content?.[0]?.text || JSON.stringify(j);
  }
  const model = E.GEMINI_MODEL || 'gemini-2.0-flash'; // cek nama model terbaru di Google AI Studio
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${E.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }] }) });
  const j = await r.json(); return j.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(j);
}

async function telegram(text) {
  for (let i = 0; i < text.length; i += 3800) {
    await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: text.slice(i, i + 3800) }) });
  }
}

(async () => {
  const emails = await fetchEmails(await gmailToken());
  const date = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  if (!emails.length) return telegram(`Ringkasan ${date}\n\nTidak ada email baru yang belum dibaca.`);
  await telegram(`Ringkasan ${date} (${emails.length} email)\n\n` + await summarize(PROMPT(emails)));
})().catch(async e => { console.error(e); try { await telegram('Digest gagal: ' + e.message); } catch {} process.exit(1); });
