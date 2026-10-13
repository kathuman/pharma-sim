// PharmaSim — the model written out: every equation the engine integrates, grouped, with the live value it takes in
// the week the reader points at. Text is English; the page translates it with T(). tests/model.test.js checks that
// every value here is read from the model's own output.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PSEquations = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // u: the unit shown with the value; v(row, params): the value in that week (null when it does not apply)
  var SECTIONS = [
    { title: "Market", items: [
      { name: "Market demand", eq: "Starting demand × pattern(t) × (1 + noise(t))", u: "packs/wk", v: function (r) { return r.demand; },
        note: "Noise is pink: white noise smoothed over two weeks and scaled so its size does not depend on the time step." }
    ] },
    { title: "Distributor (when the tier is on)", tier: true, items: [
      { name: "Patients served by the distributor", eq: "Demand × g(Distributor stock ÷ (Demand × Stock needed for full service))", u: "packs/wk", v: function (r) { return r.served; } },
      { name: "Distributor's forecast", eq: "SMOOTH(Demand, Forecast smoothing)", u: "packs/wk", v: null },
      { name: "Orders to the plant", eq: "max(0, Forecast + (Forecast × Target cover − Stock) ÷ Time to correct stock + Weight × (Desired supply line − Supply line) ÷ Time to correct stock)", u: "packs/wk", v: function (r) { return r.ordersToMfg; },
        note: "Supply line = orders waiting at the plant + packs in transit. Desired supply line = Forecast × (Transit time + 1 week of order processing)." },
      { name: "In transit", eq: "DELAY3(Plant shipments, Transit time)", u: "packs", v: function (r) { return r.transit; } },
      { name: "Distributor stock", eq: "∫ (Arrivals − Patients served) dt", u: "packs", v: function (r) { return r.distInventory; } },
      { name: "Plant backlog", eq: "∫ (Orders to the plant − Plant shipments) dt", u: "packs", v: function (r) { return r.backlog; } }
    ] },
    { title: "Patients", items: [
      { name: "Critical patients served", eq: "Proportional: Served × Critical share; critical first: min(Demand × Critical share, Served)", u: "packs/wk", v: function (r) { return r.critServed; },
        note: "Everyone else gets what is left. The penalty for a pack missing for a critical patient is multiplied by the critical penalty." }
    ] },
    { title: "API supplier (when the tier is on)", api: true, items: [
      { name: "API stock", eq: "∫ (API arrivals − Production) dt", u: "packs", v: function (r) { return r.apiStock; }, note: "Measured in packs' worth of active ingredient." },
      { name: "API orders", eq: "max(0, API usage forecast + (API usage forecast × API stock target − API stock) ÷ Time to correct stock + Weight × (Desired API on order − API on order) ÷ Time to correct stock)", u: "packs/wk", v: function (r) { return r.apiOrders; },
        note: "API usage forecast = SMOOTH(Production, Forecast smoothing). API on order = waiting at the supplier + on its way. Desired API on order = forecast × (1 week + API lead time)." },
      { name: "API on its way", eq: "DELAY3(Supplier shipments, API lead time); Supplier shipments = min(API backlog ÷ 1 week, Supplier capacity), 0 during an API outage", u: "packs", v: function (r) { return r.apiTransit; } }
    ] },
    { title: "Plant: shipping and planning", items: [
      { name: "Plant shipments", eq: "Wanted × g(Plant stock ÷ (Wanted × Stock needed for full service)); Wanted = Demand, or Backlog ÷ 1 week with a distributor", u: "packs/wk", v: function (r) { return r.shipped; },
        note: "g(y) = 2y − y² below full cover (y < 1), and 1 above: service starts to slip before the stock runs out." },
      { name: "Forecast", eq: "SMOOTH(Orders received, Forecast smoothing)", u: "packs/wk", v: function (r) { return r.forecast; },
        note: "Orders received = market demand, the distributor's orders, or (with sales data shared) market demand again." },
      { name: "Target stock", eq: "Forecast × Target stock cover", u: "packs", v: function (r) { return r.target; } },
      { name: "Desired production", eq: "max(0, (Forecast + (Target stock − Plant stock) ÷ Time to correct stock + Backlog correction) ÷ (1 − Rejection rate) + Weight × (Desired QA pipeline − QA pipeline) ÷ Time to correct stock)", u: "packs/wk", v: function (r) { return r.desired; },
        note: "Desired QA pipeline = Forecast ÷ (1 − Rejection rate) × QA release time. Backlog correction = (Backlog − Forecast × 1 week) ÷ Time to correct stock." }
    ] },
    { title: "Plant: capacity and people", items: [
      { name: "Capacity", eq: "min(Plant capacity × Line efficiency, Workforce × Productivity × Line efficiency × (1 + Most overtime)) × Output during an outage", u: "packs/wk", v: function (r) { return r.capacity; },
        note: "Line efficiency = 1 − Changeover ÷ (7 × Campaign length) with campaigns, and 1 on a dedicated line." },
      { name: "Scheduled production", eq: "SMOOTH(Desired production, Campaign length ÷ 2) with campaigns; Desired production on a dedicated line", u: "packs/wk", v: function (r) { return r.scheduled; },
        note: "A change of plan reaches the line at the next campaign, on average half a campaign later. Campaigns also add half a campaign of demand to the target stock (cycle stock)." },
      { name: "Production", eq: "min(Scheduled production, Capacity), times g(API stock ÷ (that × 1 week)) when the API tier is on", u: "packs/wk", v: function (r) { return r.production; } },
      { name: "Overtime packs", eq: "max(0, Production − Workforce × Productivity)", u: "packs/wk", v: function (r) { return r.overtime; } },
      { name: "Workforce", eq: "∫ (Hiring − Leaving) dt; Hiring = max(0, Leaving + (Desired workforce − Workforce) ÷ Time to hire)", u: "people", v: function (r) { return r.workforce; },
        note: "Desired workforce = min(Desired production, Plant capacity) ÷ Productivity (200 packs per person-week). Leaving = Workforce ÷ 100 weeks. Nobody is laid off: the workforce shrinks by people leaving." }
    ] },
    { title: "Quality release and shelf life", items: [
      { name: "QA pipeline", eq: "DELAY3(Production, QA release time): three stages in series, the last limited to the QA lab capacity", u: "packs", v: function (r) { return r.qa; },
        note: "QA lab capacity = QA lab capacity % × the starting output, raised by the QA time saved while expediting (extra shifts)." },
      { name: "Released by QA", eq: "Approved = Release × (1 − Rejection rate); Rejected = Release × Rejection rate", u: "packs/wk", v: function (r) { return r.approved; } },
      { name: "Rejected batches", eq: "Release × Rejection rate", u: "packs/wk", v: function (r) { return r.rejected; },
        note: "While expediting (stock below the trigger), the QA time is cut and the rejection rate rises by the extra points." },
      { name: "Plant stock", eq: "∫ (Approved − Plant shipments − Written off) dt, kept by age and shipped oldest first", u: "packs", v: function (r) { return r.inventory; } },
      { name: "Written off (short-dated)", eq: "Packs whose age reaches Shelf life − Remaining life required at delivery", u: "packs/wk", v: function (r) { return r.expired; },
        note: "A released pack has already spent the QA time of its shelf life." }
    ] },
    { title: "Money (the plant's view)", items: [
      { name: "Profit rate", eq: "Price × Shipments − Materials × Production − Worker cost × Workforce − Hiring cost × Hiring − Overtime premium × Labour per pack × Overtime packs − Holding × Plant stock − Penalty × Not supplied − Disposal × (Rejected + Written off) − Expediting cost × Release", u: "$/wk", v: function (r) { return r.profitRate; } },
      { name: "Profit", eq: "∫ Profit rate dt", u: "$", v: function (r) { return r.profit; } }
    ] },
    { title: "Results", items: [
      { name: "Fill rate", eq: "Σ Patients served ÷ Σ Market demand", u: "", v: null },
      { name: "Bullwhip (production)", eq: "Standard deviation of Production ÷ Standard deviation of Market demand", u: "", v: null,
        note: "1 means production varies exactly as much as demand. With a distributor, the same ratio for its orders shows where the amplification starts." }
    ] }
  ];
  return { SECTIONS: SECTIONS };
});
