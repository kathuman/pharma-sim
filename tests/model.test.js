// PharmaSim model tests — run with: node tests/model.test.js
// Balance, conservation of every pack, the same answers for a smaller time step, the noise, the exact forecast
// response, first-in-first-out shelf life, and the trade-offs each lever is meant to show.
const M = require("../src/model.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const calm = { pattern: "none", noise: 0 };
const last = (r) => r.rows[r.rows.length - 1];

// ---- balance: with nothing happening, nothing moves, for every structure and lever
const structures = [{}, { retailTier: true }, { retailTier: true, supplyLineWeight: 1 }, { supplyLineWeight: 1 }, { overtime: true, expediteQA: true }, { retailTier: true, shareDemand: true }, M.PRESETS.shortLife.values, { dt: 0.1 }];
structures.forEach((s) => {
  const r = M.run(Object.assign({}, s, calm)), z = last(r), p = r.params;
  const P0 = p.demand / (1 - p.rejectRate / 100);
  check("in balance with no shock: " + JSON.stringify(s), r.ok && r.rows.every((x) => near(x.inventory, p.demand * p.coverage, 1e-9) && near(x.production, P0, 1e-9) && near(x.workforce, P0 / p.productivity, 1e-9) && near(x.served, p.demand, 1e-9))
    && near(z.distInventory, r.multi ? p.demand * p.distCoverage : 0, 1e-9) && r.kpi.expiredUnits < 1e-6 && r.kpi.bullwhip === null, JSON.stringify({ inv: z.inventory, P: z.production, W: z.workforce }));
});

// ---- conservation of packs, in every scenario
const scenarios = [{}, { retailTier: true }, M.PRESETS.flu.values, M.PRESETS.shortLife.values, M.PRESETS.outage.values, Object.assign({}, M.PRESETS.outage.values, { expediteQA: true, overtime: true }), { retailTier: true, supplyLineWeight: 1, noise: 15, seed: 7 }];
scenarios.forEach((s) => {
  const r = M.run(s), a = r.totals, st = r.start, en = r.end;
  const qa = a.produced - (a.approved + a.rejected) - (en.qa - st.qa);
  const fg = a.approved - a.shippedMfg - a.expired - (en.inv - st.inv);
  const mkt = a.demand - a.served - a.lost;
  const dist = r.multi ? a.shippedMfg - a.served - (en.dist - st.dist) - (en.transit - st.transit) : 0;
  check("every pack accounted for (QA, finished goods, distributor, market): " + JSON.stringify(s).slice(0, 60), [qa, fg, mkt, dist].every((x) => Math.abs(x) < 1e-6 * a.demand), [qa, fg, mkt, dist].map((x) => x.toExponential(1)).join(" "));
  check("…and no stock goes negative", r.rows.every((x) => x.inventory >= -1e-9 && x.qa >= -1e-9 && x.distInventory >= -1e-9 && x.backlog >= -1e-9 && x.workforce > 0));
});

// ---- a smaller time step gives the same answers (the integration converges)
[{ noise: 0 }, { noise: 0, retailTier: true }, Object.assign({ noise: 0 }, M.PRESETS.outage.values, { overtime: true, expediteQA: true }), Object.assign({ noise: 0 }, M.PRESETS.flu.values)].forEach((s) => {
  const a = M.run(Object.assign({}, s, { dt: 0.25 })).kpi, b = M.run(Object.assign({}, s, { dt: 0.0625 })).kpi;
  check("dt 0.25 and 0.0625 agree: " + JSON.stringify(s).slice(0, 60), near(a.profit, b.profit, 0.01) && Math.abs(a.fillRate - b.fillRate) < 0.002 && near(a.peakProduction, b.peakProduction, 0.01), [a.profit, b.profit, a.fillRate, b.fillRate].map((x) => x.toFixed(4)).join(" "));
});
{
  const a = M.run(Object.assign({ noise: 0, dt: 0.25 }, M.PRESETS.shortLife.values)).kpi.expiredUnits, b = M.run(Object.assign({ noise: 0, dt: 0.0625 }, M.PRESETS.shortLife.values)).kpi.expiredUnits;
  check("expiry agrees between time steps within 15%", a > 0 && near(a, b, 0.15), a.toFixed(0) + " vs " + b.toFixed(0));
}

// ---- noise: the chosen size, for any time step; the same seed gives the same future
for (const dt of [0.25, 0.0625]) {
  let s = 0; for (let seed = 1; seed <= 20; seed++) s += M.std(M.run({ pattern: "none", noise: 10, dt, seed, weeks: 520 }).rows.map((x) => x.demand)) / 10000;
  check("demand noise has the chosen size (10%) at dt " + dt, Math.abs(s / 20 - 0.10) < 0.01, (s / 20 * 100).toFixed(2) + "%");
}
{
  const a = M.run({ seed: 3 }), b = M.run({ seed: 3, overtime: true, supplyLineWeight: 1 }), c = M.run({ seed: 4 });
  check("the same seed gives the same market demand whatever the policy (fair comparisons)", a.rows.every((x, i) => x.demand === b.rows[i].demand));
  check("another seed gives another future", a.rows.some((x, i) => x.demand !== c.rows[i].demand));
  check("runs are repeatable", M.run({ seed: 3 }).kpi.profit === a.kpi.profit);
}

// ---- the forecast is exactly first-order smoothing of orders: F(t) = D1 − (D1 − D0)·e^(−(t − t0)/τ)
{
  const r = M.run({ noise: 0, shockWeek: 10, shockSize: 20 }), p = r.params, worst = r.rows.filter((x) => x.t >= 10).reduce((m, x) => {
    const tt = x.t - 10 + p.dt, exact = 12000 - 2000 * Math.exp(-tt / p.forecastTime);
    return Math.max(m, Math.abs(x.forecast - exact));
  }, 0);
  check("the forecast follows the exact exponential smoothing of demand", worst < 1e-6, worst);
}

// ---- the headline metrics
{
  const r = M.run({ noise: 0 }), k = r.kpi;
  check("a demand step is amplified (bullwhip > 1) and measured against demand's own swing", k.bullwhip > 1.2, k.bullwhip);
  check("…and production overshoots the new level of demand", k.peakProduction > 12500 / 0.98, k.peakProduction);
  check("the plant ceiling holds", r.rows.every((x) => x.production <= 10000 / 0.98 * 1.4 + 1e-6));
  check("a short shock is smoothed, not amplified (bullwhip < 1 for a pulse)", M.run({ noise: 0, pattern: "pulse", shockSize: 40, pulseWeeks: 16 }).kpi.bullwhip < 1);
  check("service slips before stock runs out: a demand step costs some sales at the default cover", k.fillRate < 1 && k.fillRate > 0.98 && k.shortWeeks > 0, k.fillRate);
  const nz = { pattern: "none", noise: 10, weeks: 520 }, n0 = M.run(nz).kpi.bullwhip, n1 = M.run(Object.assign({}, nz, { supplyLineWeight: 1 })).kpi.bullwhip, n2 = M.run(Object.assign({}, nz, { invAdjTime: 12 })).kpi.bullwhip;
  check("even noise alone is amplified by a fast correction that ignores the supply line", n0 > 1.05, n0);
  check("…and counting the supply line, or correcting more slowly, damps it", n1 < n0 - 0.05 && n2 < 1, n1 + " / " + n2);
}

// ---- the levers and their trade-offs
{
  const base = M.run({ noise: 0 }).kpi, ot = M.run({ noise: 0, overtime: true }).kpi;
  check("overtime covers the demand step: more served, more profit for a profitable medicine", ot.fillRate > base.fillRate && ot.profit > base.profit && ot.otUnits > 0);
  const sl = Object.assign({ noise: 0 }, M.PRESETS.shortLife.values), b = M.run(sl).kpi, o = M.run(Object.assign({}, sl, { overtime: true })).kpi, w = M.run(Object.assign({}, sl, { supplyLineWeight: 1 })).kpi;
  check("short shelf life: a surge leaves stock that expires", b.expiredUnits > 1000, b.expiredUnits);
  check("…overtime makes that waste worse (it builds stock that cannot be sold in time)", o.expiredUnits > b.expiredUnits * 1.2, o.expiredUnits);
  check("…counting the QA pipeline (supply-line weight 1) cuts it", w.expiredUnits < b.expiredUnits * 0.9, w.expiredUnits);
  const out = Object.assign({ noise: 0 }, M.PRESETS.outage.values), x0 = M.run(out).kpi, x1 = M.run(Object.assign({}, out, { expediteQA: true })).kpi;
  check("an outage causes shortages; expediting QA recovers service sooner", x0.fillRate < 0.995 && x1.fillRate > x0.fillRate && x1.expedited > 0, x0.fillRate + " → " + x1.fillRate);
  check("…at the price of more rejected batches and an expediting cost", x1.rejectedUnits > x0.rejectedUnits && M.run(Object.assign({}, out, { expediteQA: true })).totals.cExpedite > 0);
  check("expediting never triggers while stock stays near target", M.run({ pattern: "none", noise: 0, expediteQA: true }).kpi.expedited === 0);
  const t0 = M.run({ noise: 0, retailTier: true }).kpi, t1 = M.run({ noise: 0, retailTier: true, supplyLineWeight: 1 }).kpi, t2 = M.run({ noise: 0, retailTier: true, shareDemand: true }).kpi;
  check("a distributor amplifies orders (order bullwhip > 1.5)", t0.orderBullwhip > 1.5, t0.orderBullwhip);
  check("…counting what is already on order cuts that amplification", t1.orderBullwhip < t0.orderBullwhip * 0.8, t1.orderBullwhip);
  check("…sharing market demand with the manufacturer lowers production's amplification", t2.bullwhip < t0.bullwhip, t2.bullwhip + " vs " + t0.bullwhip);
  check("a higher shortage penalty lowers profit only when there are shortages", M.run({ noise: 0, shortagePenalty: 100 }).kpi.profit < base.profit && M.run(Object.assign({}, calm, { shortagePenalty: 100 })).kpi.profit === M.run(calm).kpi.profit);
}

// ---- the written-out equations read the model's own output
{
  const E = require("../src/equations.js"), r = M.run({ retailTier: true }), row = r.rows[200];
  const bad = []; E.SECTIONS.forEach((sec) => sec.items.forEach((it) => { if (it.v) { const v = it.v(row, r.params); if (typeof v !== "number" || !isFinite(v)) bad.push(it.name); } }));
  check("every equation with a value reads a number the model produced", bad.length === 0, bad.join(" "));
  const z = r.rows[200];
  check("the documented production rule holds in the output: production = min(desired, capacity)", r.rows.every((x) => Math.abs(x.production - Math.min(x.desired, x.capacity)) < 1e-6));
  check("…and the target stock = forecast × cover", r.rows.every((x) => Math.abs(x.target - x.forecast * r.params.coverage) < 1e-6));
  check("…and released = approved + rejected", r.rows.every((x) => Math.abs(x.released - x.approved - x.rejected) < 1e-6) && z.released > 0);
}

// ---- inputs that cannot work are refused with a reason
[{ dt: 1 }, { pattern: "x" }, { shelfLife: 10, minRemaining: 8 }, { supplyLineWeight: 2 }, { ceiling: 90 }, { coverage: 1 }, { demand: 0 }].forEach((b) => {
  const r = M.run(b); check("refused: " + JSON.stringify(b), !r.ok && r.errors.length > 0, r.errors && r.errors[0]);
});

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
