// Разговор с Claude: правила + инструменты (подбор, расчёт, анкета, списки, вызов менеджера).
import { findApartments, quoteApartment } from "./catalog.js";

const nullable = (t) => ({ type: [t, "null"] });

export const TOOLS = [
  {
    name: "find_apartments",
    description:
      "Подобрать свободные квартиры. Возвращает до 3 разных вариантов (сначала дешёвые) с ценой, взносом, платежом в месяц и ссылкой, а также сколько всего подходит и диапазон цен. Неизвестные параметры — null.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        rooms: { ...nullable("integer"), description: "1, 2 или 3" },
        max_total: { ...nullable("integer"), description: "Максимальная полная цена квартиры, сом" },
        down_payment: { ...nullable("integer"), description: "Первый взнос клиента, сом (минимум берётся из условий)" },
        max_monthly: { ...nullable("integer"), description: "Максимальный платёж в месяц, сом" },
        floor: { type: "string", enum: ["low", "mid", "high", "any"], description: "low 1–5, mid 6–13, high 14+ (дешевле за м²)" }
      },
      required: ["rooms", "max_total", "down_payment", "max_monthly", "floor"],
      additionalProperties: false
    }
  },
  {
    name: "calc_installment",
    description: "Точная цена и рассрочка конкретной квартиры по её id (например 160-1-17-5) с нужным первым взносом.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        apartment_id: { type: "string" },
        down_payment: { ...nullable("integer"), description: "Первый взнос, сом; null — минимальный" }
      },
      required: ["apartment_id", "down_payment"],
      additionalProperties: false
    }
  },
  {
    name: "save_lead",
    description: "Сохранить/обновить анкету клиента для менеджера. Вызывай, когда узнал что-то новое. Неизвестное — null (старое значение не стирается).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        name: nullable("string"),
        phone: { ...nullable("string"), description: "Только если клиент дал другой номер для связи" },
        rooms: nullable("integer"),
        down_payment: nullable("integer"),
        budget_total: nullable("integer"),
        monthly_budget: nullable("integer"),
        interested_in: { ...nullable("string"), description: "id квартир, которые понравились" },
        meeting_time: { ...nullable("string"), description: "Когда придёт в офис, например «вт 21.10 в 11:00»" },
        notes: nullable("string")
      },
      required: ["name", "phone", "rooms", "down_payment", "budget_total", "monthly_budget", "interested_in", "meeting_time", "notes"],
      additionalProperties: false
    }
  },
  {
    name: "set_status",
    description: "Положить клиента в список менеджера: meeting — договорились о встрече в офисе; booking — хочет бронировать; online — оформление дистанционно; ignore — не целевой/отказ.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["meeting", "booking", "online", "ignore"] },
        reason: { type: "string" }
      },
      required: ["status", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "call_manager",
    description: "Срочно позвать Ажибека в этот чат: скидка/торг, бронь и оплата, жалоба, вопрос вне известных фактов.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false
    }
  }
];

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function buildSystem(template, cfg) {
  const prices = cfg.pricePerM2
    .map((r, i, arr) => {
      const from = i ? arr[i - 1].maxFloor + 1 : 1;
      return r.maxFloor >= 99 ? `с ${from} этажа — ${fmt(r.price)} сом` : `${from}–${r.maxFloor} этаж — ${fmt(r.price)} сом`;
    })
    .join(", ");
  return template
    .replace(/^# .*\n+/, "")
    .replaceAll("{phone}", cfg.phoneDisplay)
    .replaceAll("{prices}", prices)
    .replaceAll("{down}", fmt(cfg.downPayment))
    .replaceAll("{months}", String(cfg.months))
    .replaceAll("{from}", String(cfg.hours.from))
    .replaceAll("{to}", String(cfg.hours.to))
    .replaceAll("{site}", cfg.siteUrl);
}

// Выполняет инструменты; события (анкета, списки, вызов менеджера) складывает в ctx.events.
export function makeExecutor(ctx) {
  return (name, input) => {
    switch (name) {
      case "find_apartments":
        return findApartments(ctx.apartments, ctx.cfg, input);
      case "calc_installment":
        return quoteApartment(ctx.apartments, ctx.cfg, input.apartment_id, input.down_payment);
      case "save_lead": {
        for (const [k, v] of Object.entries(input)) if (v !== null && v !== "") ctx.lead[k] = v;
        ctx.events.push({ type: "lead" });
        return { ok: true };
      }
      case "set_status":
        ctx.lead.status = input.status;
        ctx.events.push({ type: "status", status: input.status, reason: input.reason });
        return { ok: true };
      case "call_manager":
        ctx.events.push({ type: "manager", reason: input.reason });
        return { ok: true, note: "Ажибек получил уведомление." };
      default:
        return { error: `unknown tool ${name}` };
    }
  };
}

const MAX_STEPS = 6;

// Один ход: добавляет сообщение клиента, крутит цикл инструментов, возвращает новую историю и текст ответа.
// history не меняется на месте — при ошибке старая история остаётся целой.
export async function runTurn({ client, model, effort, system, history, userText, exec }) {
  const messages = [...history, { role: "user", content: [{ type: "text", text: userText }] }];
  const texts = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort },
      cache_control: { type: "ephemeral" },
      system,
      tools: TOOLS,
      messages
    });
    if (res.stop_reason === "refusal") return { history, text: "", refused: true };
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) if (b.type === "text" && b.text.trim()) texts.push(b.text.trim());

    if (res.stop_reason === "pause_turn") continue;
    const calls = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) return { history: messages, text: texts.join("\n\n") };

    const results = calls.map((c) => {
      let out;
      try {
        out = exec(c.name, c.input);
      } catch (e) {
        return { type: "tool_result", tool_use_id: c.id, content: String(e.message || e), is_error: true };
      }
      return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) };
    });
    messages.push({ role: "user", content: results });
  }
  // Слишком много шагов: отдаём то, что успели сказать, историю не сохраняем (она оборвана на tool_result).
  return { history, text: texts.join("\n\n"), truncated: true };
}
