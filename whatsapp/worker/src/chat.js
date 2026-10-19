// Логика одного чата с клиентом (живёт в Durable Object — по одному на номер клиента).
import { loadApartments } from "./catalog.js";
import { buildSystem, makeExecutor, runTurn } from "./assistant.js";
import { sendText } from "./webhook.js";
import { LISTS, leadCard, sheet, telegram } from "./notify.js";
import { CONFIG, PROMPT } from "./generated.js";

export const DEBOUNCE_MS = 4000; // клиент часто пишет несколькими сообщениями подряд — ждём и отвечаем одним
const MAX_HISTORY_CHARS = 300000;

const MEDIA_REPLY =
  "Рахмат! Бул билдирүүнү Ажибек өзү угуп/көрүп, жакында жооп берет 🙏\n" +
  "Спасибо! Это сообщение Ажибек посмотрит сам и скоро ответит 🙏";
const ERROR_REPLY =
  "Кечиресиз, азыр жооп бере албай жатам — Ажибек жакында өзү жазат.\n" +
  "Извините, сейчас не получается ответить — Ажибек скоро напишет сам.";

export function bishkekTime(ts) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(ts));
}

export class ChatCore {
  // store: { get(key), put(key, value), setAlarm(ms) }; deps: { env, client, fetchFn, now }
  constructor(store, deps) {
    this.s = store;
    this.d = deps;
    this.env = deps.env;
    this.fetch = deps.fetchFn || fetch;
    this.now = deps.now || Date.now;
  }

  pauseHours() {
    return Number(this.env.PAUSE_HOURS || 12);
  }

  async lead(waId, name) {
    const lead = (await this.s.get("lead")) || { wa_id: waId, created: this.now() };
    if (name) lead.profile_name = name;
    return lead;
  }

  async paused() {
    return ((await this.s.get("pausedUntil")) || 0) > this.now();
  }

  async addNote(line) {
    const notes = (await this.s.get("notes")) || [];
    notes.push(line);
    await this.s.put("notes", notes.slice(-30));
  }

  async onEvent(ev) {
    const lead = await this.lead(ev.waId, ev.name);
    await this.s.put("lead", lead);

    if (ev.kind === "echo") {
      const sent = (await this.s.get("sentIds")) || [];
      if (sent.includes(ev.id)) return "own";
      await this.s.put("pausedUntil", this.now() + this.pauseHours() * 3600e3);
      if (ev.text) await this.addNote(`Ажибек написал клиенту: ${ev.text}`);
      return "paused";
    }

    if (await this.paused()) {
      await this.addNote(ev.kind === "in" ? `Клиент (пока отвечал Ажибек): ${ev.text}` : `Клиент прислал ${ev.media}`);
      return "noted";
    }

    if (ev.kind === "media") {
      await this.addNote(`Клиент прислал ${ev.media}${ev.caption ? ` с подписью «${ev.caption}»` : ""}; передано Ажибеку.`);
      await this.reply(ev.waId, MEDIA_REPLY);
      await this.s.put("pausedUntil", this.now() + this.pauseHours() * 3600e3);
      await telegram(this.env, leadCard(lead, `🎤 Клиент прислал ${ev.media} — ответьте сами (бот в этом чате на паузе)`), this.fetch);
      return "media";
    }

    const pending = (await this.s.get("pending")) || [];
    pending.push({ text: ev.text, ts: ev.ts || this.now() });
    await this.s.put("pending", pending);
    await this.s.setAlarm(this.now() + DEBOUNCE_MS);
    return "queued";
  }

  async reply(waId, text) {
    const id = await sendText(this.env, waId, text, this.fetch);
    if (id) {
      const sent = (await this.s.get("sentIds")) || [];
      sent.push(id);
      await this.s.put("sentIds", sent.slice(-50));
    }
  }

  // Срабатывает по будильнику: отвечает на всё, что накопилось
  async process() {
    const pending = (await this.s.get("pending")) || [];
    if (!pending.length) return "empty";
    await this.s.put("pending", []);
    const lead = await this.lead();
    if (await this.paused()) {
      for (const p of pending) await this.addNote(`Клиент (пока отвечал Ажибек): ${p.text}`);
      return "paused";
    }

    let history = (await this.s.get("history")) || [];
    const notes = (await this.s.get("notes")) || [];
    if (JSON.stringify(history).length > MAX_HISTORY_CHARS) {
      history = [];
      notes.unshift(`Разговор длинный, начат заново. Анкета клиента: ${JSON.stringify(lead)}`);
    }
    const userText =
      `[${bishkekTime(pending[pending.length - 1].ts)}, Бишкек]` +
      (lead.profile_name ? ` Имя в профиле WhatsApp: ${lead.profile_name}.` : "") +
      (notes.length ? `\nЧто было без тебя:\n- ${notes.join("\n- ")}` : "") +
      `\nКлиент:\n${pending.map((p) => p.text).join("\n")}`;

    const isNew = !history.length && !lead.status;
    const ctx = { cfg: CONFIG, lead, events: [], apartments: [] };
    let result;
    try {
      ctx.apartments = (await loadApartments(CONFIG.siteUrl, this.fetch)).list;
      result = await runTurn({
        client: this.d.client,
        model: this.env.MODEL || "claude-opus-5-5",
        effort: this.env.EFFORT || "low",
        system: buildSystem(PROMPT, CONFIG),
        history,
        userText,
        exec: makeExecutor(ctx)
      });
    } catch (e) {
      console.log("assistant error", e && e.stack ? e.stack : e);
      await this.addNote(`Клиент: ${pending.map((p) => p.text).join(" / ")} (бот не смог ответить)`);
      await this.reply(lead.wa_id, ERROR_REPLY).catch(() => {});
      await this.s.put("pausedUntil", this.now() + this.pauseHours() * 3600e3);
      await telegram(this.env, leadCard(lead, `⚠️ Бот не смог ответить (${String(e.message || e).slice(0, 200)}) — ответьте сами`), this.fetch);
      return "error";
    }

    if (result.history === history) {
      // ход не сохранился (отказ модели или слишком много шагов) — сообщения клиента остаются в заметках
      await this.addNote(`Клиент: ${pending.map((p) => p.text).join(" / ")}`);
      if (result.text) await this.addNote(`Ты ответил: ${result.text}`);
    } else {
      await this.s.put("history", result.history);
      await this.s.put("notes", []);
    }
    await this.s.put("lead", ctx.lead);
    if (result.text) await this.reply(lead.wa_id, result.text);

    if (result.refused || !result.text) ctx.events.push({ type: "manager", reason: "бот не нашёл, что ответить" });
    const statuses = ctx.events.filter((e) => e.type === "status");
    for (const e of statuses)
      if (e.status !== "ignore")
        await telegram(this.env, leadCard(ctx.lead, `✅ Добавьте в список «${LISTS[e.status]}» — ${e.reason}`), this.fetch);
    for (const e of ctx.events.filter((e) => e.type === "manager"))
      await telegram(this.env, leadCard(ctx.lead, `🙋 Нужен Ажибек: ${e.reason}`), this.fetch);
    if (isNew || ctx.events.some((e) => e.type === "lead" || e.type === "status")) await sheet(this.env, ctx.lead, this.fetch);
    return "replied";
  }

  async setPause(on) {
    await this.s.put("pausedUntil", on ? this.now() + 365 * 24 * 3600e3 : 0);
  }
}
