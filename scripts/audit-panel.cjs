const fs = require("node:fs");

const html = fs.readFileSync("packages/panel/index.html", "utf8");
const runtime = fs.readFileSync("packages/panel/dist/main.js", "utf8");
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const usedIds = new Set([...runtime.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
const dynamicIds = new Set(["applyWordTime", "wordStart", "wordEnd"]);
const missing = [...usedIds].filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
const duplicates = [...htmlIds].filter((id) => (html.match(new RegExp(`id="${id}"`, "g")) || []).length > 1);

if (missing.length) throw new Error(`Brak kontrolek HTML: ${missing.join(", ")}`);
if (duplicates.length) throw new Error(`Powtórzone id HTML: ${duplicates.join(", ")}`);
console.log(`Panel bindings verified: ${usedIds.size} runtime IDs, ${htmlIds.size} HTML IDs.`);
