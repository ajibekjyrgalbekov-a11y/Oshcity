// Разбор вебхуков WhatsApp Cloud API (в т.ч. coexistence: smb_message_echoes) и отправка сообщений.

const enc = new TextEncoder();

// Подпись Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, сырое тело запроса)
export async function verifySignature(rawBody, header, appSecret) {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7).toLowerCase();
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const MEDIA = { audio: "голосовое сообщение", voice: "голосовое сообщение", image: "фото", video: "видео", document: "файл", sticker: "стикер", location: "геолокация", contacts: "контакт" };

// Возвращает список событий:
//  { kind: "in", waId, name, id, ts, text } — текст клиента (кнопки/ответы тоже приводятся к тексту)
//  { kind: "media", waId, name, id, ts, media } — голосовое/фото/видео/файл и т.п.
//  { kind: "echo", waId, id, ts } — менеджер сам написал клиенту из приложения
export function parseWebhook(body) {
  const out = [];
  for (const entry of body.entry || [])
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (ch.field === "messages") {
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, (c.profile && c.profile.name) || ""]));
        for (const m of v.messages || []) {
          const base = { waId: m.from, name: names[m.from] || "", id: m.id, ts: Number(m.timestamp) * 1000 };
          const text =
            m.type === "text" ? m.text.body
            : m.type === "button" ? m.button.text
            : m.type === "interactive" ? (m.interactive.button_reply || m.interactive.list_reply || {}).title
            : null;
          if (text) out.push({ kind: "in", ...base, text });
          else if (m.type === "reaction" || m.type === "unsupported" || m.type === "system") continue;
          else out.push({ kind: "media", ...base, media: MEDIA[m.type] || m.type, caption: (m[m.type] && m[m.type].caption) || "" });
        }
      } else if (ch.field === "smb_message_echoes") {
        for (const m of v.message_echoes || []) out.push({ kind: "echo", waId: m.to, id: m.id, ts: Number(m.timestamp) * 1000, text: (m.text && m.text.body) || "" });
      }
    }
  return out;
}

const GRAPH = "https://graph.facebook.com/v23.0";

export async function sendText(env, to, body, fetchFn = fetch) {
  const res = await fetchFn(`${GRAPH}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body, preview_url: true } })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp send ${res.status}: ${JSON.stringify(data.error || data)}`);
  return (data.messages && data.messages[0] && data.messages[0].id) || null;
}

