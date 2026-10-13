// PharmaSim analysis tests — run with: node tests/analysis.test.js
// Many futures, head-to-head comparisons, the tornado, the sweep and the policy search, checked against direct runs.
const M = require("../src/model.js"), A = require("../src/analysis.js"), S = require("../src/specs.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const step = M.PRESETS.step.values;

// ---- many futures
{
  const f = A.futures(step, 40);
  check("futures: one run per seed, each the same as a direct run", f.ok && f.runs.length === 40 && f.runs[7].profit === M.run(Object.assign({}, step, { seed: f.seeds[7] })).kpi.profit);
  check("…quantiles are ordered (p10 ≤ p50 ≤ p90) for every result", Object.values(f.summary).every((q) => !q || (q.p10 <= q.p50 + 1e-9 && q.p50 <= q.p90 + 1e-9)));
  check("…weekly bands are ordered and one per week", f.bands.length === 104 && f.bands.every((b) => b.fillLo <= b.fillMid + 1e-9 && b.fillMid <= b.fillHi + 1e-9 && b.productionLo <= b.productionHi + 1e-9));
  check("…the shortage chance is the share of futures with a week short", Math.abs(f.shortageChance - f.runs.filter((k) => k.shortWeeks > 0).length / 40) < 1e-12);
  const calm = A.futures(Object.assign({}, step, { noise: 0 }), 10);
  check("without noise every future is the same: no spread", Object.values(calm.summary).every((q) => !q || Math.abs(q.p90 - q.p10) < 1e-6 * Math.max(1, Math.abs(q.p50))));
  const ot = A.futures(Object.assign({}, step, { overtime: true }), 40), h = A.headToHead(ot, f, "profit");
  check("head to head: overtime beats no overtime on profit in (nearly) every future of the step", h.n === 40 && h.wins >= 38, h.wins);
  check("…and a scenario never beats itself", A.headToHead(f, f, "profit").wins === 0 && A.headToHead(f, f, "profit").ties === 40);
  check("…weeks short count as better when fewer", A.headToHead(ot, f, "shortWeeks").wins >= 35);
  check("an impossible scenario is refused", !A.futures({ ceiling: 50 }, 5).ok);
}

// ---- tornado and sweep
{
  const p = M.merge(step), t = A.tornado(p, "profit", 0.2, S);
  check("tornado: the bars are sorted by swing", t.ok && t.bars.every((b, i) => i === 0 || t.bars[i - 1].swing >= b.swing));
  const price = t.bars.find((b) => b.key === "price");
  check("…price moves profit up when it goes up", price && price.atHi > t.base && price.atLo < t.base);
  check("…each end is a direct run with that input changed", Math.abs(price.atHi - M.run(Object.assign({}, p, { price: price.hi })).kpi.profit) < 1e-6);
  check("…inputs stay inside their slider ranges", t.bars.every((b) => { const c = S.BY_KEY[b.key]; return !c || (b.lo >= c.min - 1e-9 && b.hi <= c.max + 1e-9); }));
  check("…an input set to zero is moved within its range instead", A.tornado(p, "bullwhip", 0.2, S).bars.some((b) => b.key === "supplyLineWeight" && b.hi > 0));
  const f = A.tornado(p, "fillRate", 0.2, S);
  check("…for the fill rate on the step, plant capacity matters most", f.bars[0].key === "ceiling", f.bars[0].key);
  const sw = A.sweep(p, "price", "profit", 10, 60, 6);
  check("sweep: six points from end to end, profit rising with price", sw.length === 6 && sw[0].x === 10 && sw[5].x === 60 && sw.every((s, i) => i === 0 || s.y > sw[i - 1].y));
}

// ---- the policy search
{
  const p = M.merge(step), grid = { coverage: [3, 4, 6], supplyLineWeight: [0, 1], overtime: [false, true] };
  const c = A.candidates(p, grid);
  check("candidates: every combination of the grid", c.length === 12 && new Set(c.map((x) => JSON.stringify(x))).size === 12);
  check("…and no cover below the cover needed for full service", A.candidates(Object.assign({}, p, { serviceCover: 3.5 }), grid).every((x) => x.coverage >= 3.5));
  const o = A.optimise(p, { grid, futures: 6, minFill: 0.995 });
  check("optimiser: evaluates every candidate", o.evaluated === 12);
  check("…the best meets the service target, and is ranked by profit", o.best.length > 0 && o.best.every((b) => b.mean.fillRate >= 0.995) && o.best.every((b, i) => i === 0 || o.best[i - 1].mean.profit >= b.mean.profit));
  const best = o.best[0], direct = A.evaluate(p, best.policy, o.seeds);
  check("…its results are a direct evaluation over the same futures", Math.abs(direct.profit - best.mean.profit) < 1e-6);
  const dflt = A.evaluate(p, {}, o.seeds);
  check("…it is at least as good as the default policy whenever that meets the target", dflt.fillRate < 0.995 || best.mean.profit >= dflt.profit - 1e-6);
  check("…the frontier: no policy beats a frontier policy on both profit and fill", o.front.every((f) => !o.all.some((x) => x.mean.profit > f.mean.profit + 1e-9 && x.mean.fillRate > f.mean.fillRate + 1e-12)));
  check("…and the best feasible policy is on the frontier", o.front.includes(best));
  const sliced = A.optimiser(p, { grid, futures: 6, minFill: 0.995 }); let calls = 0; while (!sliced.done()) { sliced.step(5); calls++; }
  check("…run in slices it gives the same answer", calls === 3 && JSON.stringify(sliced.result().best[0].policy) === JSON.stringify(best.policy));
  const tough = A.optimise(p, { grid, futures: 4, minFill: 1.01 });
  check("…an impossible target leaves no feasible policy", tough.feasible === 0 && tough.best.length === 0);
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
