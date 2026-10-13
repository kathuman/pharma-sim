// PharmaSim Spanish translation checks — run with: node tests/i18n.test.js
// Every string the scripts translate, every control, equation and preset text, every element the pages mark and every
// validation message has a Spanish version with the same placeholders and markup, and nothing in the dictionary is unused.
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..") + path.sep;
const ES = require("../i18n-es.js"), M = require("../src/model.js"), S = require("../src/specs.js"), E = require("../src/equations.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort().join(",");
const ids = (s) => [...String(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1]).sort().join(",");

// ---- strings
const used = new Set();
for (const f of ["app.js", "tour.js", "src/diagram.js"]) for (const m of fs.readFileSync(R + f, "utf8").matchAll(/\bT\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) used.add(m[1] === '"' ? JSON.parse('"' + m[2] + '"') : m[2].replace(/\\'/g, "'"));
S.GROUPS.forEach((g) => { used.add(g.title); g.controls.forEach((c) => { used.add(c.label); if (c.note) used.add(c.note); if (c.unit) used.add(c.unit); if (c.zero) used.add(c.zero); (c.options || []).forEach((o) => used.add(o[1])); }); });
E.SECTIONS.forEach((s) => { used.add(s.title); s.items.forEach((i) => { used.add(i.name); used.add(i.eq); if (i.note) used.add(i.note); if (i.u && i.u[0] !== "$") used.add(i.u); }); });
Object.values(M.PRESETS).forEach((p) => used.add(p.label));
const missing = [...used].filter((s) => ES.T[s] == null);
check("every string has a Spanish version (" + used.size + " strings)", missing.length === 0, missing.map((s) => JSON.stringify(s)).join(" | "));
const bad = [...used].filter((s) => ES.T[s] != null && (ph(s) !== ph(ES.T[s]) || tags(s) !== tags(ES.T[s])));
check("…with the same {placeholders} and markup", bad.length === 0, bad.join(" | "));
const unused = Object.keys(ES.T).filter((k) => !used.has(k));
check("nothing in the dictionary is unused", unused.length === 0, unused.join(" | "));

// ---- page text
const keys = new Set();
for (const f of ["index.html", "about.html"]) {
  const h = fs.readFileSync(R + f, "utf8");
  for (const m of h.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of h.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => keys.add(p.split("=")[1]));
  check(f + " loads the Spanish dictionary, then the switch, and has the language button", /<script src="i18n-es\.js"><\/script>\s*<script src="i18n\.js"><\/script>/.test(h) && h.includes('id="langBtn"'));
  const lost = [];
  for (const m of h.matchAll(/<([a-z0-9]+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) if (ES.H[m[2]] != null && ids(m[3]) && !ids(m[3]).split(",").every((i) => ES.H[m[2]].includes('id="' + i + '"'))) lost.push(m[2]);
  check(f + ": translated text keeps the ids the scripts fill in", lost.length === 0, lost.join(" "));
}
check("every marked element has a Spanish version (" + keys.size + " keys)", [...keys].every((k) => ES.H[k] != null), [...keys].filter((k) => ES.H[k] == null).join(" "));
check("every Spanish page text is used", Object.keys(ES.H).every((k) => keys.has(k)), Object.keys(ES.H).filter((k) => !keys.has(k)).join(" "));
check("the Spanish page text keeps the English markup", [...keys].every((k) => {
  const h = fs.readFileSync(R + "index.html", "utf8") + fs.readFileSync(R + "about.html", "utf8");
  const m = new RegExp('<([a-z0-9]+)[^>]*\\sdata-i18n="' + k.replace(/\./g, "\\.") + '"[^>]*>([\\s\\S]*?)</\\1>').exec(h);
  return !m || m[2].includes("<" + m[1]) || tags(m[2]) === tags(ES.H[k]);   // (an element nesting its own tag is checked by the id check above)
}), [...keys].filter((k) => { const h = fs.readFileSync(R + "index.html", "utf8") + fs.readFileSync(R + "about.html", "utf8"); const m = new RegExp('<([a-z0-9]+)[^>]*\\sdata-i18n="' + k.replace(/\./g, "\\.") + '"[^>]*>([\\s\\S]*?)</\\1>').exec(h); return m && !m[2].includes("<" + m[1]) && tags(m[2]) !== tags(ES.H[k]); }).join(" "));

// ---- the model's validation messages
const msgs = new Set();
[{ dt: 1 }, { weeks: 2 }, { demand: 0 }, { pattern: "x" }, { qaTime: 0 }, { retailTier: true, transitTime: 0 }, { rejectRate: 100 }, { shelfLife: 10, minRemaining: 8 }, { supplyLineWeight: 2 }, { coverage: 1 }, { ceiling: 90 }]
  .concat([{ pattern: "history", history: [1] }, { allocation: "x" }, { criticalShare: 120 }, { apiTier: true, apiCoverage: 0.5 }, { qaCapacity: 90 }, { campaignWeeks: -1 }, { campaignWeeks: 1, changeoverDays: 3 }])
  .forEach((o) => M.validate(M.merge(o)).forEach((m) => msgs.add(m)));
[Object.assign({}, M.PRESETS.shortLife.values, { campaignWeeks: 4 }), Object.assign({}, M.PRESETS.shortLife.values, { coverage: 7 }), { apiTier: true, apiOutage: true, apiOutageWeek: 100 }, { outage: true, outageWeek: 102 }]
  .forEach((o) => M.warnings(M.merge(o)).forEach((m) => msgs.add(m)));
const tw = (m) => ES.P.reduce((s, p) => s.replace(new RegExp(p[0], "g"), p[1]), m);
const left = [...msgs].filter((m) => tw(m) === m);
check("every validation and warning message is translated (" + msgs.size + " messages)", msgs.size >= 22 && left.length === 0, left.join(" | "));

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
