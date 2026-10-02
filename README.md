# Daily Digest -> Telegram (gratis, jalan otomatis tiap pagi)

## Setup (sekali, sekitar 20-30 menit)
1. **Telegram bot**: chat @BotFather, kirim /newbot, simpan token. Kirim satu pesan ke bot Anda, lalu buka
   https://api.telegram.org/bot<TOKEN>/getUpdates dan catat angka `chat.id`.
2. **Gmail API**: console.cloud.google.com > buat project > aktifkan Gmail API > OAuth consent screen
   (External; ubah status ke "In production" supaya refresh token tidak kedaluwarsa 7 hari) > buat OAuth client ID
   (Web application, redirect URI https://developers.google.com/oauthplayground).
3. **Refresh token**: buka OAuth Playground > ikon gear > centang "Use your own OAuth credentials" > isi Client ID/Secret >
   pilih scope `https://www.googleapis.com/auth/gmail.readonly` > Authorize > Exchange > salin Refresh token.
4. **LLM key**: gratis lewat Google AI Studio (GEMINI_API_KEY), atau berbayar lewat console.anthropic.com (ANTHROPIC_API_KEY, set LLM=claude).
5. **GitHub**: buat repo PRIVATE, upload folder ini. Settings > Secrets and variables > Actions > isi semua secret
   di digest.yml. (Opsional: variable `LLM` = `claude`.)
6. Tab Actions > Daily Digest > Run workflow untuk tes. Selanjutnya jalan sendiri tiap 07:00 WIB.

## Catatan
- Ubah jam: edit cron (UTC; WIB = UTC+7). GitHub bisa telat beberapa menit.
- Ubah filter email lewat env `GMAIL_QUERY`.
- Hanya akses baca (readonly); tidak mengirim atau menghapus email.
- Cek batas free tier Gemini/GitHub terbaru karena bisa berubah.
