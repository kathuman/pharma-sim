// Supply Pulse — the model written out: every equation the engine integrates, grouped, with the live value it takes in
// the week the reader points at. Text is English; the page translates it with T(). tests/model.test.js checks that
// every value here is read from the model's own output.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SPEquations = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // u: the unit shown with the value; v(row, params): the value in that week (null when it does not apply)
  var SECTIONS = [
    { title: "Market", items: [
      { name: "Market demand", eq: "Starting demand × pattern(t) × (1 + noise(t))", u: "cases/wk", v: function (r) { return r.demand; },
        note: "Noise is pink: white noise smoothed over two weeks and scaled so its size does not depend on the time step. With your own data, pattern(t) is your weekly demand divided by the level of its first four weeks." }
    ] },
    { title: "Distributor (when the tier is on)", tier: true, items: [
      { name: "Customers served by the distributor", eq: "Demand × g(Distributor stock ÷ (Demand × Stock needed for full service))", u: "cases/wk", v: function (r) { return r.served; } },
      { name: "Distributor's forecast", eq: "SMOOTH(Demand, Forecast smoothing)", u: "cases/wk", v: null },
      { name: "Orders to the plant", eq: "max(0, Forecast + (Forecast × Target cover − Stock) ÷ Time to correct stock + Weight × (Desired supply line − Supply line) ÷ Time to correct stock)", u: "cases/wk", v: function (r) { return r.ordersToMfg; },
        note: "Supply line = orders waiting at the plant + cases in transit. Desired supply line = Forecast × (Transit time + 1 week of order processing)." },
      { name: "In transit", eq: "DELAY3(Plant shipments, Transit time)", u: "cases", v: function (r) { return r.transit; } },
      { name: "Distributor stock", eq: "∫ (Arrivals − Customers served) dt", u: "cases", v: function (r) { return r.distInventory; } },
      { name: "Plant backlog", eq: "∫ (Orders to the plant − Plant shipments) dt", u: "cases", v: function (r) { return r.backlog; } }
    ] },
    { title: "Customers", items: [
      { name: "Priority customers served", eq: "Proportional: Served × Priority share; priority first: min(Demand × Priority share, Served)", u: "cases/wk", v: function (r) { return r.critServed; },
        note: "Everyone else gets what is left. The penalty for a case missing for a priority customer is multiplied by the priority penalty." }
    ] },
    { title: "Ingredient supplier (when the tier is on)", ing: true, items: [
      { name: "Ingredient stock", eq: "∫ (Ingredient arrivals − Production) dt", u: "cases", v: function (r) { return r.ingStock; }, note: "Measured in cases' worth of the ingredient." },
      { name: "Ingredient orders", eq: "max(0, ingredient usage forecast + (Ingredient usage forecast × ingredient stock target − ingredient stock) ÷ Time to correct stock + Weight × (Desired ingredient on order − ingredient on order) ÷ Time to correct stock)", u: "cases/wk", v: function (r) { return r.ingOrders; },
        note: "Ingredient usage forecast = SMOOTH(Production, Forecast smoothing). ingredient on order = waiting at the supplier + on its way. Desired ingredient on order = forecast × (1 week + ingredient lead time)." },
      { name: "ingredient on its way", eq: "DELAY3(Supplier shipments, ingredient lead time); Supplier shipments = min(Ingredient backlog ÷ 1 week, Supplier capacity), 0 during an ingredient outage", u: "cases", v: function (r) { return r.ingTransit; } }
    ] },
    { title: "Plant: shipping and planning", items: [
      { name: "Plant shipments", eq: "Wanted × g(Plant stock ÷ (Wanted × Stock needed for full service)); Wanted = Demand, or Backlog ÷ 1 week with a distributor", u: "cases/wk", v: function (r) { return r.shipped; },
        note: "g(y) = 2y − y² below full cover (y < 1), and 1 above: service starts to slip before the stock runs out." },
      { name: "Forecast", eq: "SMOOTH(Orders received, Forecast smoothing)", u: "cases/wk", v: function (r) { return r.forecast; },
        note: "Orders received = market demand, the distributor's orders, or (with sales data shared) market demand again." },
      { name: "Target stock", eq: "Forecast × Target stock cover", u: "cases", v: function (r) { return r.target; } },
      { name: "Desired production", eq: "max(0, (Forecast + (Target stock − Plant stock) ÷ Time to correct stock + Backlog correction) ÷ (1 − Rejection rate) + Weight × (Desired QA pipeline − QA pipeline) ÷ Time to correct stock)", u: "cases/wk", v: function (r) { return r.desired; },
        note: "Desired QA pipeline = Forecast ÷ (1 − Rejection rate) × QA release time. Backlog correction = (Backlog − Forecast × 1 week) ÷ Time to correct stock." }
    ] },
    { title: "Plant: capacity and people", items: [
      { name: "Capacity", eq: "min(Plant capacity × Line efficiency, Workforce × Productivity × Line efficiency × (1 + Most overtime)) × Output during an outage", u: "cases/wk", v: function (r) { return r.capacity; },
        note: "Line efficiency = 1 − Changeover ÷ (7 × Campaign length) with campaigns, and 1 on a dedicated line." },
      { name: "Scheduled production", eq: "SMOOTH(Desired production, Campaign length ÷ 2) with campaigns; Desired production on a dedicated line", u: "cases/wk", v: function (r) { return r.scheduled; },
        note: "A change of plan reaches the line at the next campaign, on average half a campaign later. Campaigns also add half a campaign of demand to the target stock (cycle stock)." },
      { name: "Production", eq: "min(Scheduled production, Capacity), times g(Ingredient stock ÷ (that × 1 week)) when the ingredient tier is on", u: "cases/wk", v: function (r) { return r.production; } },
      { name: "Overtime cases", eq: "max(0, Production − Workforce × Productivity)", u: "cases/wk", v: function (r) { return r.overtime; } },
      { name: "Workforce", eq: "∫ (Hiring − Leaving) dt; Hiring = max(0, Leaving + (Desired workforce − Workforce) ÷ Time to hire)", u: "people", v: function (r) { return r.workforce; },
        note: "Desired workforce = min(Desired production, Plant capacity) ÷ Productivity (200 cases per person-week). Leaving = Workforce ÷ 100 weeks. Nobody is laid off: the workforce shrinks by people leaving." }
    ] },
    { title: "Quality release and shelf life", items: [
      { name: "QA pipeline", eq: "DELAY3(Production, QA release time): three stages in series, the last limited to the QA lab capacity", u: "cases", v: function (r) { return r.qa; },
        note: "QA lab capacity = QA lab capacity % × the starting output, raised by the QA time saved while expediting (extra shifts)." },
      { name: "Released by QA", eq: "Approved = Release × (1 − Rejection rate); Rejected = Release × Rejection rate", u: "cases/wk", v: function (r) { return r.approved; } },
      { name: "Rejected batches", eq: "Release × Rejection rate", u: "cases/wk", v: function (r) { return r.rejected; },
        note: "While expediting (stock below the trigger), the QA time is cut and the rejection rate rises by the extra points." },
      { name: "Plant stock", eq: "∫ (Approved − Plant shipments − Written off) dt, kept by age and shipped oldest first", u: "cases", v: function (r) { return r.inventory; } },
      { name: "Written off (short-dated)", eq: "Cases whose age reaches Shelf life − Remaining life required at delivery", u: "cases/wk", v: function (r) { return r.expired; },
        note: "A released case has already spent the QA time of its shelf life." }
    ] },
    { title: "Money (the plant's view)", items: [
      { name: "Profit rate", eq: "Price × Shipments − Materials × Production − Worker cost × Workforce − Hiring cost × Hiring − Overtime premium × Labour per case × Overtime cases − Holding × Plant stock − Penalty × Not supplied − Disposal × (Rejected + Written off) − Expediting cost × Release", u: "$/wk", v: function (r) { return r.profitRate; } },
      { name: "Profit", eq: "∫ Profit rate dt", u: "$", v: function (r) { return r.profit; } }
    ] },
    { title: "Results", items: [
      { name: "Fill rate", eq: "Σ Customers served ÷ Σ Market demand", u: "", v: null },
      { name: "Bullwhip (production)", eq: "Standard deviation of Production ÷ Standard deviation of Market demand", u: "", v: null,
        note: "1 means production varies exactly as much as demand. With a distributor, the same ratio for its orders shows where the amplification starts." }
    ] }
  ];
  return { SECTIONS: SECTIONS };
});
