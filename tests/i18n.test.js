// Supply Pulse translation checks (Spanish and Danish) — run with: node tests/i18n.test.js
// For each language: every string the scripts translate, every control, equation and preset text, every element the
// pages mark and every validation, warning and data-import message has a version with the same placeholders and
// markup, and nothing in the dictionary is unused. The pages load every dictionary and the language picker.
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..") + path.sep;
const DICTS = { Spanish: require("../i18n-es.js"), Danish: require("../i18n-da.js") };
const M = require("../src/model.js"), S = require("../src/specs.js"), E = require("../src/equations.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort().join(",");
const ids = (s) => [...String(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1]).sort().join(",");
const PAGES = ["index.html", "about.html", "play.html", "report.html"];
const html = PAGES.map((f) => fs.readFileSync(R + f, "utf8"));

// ---- what is translated
const used = new Set();
for (const f of ["app.js", "tour.js", "lab.js", "play.js", "src/diagram.js", "src/charts.js", "report.js"]) for (const m of fs.readFileSync(R + f, "utf8").matchAll(/\bT\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) used.add(m[1] === '"' ? JSON.parse('"' + m[2] + '"') : m[2].replace(/\\'/g, "'"));
S.GROUPS.forEach((g) => { used.add(g.title); g.controls.forEach((c) => { used.add(c.label); if (c.note) used.add(c.note); if (c.unit) used.add(c.unit); if (c.zero) used.add(c.zero); (c.options || []).forEach((o) => used.add(o[1])); }); });
E.SECTIONS.forEach((s) => { used.add(s.title); s.items.forEach((i) => { used.add(i.name); used.add(i.eq); if (i.note) used.add(i.note); if (i.u && i.u[0] !== "$") used.add(i.u); }); });
Object.values(M.PRESETS).forEach((p) => used.add(p.label));
Object.values(require("../src/analysis.js").KPIS).forEach((k) => used.add(k.label));
const keys = new Set();
html.forEach((h) => {
  for (const m of h.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of h.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => keys.add(p.split("=")[1]));
});
const msgs = new Set();
[{ dt: 1 }, { weeks: 2 }, { demand: 0 }, { pattern: "x" }, { qaTime: 0 }, { retailTier: true, transitTime: 0 }, { rejectRate: 100 }, { shelfLife: 10, minRemaining: 8 }, { supplyLineWeight: 2 }, { coverage: 1 }, { ceiling: 90 },
  { pattern: "history", history: [1] }, { allocation: "x" }, { criticalShare: 120 }, { ingTier: true, ingCoverage: 0.5 }, { qaCapacity: 90 }, { campaignWeeks: -1 }, { campaignWeeks: 1, changeoverDays: 3 }]
  .forEach((o) => M.validate(M.merge(o)).forEach((m) => msgs.add(m)));
[Object.assign({}, M.PRESETS.shortLife.values, { campaignWeeks: 4 }), Object.assign({}, M.PRESETS.shortLife.values, { coverage: 7 }), { ingTier: true, ingOutage: true, ingOutageWeek: 100 }, { outage: true, outageWeek: 102 }]
  .forEach((o) => M.warnings(M.merge(o)).forEach((m) => msgs.add(m)));
{
  const Dd = require("../src/data.js"), wk = (v) => "week,demand\n" + v.map((x, i) => (i + 1) + "," + x).join("\n");
  const daily = ["date,orders"]; for (let d = 0; d < 69; d++) daily.push(new Date(Date.UTC(2026, 0, 5 + d)).toISOString().slice(0, 10) + ",100");
  [wk([1]), "x,y\na,b\nc,d", wk([1, 2, 3]), wk([0, 0, 0, 0, 1, 1, 1, 1, 1]), wk([5, "", 5, "x", 5, 5, 5, 5, 5, 5]), wk([5, "", 5, 5, 5, 5, 5, 5, 5]), "a,b,c\n" + Array.from({ length: 9 }, (_, i) => "q,r," + (9 + i)).join("\n"), daily.join("\n"), wk(Array(530).fill(5)), ""]
    .forEach((t) => { const h = Dd.read(t); (h.errors || []).concat(h.notes || []).forEach((m) => msgs.add(m)); });
}

// ---- each language
for (const [name, D] of Object.entries(DICTS)) {
  const missing = [...used].filter((s) => D.T[s] == null);
  check(name + ": every string has a version (" + used.size + " strings)", missing.length === 0, missing.map((s) => JSON.stringify(s)).join(" | "));
  const bad = [...used].filter((s) => D.T[s] != null && (ph(s) !== ph(D.T[s]) || tags(s) !== tags(D.T[s])));
  check(name + ": …with the same {placeholders} and markup", bad.length === 0, bad.join(" | "));
  const unused = Object.keys(D.T).filter((k) => !used.has(k));
  check(name + ": nothing in the dictionary is unused", unused.length === 0, unused.join(" | "));
  check(name + ": every marked element has a version (" + keys.size + " keys)", [...keys].every((k) => D.H[k] != null), [...keys].filter((k) => D.H[k] == null).join(" "));
  check(name + ": every page text is used", Object.keys(D.H).every((k) => keys.has(k)), Object.keys(D.H).filter((k) => !keys.has(k)).join(" "));
  const lost = [], markup = [];
  html.forEach((h) => {
    for (const m of h.matchAll(/<([a-z0-9]+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      const tr = D.H[m[2]]; if (tr == null) continue;
      if (ids(m[3]) && !ids(m[3]).split(",").every((i) => tr.includes('id="' + i + '"'))) lost.push(m[2]);
      if (!m[3].includes("<" + m[1]) && tags(m[3]) !== tags(tr)) markup.push(m[2]);   // (an element nesting its own tag is covered by the id check)
    }
  });
  check(name + ": translated page text keeps the ids the scripts fill in", lost.length === 0, lost.join(" "));
  check(name + ": translated page text keeps the English markup", markup.length === 0, markup.join(" "));
  const tw = (m) => D.P.reduce((s, p) => s.replace(new RegExp(p[0], "g"), p[1]), m);
  const left = [...msgs].filter((m) => tw(m) === m);
  check(name + ": every validation, warning and data-import message is translated (" + msgs.size + " messages)", msgs.size >= 32 && left.length === 0, left.join(" | "));
  check(name + ": the same message patterns as the other languages", D.P.length === DICTS.Spanish.P.length && D.P.every((p, i) => p[0] === DICTS.Spanish.P[i][0]));
}

// ---- the pages
PAGES.forEach((f, i) => check(f + " loads the Spanish and Danish dictionaries, then the switch, and has the language picker",
  /<script src="i18n-es\.js"><\/script>\s*<script src="i18n-da\.js"><\/script>\s*<script src="i18n\.js"><\/script>/.test(html[i]) && html[i].includes('id="langSel"') && !html[i].includes("langBtn")));
check("the simulator loads the Danish tutorial", /<script src="tour-content-da\.js"><\/script>/.test(html[0]));

// ---- one version everywhere
{
  const v = (f, re) => (re.exec(fs.readFileSync(R + f, "utf8")) || [])[1];
  const app = v("app.js", /APP_VERSION = "([\d.]+)"/);
  const vs = [v("play.js", /APP_VERSION = "([\d.]+)"/), v("report.js", /APP_VERSION = "([\d.]+)"/), v("about.html", /id="cite-ver">([\d.]+)</), v("about.html", /Supply Pulse v([\d.]+) ·/)];
  ["i18n-es.js", "i18n-da.js"].forEach((f) => { vs.push((/cite-ver\\">([\d.]+)</.exec(fs.readFileSync(R + f, "utf8")) || [])[1], v(f, /Supply Pulse v([\d.]+) ·/)); });
  check("every page and every translation show the same version (" + app + ")", !!app && vs.every((x) => x === app), vs.join(" "));
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
