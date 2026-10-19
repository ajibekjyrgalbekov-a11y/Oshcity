// Cloudflare Worker: вебхук WhatsApp → ассистент Claude; команды менеджера из Telegram.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { parseWebhook, verifySignature } from "./webhook.js";
import { ChatCore } from "./chat.js";
import { telegram } from "./notify.js";

export class Chat extends DurableObject {
  core() {
    const st = this.ctx.storage;
    const store = { get: (k) => st.get(k), put: (k, v) => st.put(k, v), setAlarm: (t) => st.setAlarm(t) };
    return new ChatCore(store, { env: this.env, client: new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY }) });
  }
  onEvent(ev) {
    return this.core().onEvent(ev);
  }
  setPause(on) {
    return this.core().setPause(on);
  }
  async alarm() {
    await this.core().process();
  }
}

const chat = (env, waId) => env.CHAT.get(env.CHAT.idFromName(waId));
const phone = (s) => {
  const d = String(s || "").replace(/\D/g, "");
  return d.startsWith("0") ? "996" + d.slice(1) : d;
};

async function whatsapp(req, env, ctx) {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("X-Hub-Signature-256"), env.WA_APP_SECRET)))
    return new Response("bad signature", { status: 401 });
  const body = JSON.parse(raw);
  // только наш номер (на один аккаунт может быть подключено несколько)
  for (const e of body.entry || [])
    for (const c of e.changes || [])
      if (c.value && c.value.metadata && c.value.metadata.phone_number_id !== env.WA_PHONE_NUMBER_ID) c.value = {};
  for (const ev of parseWebhook(body)) if (ev.waId) ctx.waitUntil(chat(env, ev.waId).onEvent(ev));
  return new Response("ok");
}

const HELP =
  "Команды:\n/pause 0555123456 — бот молчит в этом чате, пока не включите\n/resume 0555123456 — бот снова отвечает\n" +
  "Бот сам замолкает на несколько часов, когда вы пишете клиенту из приложения.";

async function tg(req, env) {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_SECRET) return new Response("forbidden", { status: 403 });
  const upd = await req.json();
  const msg = upd.message;
  if (!msg || String(msg.chat.id) !== String(env.TG_CHAT_ID)) return new Response("ok");
  const [cmd, arg] = String(msg.text || "").trim().split(/\s+/, 2);
  if ((cmd === "/pause" || cmd === "/resume") && phone(arg).length >= 9) {
    await chat(env, phone(arg)).setPause(cmd === "/pause");
    await telegram(env, cmd === "/pause" ? `⏸ Бот молчит в чате +${phone(arg)}` : `▶️ Бот снова отвечает в чате +${phone(arg)}`);
  } else {
    await telegram(env, HELP);
  }
  return new Response("ok");
}

export default {
  async fetch(req, env, ctx) {
    const path = new URL(req.url).pathname;
    if (path === "/webhook") return whatsapp(req, env, ctx);
    if (path === "/telegram" && req.method === "POST") return tg(req, env);
    return new Response("Osh City WhatsApp assistant: ok");
  }
};
