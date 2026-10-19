// Проверки без сети: подбор и расчёт на реальных данных site/data, разбор вебхуков, логика чата с фейковым Claude.
import assert from "node:assert";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { loadApartments, findApartments, quoteApartment, resetCache } from "./src/catalog.js";
import { buildSystem, runTurn, TOOLS } from "./src/assistant.js";
import { parseWebhook, verifySignature } from "./src/webhook.js";
import { ChatCore, DEBOUNCE_MS } from "./src/chat.js";
import { CONFIG, PROMPT } from "./src/generated.js";

const require = createRequire(import.meta.url);
const Calc = require("../../site/js/calc.js");
const site = new URL("../../site/", import.meta.url);

// ---------- фейковая сеть ----------
const calls = [];
const fakeFetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith(CONFIG.siteUrl)) {
    const p = new URL(url.slice(CONFIG.siteUrl.length), site);
    return new Response(fs.readFileSync(p), { status: 200 });
  }
  calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
  if (url.includes("graph.facebook.com")) return Response.json({ messages: [{ id: `wamid.${calls.length}` }] });
  return Response.json({ ok: true });
};

// ---------- условия ----------
assert.deepStrictEqual(CONFIG.pricePerM2, [{ maxFloor: 13, price: 92400 }, { maxFloor: 99, price: 88000 }]);
const system = buildSystem(PROMPT, CONFIG);
assert.ok(system.includes("1–13 этаж — 92 400 сом, с 14 этажа — 88 000 сом"));
assert.ok(system.includes("от 500 000 сом") && system.includes("до 67 месяцев") && system.includes("9:00–21:00"));
assert.ok(!/\{[a-z]+\}/.test(system), "все подстановки заполнены");

// ---------- каталог ----------
resetCache();
const { list } = await loadApartments(CONFIG.siteUrl, fakeFetch);
const index = JSON.parse(fs.readFileSync(new URL("data/index.json", site)));
assert.strictEqual(list.length, Object.values(index.blocks).reduce((s, n) => s + n, 0));

let r = findApartments(list, CONFIG, { rooms: 1, max_total: null, down_payment: null, max_monthly: null, floor: "any" });
assert.strictEqual(r.options.length, 3);
assert.ok(r.options.every((o) => o.rooms === 1));
assert.ok(r.options[0].price <= r.options[1].price && r.options[1].price <= r.options[2].price);
assert.strictEqual(new Set(r.options.map((o) => `${o.area_m2}|${o.price_per_m2}`)).size, 3, "варианты разные");
for (const o of r.options) {
  const a = list.find((x) => `${x.b.replace("/", "_")}-${x.p}-${x.f}-${x.n}` === o.id);
  const q = Calc.quote(a, CONFIG);
  assert.strictEqual(o.price, q.total);
  assert.strictEqual(o.monthly, q.monthly);
  assert.strictEqual(o.down_payment + o.monthly * (o.months - 1) + o.last_payment, o.price, "сумма до сома");
  assert.ok(fs.existsSync(new URL(`kv/${o.id}.html`, site)), "ссылка ведёт на существующую страницу");
}

r = findApartments(list, CONFIG, { rooms: 2, max_total: null, down_payment: 1500000, max_monthly: 60000, floor: "high" });
assert.ok(r.options.every((o) => o.rooms === 2 && o.floor >= 14 && o.down_payment === 1500000));
if (r.matching) assert.ok(r.options.every((o) => o.monthly <= 60000));

r = findApartments(list, CONFIG, { rooms: 3, max_total: 1000000, down_payment: 100000, max_monthly: null, floor: "any" });
assert.strictEqual(r.matching, 0);
assert.ok(r.options.length > 0 && r.note.includes("500000") && r.note.includes("ближайшие"));

const one = quoteApartment(list, CONFIG, r.options[0].id, 2000000);
assert.strictEqual(one.down_payment, 2000000);
assert.ok(quoteApartment(list, CONFIG, "999-9-9-9", null).error);

// ---------- вебхук ----------
const secret = "app-secret";
const raw = JSON.stringify({ entry: [] });
const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
assert.ok(await verifySignature(raw, sig, secret));
assert.ok(!(await verifySignature(raw + " ", sig, secret)));
assert.ok(!(await verifySignature(raw, undefined, secret)));

const hook = (field, value) => ({ entry: [{ changes: [{ field, value }] }] });
const evs = parseWebhook(
  hook("messages", {
    contacts: [{ wa_id: "996555123456", profile: { name: "Айбек" } }],
    messages: [
      { from: "996555123456", id: "m1", timestamp: "1760900000", type: "text", text: { body: "Саламатсызбы, 2 бөлмөлүү канча?" } },
      { from: "996555123456", id: "m2", timestamp: "1760900001", type: "audio", audio: { id: "x" } },
      { from: "996555123456", id: "m3", timestamp: "1760900002", type: "reaction", reaction: {} }
    ]
  })
);
assert.deepStrictEqual(evs.map((e) => e.kind), ["in", "media"]);
assert.strictEqual(evs[0].name, "Айбек");
assert.strictEqual(evs[1].media, "голосовое сообщение");
const echo = parseWebhook(hook("smb_message_echoes", { message_echoes: [{ from: "996508890202", to: "996555123456", id: "e1", timestamp: "1760900100", type: "text", text: { body: "Ажибек на связи" } }] }));
assert.deepStrictEqual(echo[0], { kind: "echo", waId: "996555123456", id: "e1", ts: 1760900100000, text: "Ажибек на связи" });

// ---------- цикл инструментов с фейковым Claude ----------
function fakeClient(script) {
  const seen = [];
  return {
    seen,
    beta: { messages: { create: async (req) => { seen.push(JSON.parse(JSON.stringify(req))); return script.shift()(req); } } }
  };
}
const toolUse = (name, input, id = "t" + Math.random()) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const say = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

for (const t of TOOLS) {
  assert.strictEqual(t.strict, true);
  assert.deepStrictEqual([...t.input_schema.required].sort(), Object.keys(t.input_schema.properties).sort(), t.name);
}

// ---------- чат целиком ----------
function memStore() {
  const m = new Map();
  return { m, alarm: 0, get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), setAlarm: async function (t) { this.alarm = t; } };
}
const env = { WA_PHONE_NUMBER_ID: "123", WA_TOKEN: "t", TG_TOKEN: "tg", TG_CHAT_ID: "1", SHEET_URL: "https://script.google.com/x", PAUSE_HOURS: "12" };
let now = 1760900000000;
const store = memStore();

const client = fakeClient([
  () => toolUse("find_apartments", { rooms: 2, max_total: null, down_payment: 1000000, max_monthly: null, floor: "any" }),
  (req) => {
    const res = JSON.parse(req.messages.at(-1).content[0].content);
    assert.ok(res.options.length > 0);
    return { stop_reason: "tool_use", content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "s1", name: "save_lead", input: { name: "Айбек", phone: null, rooms: 2, down_payment: 1000000, budget_total: null, monthly_budget: null, interested_in: null, meeting_time: null, notes: null } }
    ] };
  },
  () => say("Саламатсызбы, Айбек! Мен Ажибектин AI-жардамчысымын. 2 бөлмөлүү батирлер бар..."),
  // второй ход: договорились о встрече
  () => ({ stop_reason: "tool_use", content: [
    { type: "tool_use", id: "a", name: "save_lead", input: { name: null, phone: null, rooms: null, down_payment: null, budget_total: null, monthly_budget: null, interested_in: null, meeting_time: "шейшемби 11:00", notes: null } },
    { type: "tool_use", id: "b", name: "set_status", input: { status: "meeting", reason: "придёт во вторник в 11:00" } }
  ] }),
  () => say("Жакшы, шейшемби саат 11:00дө күтөбүз! Дарек: Масалиев пр., 118а.")
]);
const core = new ChatCore(store, { env, client, fetchFn: fakeFetch, now: () => now });

assert.strictEqual(await core.onEvent(evs[0]), "queued");
assert.strictEqual(store.alarm, now + DEBOUNCE_MS);
assert.strictEqual(await core.onEvent({ ...evs[0], id: "m1b", text: "1 млн бар" }), "queued");
calls.length = 0;
assert.strictEqual(await core.process(), "replied");
const firstReq = client.seen[0];
assert.ok(firstReq.messages[0].content[0].text.includes("2 бөлмөлүү канча?\n1 млн бар"), "два сообщения — один ответ");
assert.ok(firstReq.messages[0].content[0].text.includes("Айбек"));
assert.deepStrictEqual(firstReq.fallbacks, "default");
const sent = calls.filter((c) => c.url.includes("graph.facebook.com"));
assert.strictEqual(sent.length, 1);
assert.strictEqual(sent[0].body.to, "996555123456");
assert.ok(calls.some((c) => c.url.includes("script.google.com") && c.body.name === "Айбек" && c.body.status === "новый"));
const hist = store.m.get("history");
assert.strictEqual(hist.length, 6, "user, assistant(tool), user(result), assistant(tool+thinking), user(result), assistant(text)");
assert.strictEqual(hist[3].content[0].type, "thinking", "блоки thinking сохраняются как есть");

now += 60000;
await core.onEvent({ kind: "in", waId: "996555123456", text: "Шейшемби 11де келем", ts: now });
calls.length = 0;
await core.process();
assert.ok(client.seen.at(-2).messages.length === 7, "история дописывается, а не переписывается");
assert.deepStrictEqual(client.seen.at(-2).messages.slice(0, 6), hist);
const tg = calls.filter((c) => c.url.includes("api.telegram.org"));
assert.strictEqual(tg.length, 1);
assert.ok(tg[0].body.text.includes("встреча2") && tg[0].body.text.includes("шейшемби 11:00") && tg[0].body.text.includes("wa.me/996555123456"));
assert.ok(calls.some((c) => c.url.includes("script.google.com") && c.body.status === "встреча2"));

// своё сообщение (эхо нашего же ответа) не ставит паузу
const ownId = store.m.get("sentIds").at(-1);
assert.strictEqual(await core.onEvent({ kind: "echo", waId: "996555123456", id: ownId }), "own");
// менеджер написал сам — бот молчит, но запоминает переписку
assert.strictEqual(await core.onEvent({ kind: "echo", waId: "996555123456", id: "e9", text: "Айбек, күтөм!" }), "paused");
assert.strictEqual(await core.onEvent({ kind: "in", waId: "996555123456", text: "Рахмат", ts: now }), "noted");
now += 13 * 3600e3;
const client2 = fakeClient([() => say("Кайрылганыңызга рахмат!")]);
const core2 = new ChatCore(store, { env, client: client2, fetchFn: fakeFetch, now: () => now });
await core2.onEvent({ kind: "in", waId: "996555123456", text: "Дагы суроо бар", ts: now });
await core2.process();
const t = client2.seen[0].messages.at(-1).content[0].text;
assert.ok(t.includes("Ажибек написал клиенту: Айбек, күтөм!") && t.includes("Клиент (пока отвечал Ажибек): Рахмат"));
assert.deepStrictEqual(store.m.get("notes"), []);

// голосовое: короткий ответ, уведомление, пауза
const s2 = memStore();
const core3 = new ChatCore(s2, { env, client: fakeClient([]), fetchFn: fakeFetch, now: () => now });
calls.length = 0;
assert.strictEqual(await core3.onEvent(evs[1]), "media");
assert.ok(calls.some((c) => c.url.includes("graph.facebook.com") && c.body.text.body.includes("Ажибек")));
assert.ok(calls.some((c) => c.url.includes("api.telegram.org") && c.body.text.includes("голосовое")));
assert.strictEqual(await core3.onEvent({ ...evs[0], ts: now }), "noted");

// ошибка Claude: клиенту вежливый ответ, менеджеру — тревога, история цела
const s3 = memStore();
const core4 = new ChatCore(s3, { env, client: { beta: { messages: { create: async () => { throw new Error("overloaded"); } } } }, fetchFn: fakeFetch, now: () => now });
await core4.onEvent({ ...evs[0], ts: now });
calls.length = 0;
assert.strictEqual(await core4.process(), "error");
assert.ok(calls.some((c) => c.url.includes("api.telegram.org") && c.body.text.includes("overloaded")));
assert.strictEqual(s3.m.get("history"), undefined);

// runTurn: слишком много шагов — историю не портим
const loop = fakeClient(Array.from({ length: 6 }, () => () => toolUse("find_apartments", { rooms: 1, max_total: null, down_payment: null, max_monthly: null, floor: "any" })));
const out = await runTurn({ client: loop, model: "m", effort: "low", system: "s", history: [], userText: "hi", exec: () => ({}) });
assert.ok(out.truncated && out.history.length === 0);

console.log("whatsapp assistant tests passed:", list.length, "apartments");
