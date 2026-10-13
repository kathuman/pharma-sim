// Supply Pulse — decision analysis on top of the model (window.SPAnalysis / module.exports): many demand futures at once,
// a tornado of which inputs matter most, a sweep of one input, and a search for the best planning policy. Every
// comparison uses the same random futures (seeds) for every option, so differences are never luck. Pure: no DOM.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.SPAnalysis = factory(root.SPModel);
})(typeof self !== "undefined" ? self : this, function (M) {
  "use strict";
  // the results the tools can measure, and whether more is better
  var KPIS = {
    profit: { label: "Profit", better: 1 },
    fillRate: { label: "Fill rate", better: 1 },
    criticalFill: { label: "Priority customers served", better: 1 },
    shortWeeks: { label: "Weeks short", better: -1 },
    bullwhip: { label: "Bullwhip", better: -1 },
    wasteUnits: { label: "Waste", better: -1 },
    avgInventory: { label: "Average stock", better: -1 }
  };
  // the inputs the tornado varies (each up and down by the same share, within its slider range)
  var TORNADO = ["coverage", "forecastTime", "invAdjTime", "wfAdjTime", "supplyLineWeight", "qaTime", "rejectRate", "ceiling", "shelfLife", "noise", "price", "material", "wage", "holding", "shortagePenalty"];

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function seeds(n, first) { var s = []; for (var i = 0; i < n; i++) s.push((first || 1) + i); return s; }
  function withSeed(p, seed) { var o = {}; for (var k in p) o[k] = p[k]; o.seed = seed; return o; }

  // run the scenario in n futures; summary: quantiles of each result, the chance of a shortage, and weekly bands
  function futures(params, n, opts) {
    opts = opts || {};
    var ss = seeds(n, opts.firstSeed), runs = [], weekly = null;
    for (var i = 0; i < ss.length; i++) {
      var r = M.run(withSeed(params, ss[i])); if (!r.ok) return { ok: false, errors: r.errors };
      runs.push(r.kpi);
      // weekly fill rate and production of each future, for the bands
      var per = Math.round(1 / r.params.dt), wf = [], wp = [], wi = [];
      for (var k = 0; k + per <= r.rows.length; k += per) {
        var d = 0, s = 0, pr = 0, inv = 0;
        for (var j = k; j < k + per; j++) { d += r.rows[j].demand; s += r.rows[j].served; pr += r.rows[j].production; inv += r.rows[j].inventory; }
        wf.push(d > 0 ? 100 * s / d : 100); wp.push(pr / per); wi.push(inv / per);
      }
      if (!weekly) weekly = wf.map(function () { return { fill: [], production: [], inventory: [] }; });
      wf.forEach(function (v, w) { weekly[w].fill.push(v); weekly[w].production.push(wp[w]); weekly[w].inventory.push(wi[w]); });
    }
    var summary = {};
    Object.keys(KPIS).forEach(function (key) {
      var xs = runs.map(function (k) { return k[key]; }).filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; });
      summary[key] = xs.length ? { p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), mean: xs.reduce(function (a, b) { return a + b; }, 0) / xs.length } : null;
    });
    var bands = weekly.map(function (w, i) {
      var o = { t: i };
      ["fill", "production", "inventory"].forEach(function (key) { var xs = w[key].slice().sort(function (a, b) { return a - b; }); o[key + "Lo"] = quantile(xs, 0.1); o[key + "Mid"] = quantile(xs, 0.5); o[key + "Hi"] = quantile(xs, 0.9); });
      return o;
    });
    return {
      ok: true, n: n, seeds: ss, runs: runs, summary: summary, bands: bands,
      shortageChance: runs.filter(function (k) { return k.shortWeeks > 0; }).length / n,
      below98: runs.filter(function (k) { return k.fillRate < 0.98; }).length / n
    };
  }
  // in how many of the same futures one scenario beats another on a result
  function headToHead(a, b, key) {
    var better = KPIS[key].better, wins = 0, ties = 0;
    for (var i = 0; i < Math.min(a.runs.length, b.runs.length); i++) {
      var x = a.runs[i][key], y = b.runs[i][key];
      if (x == null || y == null) continue;
      if (Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y))) ties++; else if ((x - y) * better > 0) wins++;
    }
    return { wins: wins, ties: ties, n: Math.min(a.runs.length, b.runs.length) };
  }

  // each input moved down and up by `share` (0.2 = ±20%), one at a time, within its range; sorted by the swing
  function tornado(params, key, share, specs, keys) {
    share = share == null ? 0.2 : share;
    var base = M.run(params); if (!base.ok) return { ok: false, errors: base.errors };
    var b0 = base.kpi[key], bars = [];
    (keys || TORNADO).forEach(function (k) {
      var c = specs && specs.BY_KEY[k], v = params[k] != null ? params[k] : M.DEFAULTS[k];
      if (typeof v !== "number" || (c && c.show && !c.show(M.merge(params)))) return;
      var clamp = function (x) { return c ? Math.max(c.min, Math.min(c.max, x)) : x; };
      var lo = clamp(v * (1 - share)), hi = clamp(v * (1 + share));
      if (v === 0) { lo = clamp(0); hi = clamp(c ? c.min + (c.max - c.min) * share : share); }
      var pl = {}, ph = {}, kk; for (kk in params) { pl[kk] = params[kk]; ph[kk] = params[kk]; }
      pl[k] = lo; ph[k] = hi;
      var rl = M.run(pl), rh = M.run(ph);
      if (!rl.ok || !rh.ok || rl.kpi[key] == null || rh.kpi[key] == null) return;
      bars.push({ key: k, lo: lo, hi: hi, atLo: rl.kpi[key], atHi: rh.kpi[key], swing: Math.abs(rh.kpi[key] - rl.kpi[key]) });
    });
    bars.sort(function (a, b) { return b.swing - a.swing; });
    return { ok: true, key: key, base: b0, share: share, bars: bars };
  }
  // one input across its range
  function sweep(params, input, key, from, to, points) {
    var out = [];
    for (var i = 0; i < points; i++) {
      var v = from + (to - from) * i / (points - 1), p = {}, k;
      for (k in params) p[k] = params[k];
      p[input] = v;
      var r = M.run(p);
      out.push({ x: v, y: r.ok ? r.kpi[key] : null });
    }
    return out;
  }

  // ---- the policy search
  var GRID = {
    coverage: [3, 4, 5, 6, 8], invAdjTime: [3, 6, 10], supplyLineWeight: [0, 0.5, 1], forecastTime: [3, 6, 10], overtime: [false, true], expediteQA: [false, true]
  };
  function candidates(params, grid) {
    grid = grid || GRID;
    var keys = Object.keys(grid), out = [{}];
    keys.forEach(function (k) { var next = []; out.forEach(function (c) { grid[k].forEach(function (v) { var o = {}; for (var q in c) o[q] = c[q]; o[k] = v; next.push(o); }); }); out = next; });
    // a cover below the cover needed for full service cannot work; skip it
    var p = M.merge(params);
    return out.filter(function (c) { return c.coverage == null || c.coverage >= p.serviceCover; });
  }
  // evaluate one policy over the same futures: mean results
  function evaluate(params, policy, ss) {
    var acc = { profit: 0, fillRate: 0, criticalFill: 0, shortWeeks: 0, bullwhip: 0, wasteUnits: 0, avgInventory: 0 }, n = 0, crit = 0, bw = 0;
    for (var i = 0; i < ss.length; i++) {
      var p = {}, k; for (k in params) p[k] = params[k]; for (k in policy) p[k] = policy[k]; p.seed = ss[i];
      var r = M.run(p); if (!r.ok) return null;
      var q = r.kpi; n++;
      acc.profit += q.profit; acc.fillRate += q.fillRate; acc.shortWeeks += q.shortWeeks; acc.wasteUnits += q.wasteUnits; acc.avgInventory += q.avgInventory;
      if (q.criticalFill != null) { acc.criticalFill += q.criticalFill; crit++; }
      if (q.bullwhip != null) { acc.bullwhip += q.bullwhip; bw++; }
    }
    for (var key in acc) acc[key] /= key === "criticalFill" ? Math.max(1, crit) : key === "bullwhip" ? Math.max(1, bw) : n;
    if (!crit) acc.criticalFill = null; if (!bw) acc.bullwhip = null;
    return acc;
  }
  // an optimiser that can be run in slices (so a page stays responsive): call step(k) until done
  function optimiser(params, opts) {
    opts = opts || {};
    var list = candidates(params, opts.grid), ss = seeds(opts.futures || 10, opts.firstSeed), minFill = opts.minFill == null ? 0.99 : opts.minFill;
    var results = [], i = 0;
    return {
      total: list.length, futures: ss.length,
      done: function () { return i >= list.length; },
      step: function (k) { for (var j = 0; j < (k || 10) && i < list.length; j++, i++) { var e = evaluate(params, list[i], ss); if (e) results.push({ policy: list[i], mean: e }); } return i; },
      result: function () {
        var feasible = results.filter(function (r) { return r.mean.fillRate >= minFill - 1e-12; });
        feasible.sort(function (a, b) { return b.mean.profit - a.mean.profit; });
        // the trade-off frontier: no other policy has both more profit and a higher fill rate
        var front = results.filter(function (r) { return !results.some(function (o) { return o !== r && o.mean.profit >= r.mean.profit && o.mean.fillRate >= r.mean.fillRate && (o.mean.profit > r.mean.profit || o.mean.fillRate > r.mean.fillRate); }); });
        return { ok: true, evaluated: results.length, feasible: feasible.length, best: feasible.slice(0, 10), all: results, front: front, minFill: minFill, seeds: ss };
      }
    };
  }
  function optimise(params, opts) { var o = optimiser(params, opts); while (!o.done()) o.step(50); return o.result(); }

  return { KPIS: KPIS, TORNADO: TORNADO, GRID: GRID, quantile: quantile, futures: futures, headToHead: headToHead, tornado: tornado, sweep: sweep, candidates: candidates, evaluate: evaluate, optimiser: optimiser, optimise: optimise };
});
