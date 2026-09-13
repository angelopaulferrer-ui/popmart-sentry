// One-off: send a WhatsApp test message to confirm Cloud API plumbing.
// Uses the pre-approved "hello_world" template (no approval wait).
//   WA_TOKEN=... WA_PHONE_ID=... WA_TO=639954290741 node scripts/wa-test.mjs
const { WA_TOKEN, WA_PHONE_ID, WA_TO, WA_LANG = "en_US" } = process.env;
if (!WA_TOKEN || !WA_PHONE_ID || !WA_TO) {
  console.error("Missing WA_TOKEN / WA_PHONE_ID / WA_TO env vars.");
  process.exit(1);
}
const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${WA_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to: WA_TO,
    type: "template",
    template: { name: "hello_world", language: { code: WA_LANG } },
  }),
});
const body = await res.text();
console.log("HTTP", res.status);
console.log(body);
