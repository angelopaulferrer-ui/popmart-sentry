// One-off: find your chat id and send a Telegram test message.
//   TELEGRAM_BOT_TOKEN=... node scripts/tg-test.mjs
// If TELEGRAM_CHAT_ID is unset, it auto-detects it from the latest message you sent the bot.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let CHAT = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN) { console.error("Missing TELEGRAM_BOT_TOKEN"); process.exit(1); }

if (!CHAT) {
  const u = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`)).json();
  const msg = (u.result || []).map(r => r.message).filter(Boolean).pop();
  if (!msg) {
    console.error("No messages found. Open Telegram, message your bot (say 'hi'), then re-run.");
    process.exit(2);
  }
  CHAT = String(msg.chat.id);
  console.log("Detected chat id:", CHAT, "from", msg.chat.first_name || msg.chat.title);
}

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chat_id: CHAT,
    parse_mode: "HTML",
    text: "✅ <b>TEST — Popmart Sentry</b>\nTelegram alerts are working.\nYou'll get a ping like this the moment a Hirono / After Dark item restocks on Pop Mart PH.",
  }),
});
console.log("send status:", res.status, await res.text());
console.log("\n>>> CHAT_ID to save:", CHAT);
