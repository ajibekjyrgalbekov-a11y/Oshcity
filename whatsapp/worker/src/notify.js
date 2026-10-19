// Уведомления Ажибеку в Telegram и строка клиента в Google-таблице.

// Названия списков в приложении WhatsApp Business
export const LISTS = { ignore: "игнор1", meeting: "встреча2", booking: "бронь3", online: "онлайн оформление4" };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const money = (n) => (n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " сом" : "");

export function leadCard(lead, title) {
  const rows = [
    ["Клиент", [lead.name, lead.profile_name && lead.profile_name !== lead.name ? `(WhatsApp: ${lead.profile_name})` : ""].filter(Boolean).join(" ")],
    ["WhatsApp", `+${lead.wa_id}`],
    ["Доп. телефон", lead.phone],
    ["Комнат", lead.rooms],
    ["Взнос", money(lead.down_payment)],
    ["Бюджет", money(lead.budget_total)],
    ["В месяц до", money(lead.monthly_budget)],
    ["Понравились", lead.interested_in],
    ["Встреча", lead.meeting_time],
    ["Заметки", lead.notes]
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");
  return `<b>${esc(title)}</b>\n` + rows.map(([k, v]) => `${k}: ${esc(v)}`).join("\n") + `\n\nЧат: https://wa.me/${lead.wa_id}`;
}

export async function telegram(env, html, fetchFn = fetch) {
  if (!env.TG_TOKEN || !env.TG_CHAT_ID) return;
  const res = await fetchFn(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!res.ok) console.log("telegram", res.status, await res.text().catch(() => ""));
}

// Одна строка на клиента в листе «WhatsApp» (обновляется по номеру) — см. google/Code.gs, type "wa"
export async function sheet(env, lead, fetchFn = fetch) {
  if (!env.SHEET_URL) return;
  const res = await fetchFn(env.SHEET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      type: "wa",
      ts: Date.now(),
      wa: lead.wa_id,
      name: lead.name || lead.profile_name || "",
      phone: lead.phone || "",
      rooms: lead.rooms || "",
      down: lead.down_payment || "",
      budget: lead.budget_total || "",
      monthly: lead.monthly_budget || "",
      status: lead.status ? LISTS[lead.status] : "новый",
      flats: lead.interested_in || "",
      meeting: lead.meeting_time || "",
      notes: lead.notes || ""
    }),
    redirect: "follow"
  });
  if (!res.ok) console.log("sheet", res.status);
}
