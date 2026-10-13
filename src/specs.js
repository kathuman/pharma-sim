// PharmaSim — the controls: every input the rail shows, grouped, with its range, units and when it is shown.
// key = the model input (src/model.js DEFAULTS). Labels and notes are English; the page translates them with T().
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PSSpecs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var GROUPS = [
    { id: "market", title: "Market", controls: [
      { key: "pattern", type: "select", label: "Demand pattern", options: [["none", "Steady"], ["step", "Step (a lasting change)"], ["pulse", "Surge (then back)"], ["seasonal", "Seasonal"]] },
      { key: "shockSize", label: "Size of the change", unit: "%", min: -40, max: 80, step: 5, show: function (p) { return p.pattern === "step" || p.pattern === "pulse"; } },
      { key: "shockWeek", label: "Week it starts", unit: "wk", min: 2, max: 60, step: 1, show: function (p) { return p.pattern === "step" || p.pattern === "pulse"; } },
      { key: "pulseWeeks", label: "Surge length", unit: "wk", min: 2, max: 40, step: 1, show: function (p) { return p.pattern === "pulse"; } },
      { key: "seasonAmp", label: "Seasonal swing", unit: "%", min: 5, max: 50, step: 5, show: function (p) { return p.pattern === "seasonal"; } },
      { key: "noise", label: "Week-to-week noise", unit: "%", min: 0, max: 25, step: 1, note: "Random variation around the pattern, correlated over two weeks. The same random future is used for the baseline, so comparisons are fair." }
    ] },
    { id: "disruption", title: "Supply disruption", controls: [
      { key: "outage", type: "toggle", label: "Plant outage", note: "The plant stops (or slows) for some weeks: a contamination, an equipment failure or a regulatory hold." },
      { key: "outageWeek", label: "Outage starts", unit: "wk", min: 2, max: 80, step: 1, show: function (p) { return p.outage; } },
      { key: "outageWeeks", label: "Outage length", unit: "wk", min: 1, max: 16, step: 1, show: function (p) { return p.outage; } },
      { key: "outageLeft", label: "Output during the outage", unit: "%", min: 0, max: 90, step: 10, show: function (p) { return p.outage; } }
    ] },
    { id: "network", title: "Network", controls: [
      { key: "retailTier", type: "toggle", label: "Distributor tier", note: "A distributor between the market and the plant. It serves patients from its own stock and orders from the plant." },
      { key: "transitTime", label: "Transit to the distributor", unit: "wk", min: 0.5, max: 8, step: 0.5, show: function (p) { return p.retailTier; } },
      { key: "distCoverage", label: "Distributor's target cover", unit: "wk", min: 2, max: 10, step: 0.5, show: function (p) { return p.retailTier; } },
      { key: "shareDemand", type: "toggle", label: "Share sales data with the plant", note: "The plant forecasts from what patients take, not from the distributor's orders.", show: function (p) { return p.retailTier; } }
    ] },
    { id: "plant", title: "Plant and quality", controls: [
      { key: "ceiling", label: "Plant capacity", unit: "%", min: 100, max: 200, step: 5, note: "What the equipment can make, as a share of the starting output. Hiring cannot go beyond it." },
      { key: "qaTime", label: "QA release time", unit: "wk", min: 1, max: 8, step: 0.5, note: "Testing and batch-record review before a batch can be sold." },
      { key: "rejectRate", label: "Batches rejected in QA", unit: "%", min: 0, max: 10, step: 0.5 },
      { key: "shelfLife", label: "Shelf life", unit: "wk", min: 12, max: 260, step: 2 },
      { key: "minRemaining", label: "Remaining life required at delivery", unit: "wk", min: 0, max: 104, step: 2, note: "Customers and tenders refuse short-dated stock: older than shelf life minus this, a pack is written off." },
      { key: "serviceCover", label: "Stock needed for full service", unit: "wk", min: 0.5, max: 4, step: 0.5, note: "Stock is spread over many presentations and markets, so some orders go unfilled before the total runs out." }
    ] },
    { id: "policy", title: "Planning policy", controls: [
      { key: "coverage", label: "Target stock cover", unit: "wk", min: 2, max: 12, step: 0.5 },
      { key: "forecastTime", label: "Forecast smoothing", unit: "wk", min: 1, max: 20, step: 1, note: "How many weeks of orders the forecast averages: longer is calmer but slower to notice a real change." },
      { key: "invAdjTime", label: "Time to correct stock", unit: "wk", min: 2, max: 20, step: 1, note: "How fast the plan closes a gap between stock and its target." },
      { key: "wfAdjTime", label: "Time to hire", unit: "wk", min: 2, max: 30, step: 1, note: "How long it takes to bring the workforce to what the plan needs (recruiting, qualifying, training)." },
      { key: "supplyLineWeight", label: "Weight on the supply line", unit: "", min: 0, max: 1, step: 0.1, note: "How much of the stock already in QA (and on order, for the distributor) the planners count. 0 = ignored, 1 = fully counted." }
    ] },
    { id: "levers", title: "Levers", controls: [
      { key: "overtime", type: "toggle", label: "Overtime", note: "The plant can make more than its regular output when the plan asks for it, at a premium on the extra packs." },
      { key: "overtimeMax", label: "Most overtime", unit: "%", min: 5, max: 40, step: 5, show: function (p) { return p.overtime; } },
      { key: "expediteQA", type: "toggle", label: "Expedite QA when stock is low", note: "Extra lab shifts and parallel testing release batches sooner, at a cost per pack and with more deviations." },
      { key: "expediteTrigger", label: "Expedite below", unit: "% of target", min: 30, max: 100, step: 5, show: function (p) { return p.expediteQA; } },
      { key: "expediteSpeed", label: "QA time saved", unit: "%", min: 10, max: 70, step: 5, show: function (p) { return p.expediteQA; } },
      { key: "expediteReject", label: "Extra rejections while expediting", unit: "pts", min: 0, max: 10, step: 0.5, show: function (p) { return p.expediteQA; } }
    ] },
    { id: "money", title: "Economics", controls: [
      { key: "price", label: "Price", unit: "$/pack", min: 5, max: 200, step: 1 },
      { key: "material", label: "Materials", unit: "$/pack", min: 1, max: 100, step: 1 },
      { key: "wage", label: "Cost of a worker", unit: "$/wk", min: 500, max: 4000, step: 100 },
      { key: "hireCost", label: "Cost to hire and qualify", unit: "$/person", min: 0, max: 30000, step: 1000 },
      { key: "otPremium", label: "Overtime premium", unit: "%", min: 0, max: 150, step: 10, show: function (p) { return p.overtime; } },
      { key: "expediteCost", label: "Cost of expediting", unit: "$/pack", min: 0, max: 10, step: 0.5, show: function (p) { return p.expediteQA; } },
      { key: "holding", label: "Holding cost", unit: "$/pack/wk", min: 0, max: 0.5, step: 0.01 },
      { key: "shortagePenalty", label: "Penalty per pack not supplied", unit: "$/pack", min: 0, max: 200, step: 5, note: "Contract penalties and the cost to patients and reputation, on top of the lost sale." },
      { key: "disposal", label: "Disposal", unit: "$/pack", min: 0, max: 10, step: 0.5 }
    ] },
    { id: "run", title: "Run", controls: [
      { key: "weeks", label: "Horizon", unit: "wk", min: 26, max: 260, step: 26 },
      { key: "demand", label: "Starting demand", unit: "packs/wk", min: 1000, max: 100000, step: 1000 }
    ] }
  ];
  var BY_KEY = {};
  GROUPS.forEach(function (g) { g.controls.forEach(function (c) { c.group = g.id; BY_KEY[c.key] = c; }); });
  return { GROUPS: GROUPS, BY_KEY: BY_KEY };
});
