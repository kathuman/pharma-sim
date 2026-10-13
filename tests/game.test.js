// PharmaSim play-mode tests — run with: node tests/game.test.js
const M = require("../src/model.js"), G = require("../src/game.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

G.SCENARIOS.forEach((s) => check("scenario " + s + " exists and starts", !!M.PRESETS[s] && G.create(s).ok));
{
  const g = G.create("step", { turnWeeks: 2, seed: 3 }), v0 = g.view();
  check("the game starts at week 0 with the planner's view of a balanced plant", v0.week === 0 && !v0.done && Math.abs(v0.orders - 10000) < 1e-9 && Math.abs(v0.rule - 10000 / 0.98) < 1e-6 && v0.capacity > 0);
  let turns = 0; while (!g.done()) { g.play(g.view().rule); turns++; }
  check("a two-year game is 52 two-week turns", turns === 52 && g.plans().length === 52 && g.view().week === 104);
  const c = g.compare();
  check("the comparison runs the rule on the same demand future", c.ruleRows.every((r, i) => r.demand === c.youRows[i].demand));
  check("following the rule's suggestion each turn comes close to the rule itself", Math.abs(c.you.profit - c.rule.profit) < 0.02 * Math.abs(c.rule.profit) && Math.abs(c.you.fillRate - c.rule.fillRate) < 0.01, [c.you.profit, c.rule.profit, c.you.fillRate, c.rule.fillRate].join(" "));
}
{
  // the suggestion is the rule's plan from the last step, held for a turn: the shorter the turn, the closer to the rule
  const gap = (t) => { const g = G.create("flu", { turnWeeks: t, seed: 5 }); while (!g.done()) g.play(g.view().rule); const c = g.compare(); return c.rule.profit - c.you.profit; };
  const g1 = gap(0.25), g2 = gap(1), g4 = gap(4);
  check("following the suggestion with one-step turns is within 0.5% of the rule", Math.abs(g1) < 0.005 * 11e6, g1);
  check("…and holding a plan for longer turns costs more", g1 < g2 && g2 < g4, [g1, g2, g4].map((x) => Math.round(x)).join(" "));
}
{
  const g = G.create("step", { turnWeeks: 4 }); while (!g.done()) g.play(10000 / 0.98);
  const c = g.compare();
  check("ignoring the demand step (a flat plan) loses to the rule on service", c.you.fillRate < c.rule.fillRate - 0.05 && !c.beatsFill && G.verdict(c) !== "both");
  check("…and its plan was followed: production never moved", c.youRows.every((r) => Math.abs(r.production - 10000 / 0.98) < 1e-6));
}
{
  const g = G.create("step", { turnWeeks: 4 }); g.play(-5);
  check("a negative plan is treated as zero", g.result().rows.slice(0, 16).every((r) => r.production === 0));
  const h = G.create("twoTier"), v = h.view();
  check("with a distributor the planner sees the distributor's orders", Math.abs(v.orders - h.params.demand) < 1e-9);
  const a = G.create("apiOutage").view();
  check("with an API supplier the planner sees the API stock", a.apiStock > 0);
  check("verdicts", G.verdict({ you: { profit: 2, fillRate: 0.99 }, rule: { profit: 1, fillRate: 0.98 } }) === "both" && G.verdict({ you: { profit: 0, fillRate: 0.99 }, rule: { profit: 1, fillRate: 0.98 } }) === "service" && G.verdict({ you: { profit: 2, fillRate: 0.97 }, rule: { profit: 1, fillRate: 0.98 } }) === "profit" && G.verdict({ you: { profit: 0, fillRate: 0.97 }, rule: { profit: 1, fillRate: 0.98 } }) === "neither");
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
