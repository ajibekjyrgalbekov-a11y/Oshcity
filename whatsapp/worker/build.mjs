// Собирает src/generated.js: условия из site/js/config.js + текст правил prompt.md.
// Запускается перед тестами и перед публикацией (npm run build).
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const box = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "site/js/config.js"), "utf8"), box);
const c = box.window.CONFIG;
const config = {
  pricePerM2: c.pricePerM2,
  downPayment: c.downPayment,
  months: c.months,
  hours: c.hours,
  siteUrl: c.siteUrl,
  phoneDisplay: c.phoneDisplay,
  blocks: Object.fromEntries(Object.entries(c.blocks).map(([b, v]) => [b, { lot: v.lot }]))
};
const prompt = fs.readFileSync(path.join(here, "prompt.md"), "utf8");

fs.writeFileSync(
  path.join(here, "src/generated.js"),
  "// Создано build.mjs — не править вручную.\n" +
    `export const CONFIG = ${JSON.stringify(config, null, 1)};\n` +
    `export const PROMPT = ${JSON.stringify(prompt)};\n`
);
console.log("generated.js: условия и правила собраны");
