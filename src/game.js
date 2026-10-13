// PharmaSim — the play mode (window.PSGame / module.exports): you are the planner. Each turn you set the production
// plan (packs a week); hiring follows it, as it follows the rule's plan in the simulator. You see what a planner sees:
// the orders received, the stock, the QA pipeline and the workforce, never the demand to come. At the end your run is
// compared with the planning rule on the very same demand future. Pure: no DOM.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.PSGame = factory(root.PSModel);
})(typeof self !== "undefined" ? self : this, function (M) {
  "use strict";
  var SCENARIOS = ["step", "flu", "shortLife", "outage", "twoTier", "apiOutage"];

  function create(preset, opts) {
    opts = opts || {};
    var params = M.merge(Object.assign({}, (M.PRESETS[preset] || M.PRESETS.step).values, opts.values || {}, { seed: opts.seed || 1 }));
    var sim = M.start(params); if (!sim.ok) return { ok: false, errors: sim.errors };
    var turn = opts.turnWeeks || 2, plans = [], P0 = params.demand / (1 - params.rejectRate / 100);
    // the planner's view at the start of a turn: the last step's numbers, or the balanced start
    function view() {
      var r = sim.result(), rows = r.rows, last = rows[rows.length - 1], perWeek = Math.round(1 / params.dt);
      var recent = rows.slice(-4 * perWeek), avg = function (k) { return recent.length ? recent.reduce(function (s, x) { return s + x[k]; }, 0) / recent.length : null; };
      var capNow = last ? last.capacity : Math.min(P0 * params.ceiling / 100 * M.efficiency(params), P0 * (1 + (params.overtime ? params.overtimeMax / 100 : 0)));
      return {
        week: sim.time(), weeks: params.weeks, done: sim.done(), turnWeeks: turn,
        orders: last ? last.ordersToMfg : params.demand, orders4: avg("ordersToMfg") || params.demand,
        stock: last ? last.inventory : params.demand * (params.coverage + (params.campaignWeeks > 0 ? params.campaignWeeks / 2 : 0)),
        qa: last ? last.qa : r.start.qa, workforce: last ? last.workforce : P0 / (params.productivity * M.efficiency(params)),
        capacity: capNow, production: last ? last.production : P0, served: last ? last.served : params.demand,
        coverWeeks: last && last.ordersToMfg > 0 ? last.inventory / last.ordersToMfg : params.coverage,
        rule: last ? last.rule : P0, startOutput: P0, maxPlan: Math.round(P0 * Math.max(2, params.ceiling / 100 * 1.25)),
        apiStock: params.apiTier ? (last ? last.apiStock : P0 * params.apiCoverage) : null
      };
    }
    return {
      ok: true, params: params, preset: preset, turnWeeks: turn,
      view: view,
      done: function () { return sim.done(); },
      // play one turn with a production plan (packs a week)
      play: function (plan) {
        if (sim.done()) return view();
        var p = Math.max(0, +plan || 0), from = sim.time();
        sim.advance(turn, function () { return p; });
        plans.push({ week: from, plan: p });
        return view();
      },
      plans: function () { return plans.slice(); },
      result: function () { return sim.result(); },
      // your run against the planning rule on the same demand future
      compare: function () {
        var you = sim.result(), rule = M.run(params);
        return { you: you.kpi, rule: rule.kpi, youRows: you.rows, ruleRows: rule.rows, beatsProfit: you.kpi.profit > rule.kpi.profit, beatsFill: you.kpi.fillRate > rule.kpi.fillRate + 1e-12 };
      }
    };
  }
  // a short verdict on a finished game
  function verdict(c) {
    var dp = c.you.profit - c.rule.profit, df = c.you.fillRate - c.rule.fillRate;
    if (dp >= 0 && df >= -1e-9) return "both";
    if (dp >= 0) return "profit";
    if (df > 1e-9) return "service";
    return "neither";
  }
  return { SCENARIOS: SCENARIOS, create: create, verdict: verdict };
});
