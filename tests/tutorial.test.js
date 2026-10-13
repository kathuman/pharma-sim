// PharmaSim tutorial checks — run with: node tests/tutorial.test.js
// Every question's claim holds in the model for the scenario its step sets up, every step points at something that
// exists, quotes only known numbers and has a Spanish version with the same shape.
const fs = require("fs"), path = require("path");
const M = require("../src/model.js"), S = require("../src/specs.js"), C = require("../tour-content.js"), ES = require("../tour-content-es.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const run = (preset, v) => M.run(Object.assign({}, M.PRESETS[preset].values, v || {})).kpi;

// ---- the claims the questions make
const CLAIMS = {
  "step-overshoot": () => { const r = M.run(M.PRESETS.step.values), newLevel = 12500 / 0.98; return Math.max(...r.rows.map((x) => x.production)) > newLevel * 1.05 && r.kpi.bullwhip > 1; },
  "step-overtime-fill": () => run("step", { overtime: true }).fillRate > run("step").fillRate && run("step", { overtime: true }).shortWeeks < run("step").shortWeeks,
  "qa-longer-bigger-bw": () => run("step", { qaTime: 6 }).bullwhip > run("step").bullwhip,
  "shortlife-overtime-waste": () => run("shortLife", { overtime: true }).wasteUnits > run("shortLife").wasteUnits,
  "tier-supply-line-beats-sharing": () => run("twoTier", { supplyLineWeight: 1 }).orderBullwhip < run("twoTier", { shareDemand: true }).orderBullwhip,
  "outage-expedite-tradeoff": () => { const a = run("outage"), b = run("outage", { expediteQA: true }); return b.fillRate > a.fillRate && b.rejectedUnits > a.rejectedUnits && b.expedited > 0; },
  "outage-expedite-needs-penalty": () => run("outage", { expediteQA: true }).profit > run("outage").profit && run("outage", { expediteQA: true, shortagePenalty: 0 }).profit < run("outage", { shortagePenalty: 0 }).profit,
  "step-cover-six-full-service": () => run("step", { coverage: 6 }).shortWeeks === 0 && run("step", { coverage: 6 }).fillRate > 0.999
};
// the statements the step texts make about the scenarios they show
const STATEMENTS = [
  ["supply-line weight lowers the bullwhip with a six-week QA", () => run("step", { qaTime: 6, supplyLineWeight: 1 }).bullwhip < run("step").bullwhip],
  ["the short-life surge leaves written-off stock", () => run("shortLife").expiredUnits > 1000],
  ["counting the QA pipeline cuts short-life waste", () => run("shortLife", { supplyLineWeight: 1 }).wasteUnits < run("shortLife").wasteUnits],
  ["overtime raises profit for the short-life product (the trade-off is waste, not money)", () => run("shortLife", { overtime: true }).profit > run("shortLife").profit],
  ["overtime raises profit for the demand step", () => run("step", { overtime: true }).profit > run("step").profit],
  ["a distributor amplifies at each tier (orders > demand, production > 1)", () => { const k = run("twoTier"); return k.orderBullwhip > 1.5 && k.bullwhip > 1; }],
  ["sharing sales data calms the plant but barely the distributor", () => { const a = run("twoTier"), b = run("twoTier", { shareDemand: true }); return b.bullwhip < a.bullwhip && Math.abs(b.orderBullwhip - a.orderBullwhip) < 0.1; }],
  ["the outage causes shortage weeks", () => run("outage").shortWeeks > 0 && run("outage").lost > 0],
  ["the step causes shortage weeks at the defaults", () => run("step").shortWeeks > 0]
];
const ids = new Set();
C.LEVELS.forEach((l) => l.steps.forEach((s) => { if (s.quiz) ids.add(s.quiz.claim); }));
check("every claim a question makes has a check", [...ids].every((c) => CLAIMS[c]), [...ids].filter((c) => !CLAIMS[c]).join(" "));
Object.keys(CLAIMS).forEach((c) => check("claim holds: " + c, CLAIMS[c]()));
STATEMENTS.forEach(([n, f]) => check("statement holds: " + n, f()));

// ---- structure
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const exists = (sel) => {
  if (/^#c_/.test(sel)) return !!S.BY_KEY[sel.slice(3)];
  if (/^#g_/.test(sel)) return S.GROUPS.some((g) => g.id === sel.slice(3));
  return html.includes('id="' + sel.slice(1) + '"');
};
C.LEVELS.forEach((l) => {
  check(l.id + ": has steps and a blurb", l.steps.length >= 8 && l.blurb && l.minutes > 0);
  l.steps.forEach((s) => {
    const st = s.setup || {};
    check(s.id + ": points at an element that exists (" + s.target + ")", exists(s.target));
    check(s.id + ": sets up a preset that exists", st.preset && M.PRESETS[st.preset]);
    check(s.id + ": its inputs are model inputs", Object.keys(st.values || {}).concat(Object.keys(st.baselineValues || {})).every((k) => k in M.DEFAULTS));
    const toks = [...(s.body + (s.quiz ? s.quiz.explain : "")).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    check(s.id + ": quotes only known numbers", toks.every((t) => C.TOKENS.includes(t)), toks.join(" "));
    check(s.id + ": d-numbers only with a baseline", toks.every((t) => t[0] !== "d" || st.baseline === "save"));
    if (s.quiz) check(s.id + ": the answer is one of the options", s.quiz.answer >= 0 && s.quiz.answer < s.quiz.options.length);
    if (st.open) check(s.id + ": opens an element that exists", exists(st.open));
    if (st.values) check(s.id + ": the scenario runs", M.run(Object.assign({}, M.PRESETS[st.preset].values, st.values)).ok);
  });
});

// ---- Spanish
const tags = (x) => [...String(x).matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort().join(",");
const toks = (x) => [...String(x).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
C.LEVELS.forEach((l) => {
  const lt = ES.levels[l.id];
  check(l.id + ": Spanish title and blurb", lt && lt.title && lt.blurb);
  l.steps.forEach((s) => {
    const e = ES.steps[s.id];
    check(s.id + ": Spanish title and text with the same numbers and markup", e && e.title && e.body && toks(e.body) === toks(s.body) && tags(e.body) === tags(s.body), e ? toks(e.body) + " / " + tags(e.body) : "missing");
    if (s.quiz) check(s.id + ": Spanish question with the same number of options", e && e.quiz && e.quiz.q && e.quiz.options.length === s.quiz.options.length && e.quiz.explain && toks(e.quiz.explain) === toks(s.quiz.explain));
  });
});
const allIds = new Set(); C.LEVELS.forEach((l) => l.steps.forEach((s) => allIds.add(s.id)));
check("no Spanish step for a step that does not exist", Object.keys(ES.steps).every((k) => allIds.has(k)), Object.keys(ES.steps).filter((k) => !allIds.has(k)).join(" "));

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
