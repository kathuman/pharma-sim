// PharmaSim — the model. A system-dynamics model of a pharmaceutical supply chain, integrated in time steps of dt
// weeks: an optional API (active ingredient) supplier → the plant's API stock → production (workforce × productivity,
// capped by the plant, run continuously or in campaigns) → QA release (a third-order delay limited by the lab's
// capacity, which rejects some batches) → finished goods (aged first-in, first-out, so shelf life is real) → an
// optional distributor → patients, critical and other, served by an allocation rule. Planning anchors on the forecast
// and corrects stock and, with a weight, the supply line. Pure: no DOM. window.PSModel in the browser, module.exports
// in Node. start() gives a model that can be advanced week by week (the play mode); run() runs it to the end.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PSModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Every input, in the units the controls show (percentages as percentages).
  var DEFAULTS = {
    weeks: 104, dt: 0.25, seed: 1,
    // market
    demand: 10000, pattern: "step", shockWeek: 12, shockSize: 25, pulseWeeks: 16, seasonAmp: 20, seasonPeriod: 52,
    noise: 5, noiseCorr: 2, serviceCover: 2, history: null,
    // patients: a share is critical (hospitals, no substitute); the allocation rule decides who goes short
    criticalShare: 30, allocation: "proportional", criticalPenalty: 1,
    // supply disruption
    outage: false, outageWeek: 30, outageWeeks: 4, outageLeft: 0,
    // network
    retailTier: false, transitTime: 2, distCoverage: 3, shareDemand: false,
    // API supplier
    apiTier: false, apiLeadTime: 12, apiCoverage: 8, apiCapacity: 150, apiOutage: false, apiOutageWeek: 20, apiOutageWeeks: 8, apiHolding: 0.02,
    // plant and quality
    productivity: 200, ceiling: 140, campaignWeeks: 0, changeoverDays: 2,
    qaTime: 3, qaCapacity: 200, rejectRate: 2, shelfLife: 104, minRemaining: 26,
    // planning policy
    coverage: 4, forecastTime: 6, invAdjTime: 6, wfAdjTime: 10, supplyLineWeight: 0, employmentTime: 100,
    // levers
    overtime: false, overtimeMax: 20,
    expediteQA: false, expediteTrigger: 75, expediteSpeed: 50, expediteReject: 3, expediteCost: 1.5,
    // economics (per pack, per worker-week)
    price: 30, material: 10, wage: 1500, hireCost: 6000, otPremium: 50, holding: 0.06, shortagePenalty: 20, disposal: 2
  };
  var PATTERNS = ["none", "step", "pulse", "seasonal", "history"];
  var ALLOCATIONS = ["proportional", "critical"];
  var ORDER_TIME = 1;   // weeks to process an order (distributor → plant, plant → API supplier)
  var API_COVER = 1;    // production slows once the plant holds less than a week of API
  // Share of the week's orders that can be shipped, given the stock on hand. Stock is spread over many presentations,
  // pack sizes and markets, so service starts to slip before the total runs out: everything ships while there are at
  // least `cover` weeks of stock, and the share falls smoothly to zero below that (g(y) = 2y − y², y = cover ratio).
  function fulfil(stock, want, cover) {
    if (want <= 0) return 0;
    var y = stock / (want * cover);
    return y >= 1 ? want : want * Math.max(0, 2 * y - y * y);
  }

  function merge(p) { var o = {}, k; for (k in DEFAULTS) o[k] = DEFAULTS[k]; for (k in p || {}) if (p[k] !== undefined) o[k] = p[k]; return o; }
  // the share of a week the line can produce: each campaign starts with a changeover
  function efficiency(p) { return p.campaignWeeks > 0 ? 1 - p.changeoverDays / (7 * p.campaignWeeks) : 1; }

  // the checks a set of inputs must pass before it is run (messages are translated by pattern in the app)
  function validate(p) {
    var e = [];
    if (!(p.dt > 0 && p.dt <= 0.5)) e.push("The time step must be between 0 and 0.5 weeks.");
    if (!(p.weeks >= 8 && p.weeks <= 520)) e.push("The horizon must be between 8 and 520 weeks.");
    if (!(p.demand > 0)) e.push("Demand must be positive.");
    if (PATTERNS.indexOf(p.pattern) < 0) e.push("Unknown demand pattern: " + p.pattern + ".");
    if (p.pattern === "history" && !(p.history && p.history.length >= 4)) e.push("The demand history needs at least four weeks.");
    if (ALLOCATIONS.indexOf(p.allocation) < 0) e.push("Unknown allocation rule: " + p.allocation + ".");
    if (!(p.criticalShare >= 0 && p.criticalShare <= 100)) e.push("The share of critical patients must be between 0 and 100%.");
    ["qaTime", "forecastTime", "invAdjTime", "wfAdjTime", "employmentTime", "productivity", "coverage", "noiseCorr", "serviceCover"].forEach(function (k) { if (!(p[k] > 0)) e.push(k + " must be positive."); });
    if (p.retailTier && !(p.transitTime > 0 && p.distCoverage > 0)) e.push("The distributor needs a positive transit time and cover.");
    if (p.apiTier && !(p.apiLeadTime > 0 && p.apiCoverage >= API_COVER && p.apiCapacity >= 100)) e.push("The API supplier needs a positive lead time, at least a week of API cover and the capacity to supply the starting output.");
    if (!(p.rejectRate >= 0 && p.rejectRate + (p.expediteQA ? p.expediteReject : 0) < 100)) e.push("The QA rejection rate must stay below 100%.");
    if (!(p.qaCapacity >= 100)) e.push("The QA lab must be able to test at least the starting output.");
    if (!(p.shelfLife - p.minRemaining > p.qaTime + 1)) e.push("Shelf life minus the minimum remaining life must exceed the QA time by more than a week, or nothing could be sold.");
    if (!(p.supplyLineWeight >= 0 && p.supplyLineWeight <= 1)) e.push("The supply-line weight must be between 0 and 1.");
    if (!(p.coverage >= p.serviceCover)) e.push("The target cover must be at least the cover needed for full service, or the plant could never serve all demand.");
    if (!(p.campaignWeeks >= 0 && p.changeoverDays >= 0)) e.push("Campaign length and changeover time cannot be negative.");
    if (!(p.ceiling >= 100)) e.push("The plant ceiling must be at least 100% of the starting output.");
    else if (!(p.ceiling * efficiency(p) >= 100)) e.push("With these campaigns the plant cannot make its starting output: lengthen the campaigns, shorten the changeovers or raise the capacity.");
    return e;
  }

  // a small seeded generator (mulberry32) and normal draws, so a scenario and its baseline see the same demand
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    function u() { a = (a + 0x6d2b79f5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    return function () { var x = 1 - u(), y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
  }
  // the demand pattern without noise, as a multiple of the starting demand (a history is already a multiple of its first weeks)
  function pattern(p, t) {
    var s = p.shockSize / 100;
    switch (p.pattern) {
      case "step": return t >= p.shockWeek ? 1 + s : 1;
      case "pulse": return t >= p.shockWeek && t < p.shockWeek + p.pulseWeeks ? 1 + s : 1;
      case "seasonal": return 1 + (p.seasonAmp / 100) * Math.sin(2 * Math.PI * t / p.seasonPeriod);
      case "history": var h = p.history; return h[Math.min(h.length - 1, Math.floor(t))];
      default: return 1;
    }
  }
  // exact first-order outflow over a step: stable for any dt, and the same as Euler as dt → 0
  function frac(dt, tau) { return 1 - Math.exp(-dt / tau); }
  // the stock a three-stage delay of total time T holds per unit of flow when it is in balance (→ T as dt → 0)
  function hold(dt, T) { return 3 * dt / frac(dt, T / 3); }
  // a three-stage delay: moves one step, returns the outflow (per week); `cap` (per week) limits what leaves
  function delay3(s, inflow, dt, T, cap) {
    var f = frac(dt, T / 3), o1 = s[0] * f, o2 = s[1] * f, o3 = s[2] * f;
    if (cap != null) o3 = Math.min(o3, cap * dt);
    s[0] += inflow * dt - o1; s[1] += o1 - o2; s[2] += o2 - o3;
    return o3 / dt;
  }

  function start(input) {
    var p = merge(input), errs = validate(p);
    if (errs.length) return { ok: false, errors: errs, params: p };
    var dt = p.dt, n = Math.round(p.weeks / dt), multi = !!p.retailTier, api = !!p.apiTier;
    var rej0 = p.rejectRate / 100, w = p.supplyLineWeight, eff = efficiency(p), C = p.campaignWeeks;
    var D0 = p.demand, P0 = D0 / (1 - rej0);                     // the plant makes enough to cover rejections
    var Cmax = P0 * p.ceiling / 100 * eff;                       // what the equipment can make in a week, after changeovers
    var L = Math.round((p.shelfLife - p.minRemaining) / dt);     // age (in steps) after which a pack can no longer be sold
    var entry0 = Math.round(p.qaTime / dt), cs = p.criticalShare / 100;
    var cycle = C > 0 ? C / 2 : 0;                               // campaigns add half a campaign of cycle stock to the target

    // ---- the starting state: everything balanced at the starting demand
    var age = new Float64Array(L);                               // finished goods by age (steps since manufacture)
    var cov = Math.round((p.coverage + cycle) / dt);
    for (var i = 0; i < cov && entry0 + i < L; i++) age[entry0 + i] = D0 * dt;   // FIFO in balance: one step's shipments per age
    var qStage = P0 * hold(dt, p.qaTime) / 3, q = [qStage, qStage, qStage]; // QA quarantine, three stages
    var W = P0 / (p.productivity * eff);                          // workforce
    var Fm = D0, sched = P0;                                      // forecast of incoming orders; the campaign schedule
    var Id = multi ? D0 * p.distCoverage : 0, Fd = D0;            // distributor stock and forecast
    var tStage = D0 * hold(dt, p.transitTime) / 3, tr = multi ? [tStage, tStage, tStage] : [0, 0, 0];   // in transit to the distributor
    var B = multi ? D0 * ORDER_TIME : 0;                          // the plant's order backlog (from the distributor)
    var Ap = api ? P0 * p.apiCoverage : 0, Fu = P0, Ba = api ? P0 * ORDER_TIME : 0;   // API stock, usage forecast, supplier backlog
    var aStage = P0 * hold(dt, p.apiLeadTime) / 3, ta = api ? [aStage, aStage, aStage] : [0, 0, 0];   // API on its way

    var gauss = rng(p.seed), pink = 0, sigma = p.noise / 100;
    var nscale = sigma * Math.sqrt(2 * p.noiseCorr / dt);         // white noise scaled so the filtered noise has std sigma for any dt
    var A = frac(dt, p.noiseCorr);

    var rows = [], acc = { demand: 0, served: 0, lost: 0, critDemand: 0, critServed: 0, produced: 0, approved: 0, rejected: 0, expired: 0, shippedMfg: 0, hires: 0, otUnits: 0, expedited: 0,
      apiOrdered: 0, apiShipped: 0, apiArrived: 0, apiUsed: 0, apiShort: 0,
      revenue: 0, cMaterial: 0, cWages: 0, cHiring: 0, cOvertime: 0, cHolding: 0, cShortage: 0, cDisposal: 0, cExpedite: 0 };
    var sumAge = function () { var s = 0; for (var j = 0; j < L; j++) s += age[j]; return s; };
    var snap = function () { return { inv: sumAge(), qa: q[0] + q[1] + q[2], dist: Id, transit: tr[0] + tr[1] + tr[2], backlog: B, api: Ap, apiTransit: ta[0] + ta[1] + ta[2], apiBacklog: Ba }; };
    var first = snap(), k = 0;

    // one time step; `plan`, when given, replaces the planning rule's desired production (the play mode)
    function step(plan) {
      var t = k * dt;
      // ---- market demand (pink noise: white noise smoothed over noiseCorr weeks)
      pink += (nscale * gauss() - pink) * (sigma > 0 ? A : 0);
      var D = Math.max(0, D0 * pattern(p, t) * (1 + pink));
      var Im = sumAge();

      // ---- the distributor (optional): serves the market, orders from the plant
      var served, Od = 0, arr;
      if (multi) {
        served = fulfil(Id, D, p.serviceCover);
        Fd += (D - Fd) * frac(dt, p.forecastTime);
        var SLd = B + tr[0] + tr[1] + tr[2], SLdStar = Fd * (hold(dt, p.transitTime) + ORDER_TIME);
        Od = Math.max(0, Fd + (Fd * p.distCoverage - Id) / p.invAdjTime + w * (SLdStar - SLd) / p.invAdjTime);
      }

      // ---- the plant ships first-in, first-out from what is on hand
      var want = multi ? B / ORDER_TIME : D;
      var Sm = fulfil(Im, want, p.serviceCover);
      takeOldest(age, Sm * dt);
      if (!multi) served = Sm;
      // ---- who goes short: in proportion, or critical patients first
      var Dc = D * cs, sc = p.allocation === "critical" ? Math.min(Dc, served) : served * cs;
      var lost = D - served, lostC = Dc - sc, lostO = lost - lostC;

      // ---- forecast of incoming orders (or of market demand, if the distributor shares its sales data)
      var signal = multi ? (p.shareDemand ? D : Od) : D;
      Fm += (signal - Fm) * frac(dt, p.forecastTime);

      // ---- QA status: expedite when stock falls below the trigger
      var target = Fm * (p.coverage + cycle);
      var expediting = !!p.expediteQA && Im < target * p.expediteTrigger / 100;
      var qaT = p.qaTime * (expediting ? 1 - p.expediteSpeed / 100 : 1);
      var rej = rej0 + (expediting ? p.expediteReject / 100 : 0);
      var labCap = P0 * p.qaCapacity / 100 * (expediting ? 1 + p.expediteSpeed / 100 : 1);

      // ---- planning: forecast + stock correction (+ backlog) + a weight on the QA supply line, grossed up for rejections
      var Q = q[0] + q[1] + q[2], Qstar = Fm / (1 - rej) * hold(dt, qaT);
      var backlogCorr = multi ? (B - Fm * ORDER_TIME) / p.invAdjTime : 0;
      var rule = Math.max(0, (Fm + (target - Im) / p.invAdjTime + backlogCorr) / (1 - rej) + w * (Qstar - Q) / p.invAdjTime);
      var desired = plan != null && isFinite(plan) ? Math.max(0, plan) : rule;
      // campaigns: a change of plan reaches the line at the next campaign, on average half a campaign later
      if (C > 0) sched += (desired - sched) * frac(dt, C / 2); else sched = desired;

      // ---- capacity and production (limited by the API on hand, when the supplier tier is on)
      var out = p.outage && t >= p.outageWeek && t < p.outageWeek + p.outageWeeks ? p.outageLeft / 100 : 1;
      var regular = W * p.productivity * eff * out, ceil = Cmax * out;
      var avail = Math.min(ceil, regular * (1 + (p.overtime ? p.overtimeMax / 100 : 0)));
      var wanted = Math.min(sched, avail), P = api ? fulfil(Ap, wanted, API_COVER) : wanted;
      var ot = Math.max(0, P - Math.min(regular, ceil));

      // ---- workforce: hire towards what the plan needs (never beyond what the plant can use); people leave over time
      var Wstar = Math.min(desired, Cmax) / (p.productivity * eff);
      var leave = W / p.employmentTime, hire = Math.max(0, leave + (Wstar - W) / p.wfAdjTime);

      // ---- QA: three stages, the last limited by what the lab can test; released packs are approved or rejected
      var released = delay3(q, P, dt, qaT, labCap), approved = released * (1 - rej), rejected = released * rej;
      var labBound = released >= labCap * (1 - 1e-9);

      // ---- finished goods (already shipped from, oldest first): everything ages one step, and what reaches the age
      // limit can no longer be sold and is written off; then the packs QA just released join at the age QA took
      var expired = age[L - 1];
      for (var j = L - 1; j > 0; j--) age[j] = age[j - 1];
      age[0] = 0;
      age[Math.min(L - 1, Math.round(qaT / dt))] += approved * dt;

      // ---- the API supplier: the plant orders to cover its usage and API stock target (and, with the weight, what is on order)
      var Oa = 0, Ssup = 0, arrA = 0, supOut = false;
      if (api) {
        Fu += (P - Fu) * frac(dt, p.forecastTime);
        var SLa = Ba + ta[0] + ta[1] + ta[2], SLaStar = Fu * (ORDER_TIME + hold(dt, p.apiLeadTime));
        Oa = Math.max(0, Fu + (Fu * p.apiCoverage - Ap) / p.invAdjTime + w * (SLaStar - SLa) / p.invAdjTime);
        supOut = p.apiOutage && t >= p.apiOutageWeek && t < p.apiOutageWeek + p.apiOutageWeeks;
        Ssup = Math.min(Ba / ORDER_TIME, supOut ? 0 : P0 * p.apiCapacity / 100);
        arrA = delay3(ta, Ssup, dt, p.apiLeadTime);
        Ap += (arrA - P) * dt;
        Ba += (Oa - Ssup) * dt;
      }

      // ---- stocks
      W += (hire - leave) * dt;
      if (multi) {
        arr = delay3(tr, Sm, dt, p.transitTime);
        Id += (arr - served) * dt;
        B += (Od - Sm) * dt;
      }

      // ---- the plant's money
      var labUnit = p.wage / p.productivity;
      var c = {
        revenue: p.price * Sm, cMaterial: p.material * P, cWages: p.wage * W, cHiring: p.hireCost * hire, cOvertime: labUnit * p.otPremium / 100 * ot,
        cHolding: p.holding * Im + p.apiHolding * Ap, cShortage: p.shortagePenalty * (lostO + p.criticalPenalty * lostC),
        cDisposal: p.disposal * (rejected + expired / dt), cExpedite: expediting ? p.expediteCost * released : 0
      };
      for (var key in c) acc[key] += c[key] * dt;
      acc.demand += D * dt; acc.served += served * dt; acc.lost += lost * dt; acc.critDemand += Dc * dt; acc.critServed += sc * dt;
      acc.produced += P * dt; acc.approved += approved * dt; acc.rejected += rejected * dt; acc.expired += expired; acc.shippedMfg += Sm * dt;
      acc.hires += hire * dt; acc.otUnits += ot * dt; acc.expedited += expediting ? released * dt : 0;
      acc.apiOrdered += Oa * dt; acc.apiShipped += Ssup * dt; acc.apiArrived += arrA * dt; acc.apiUsed += (api ? P : 0) * dt; acc.apiShort += (wanted - P) * dt;
      var profitRate = c.revenue - c.cMaterial - c.cWages - c.cHiring - c.cOvertime - c.cHolding - c.cShortage - c.cDisposal - c.cExpedite;

      rows.push({
        t: t, demand: D, served: served, lost: lost, critDemand: Dc, critServed: sc, ordersToMfg: multi ? Od : D, forecast: Fm, rule: rule, production: P,
        desired: desired, scheduled: sched, capacity: avail, overtime: ot, apiShort: wanted - P,
        released: released, approved: approved, rejected: rejected, expired: expired / dt, shipped: Sm, labCapacity: labCap, labBound: labBound,
        inventory: Im, target: target, qa: Q, workforce: W, distInventory: Id, transit: tr[0] + tr[1] + tr[2], backlog: B,
        apiStock: Ap, apiOrders: Oa, apiTransit: ta[0] + ta[1] + ta[2], apiBacklog: Ba, apiOutage: supOut,
        expediting: expediting, outage: out < 1, profitRate: profitRate,
        profit: acc.revenue - acc.cMaterial - acc.cWages - acc.cHiring - acc.cOvertime - acc.cHolding - acc.cShortage - acc.cDisposal - acc.cExpedite
      });
      k++;
    }
    return {
      ok: true, params: p, steps: n,
      time: function () { return k * dt; }, done: function () { return k >= n; },
      // run `weeks` more weeks (all of what is left by default); plan(t) may return a desired production for each step
      advance: function (weeks, plan) {
        var stop = weeks == null ? n : Math.min(n, k + Math.round(weeks / dt));
        while (k < stop) step(plan ? plan(k * dt) : null);
        return this;
      },
      result: function () { return { ok: true, params: p, warnings: warnings(p), rows: rows, totals: acc, start: first, end: snap(), kpi: kpis(p, rows, acc), multi: multi, api: api, maxAge: L * dt }; }
    };
  }
  // settings that run but will not behave as intended (shown beside the results, not refused)
  function warnings(p) {
    var w = [], cycle = p.campaignWeeks > 0 ? p.campaignWeeks / 2 : 0, held = p.qaTime + p.coverage + cycle, window = p.shelfLife - p.minRemaining;
    if (held > window + 1e-9) w.push("QA time plus the target cover" + (cycle ? " and half a campaign" : "") + " (" + +held.toFixed(1) + " weeks) is longer than a pack can be sold (" + +window.toFixed(1) + " weeks): stock will keep expiring.");
    if (p.apiTier && p.apiOutage && p.apiOutageWeek + p.apiOutageWeeks > p.weeks) w.push("The API outage runs past the end of the horizon.");
    if (p.outage && p.outageWeek + p.outageWeeks > p.weeks) w.push("The plant outage runs past the end of the horizon.");
    return w;
  }
  function run(input) { var s = start(input); return s.ok ? s.advance().result() : s; }

  // ship the oldest packs first
  function takeOldest(a, amt) {
    for (var i = a.length - 1; i >= 0 && amt > 1e-12; i--) { var x = Math.min(a[i], amt); a[i] -= x; amt -= x; }
  }
  function std(xs) { var m = 0, i; for (i = 0; i < xs.length; i++) m += xs[i]; m /= xs.length; var v = 0; for (i = 0; i < xs.length; i++) v += (xs[i] - m) * (xs[i] - m); return Math.sqrt(v / xs.length); }

  // the headline numbers
  function kpis(p, rows, a) {
    if (!rows.length) return null;
    var dem = rows.map(function (r) { return r.demand; }), prod = rows.map(function (r) { return r.production; }), ord = rows.map(function (r) { return r.ordersToMfg; });
    var sd = std(dem), unitCost = p.material + p.wage / p.productivity;
    // weeks in which less than 99% of the week's demand was served
    var short = 0, per = Math.round(1 / p.dt);
    for (var k = 0; k + per <= rows.length; k += per) { var d = 0, s = 0; for (var j = k; j < k + per; j++) { d += rows[j].demand; s += rows[j].served; } if (d > 0 && s / d < 0.99) short++; }
    var profit = a.revenue - a.cMaterial - a.cWages - a.cHiring - a.cOvertime - a.cHolding - a.cShortage - a.cDisposal - a.cExpedite;
    return {
      profit: profit,
      fillRate: a.demand > 0 ? a.served / a.demand : 1,
      criticalFill: a.critDemand > 0 ? a.critServed / a.critDemand : null,
      otherFill: a.demand - a.critDemand > 0 ? (a.served - a.critServed) / (a.demand - a.critDemand) : null,
      lost: a.lost,
      shortWeeks: short,
      // amplification: how much more production varies than market demand (1 = it simply follows demand)
      bullwhip: sd > 1e-9 ? std(prod) / sd : null,
      orderBullwhip: sd > 1e-9 ? std(ord) / sd : null,
      apiBullwhip: p.apiTier && sd > 1e-9 ? std(rows.map(function (r) { return r.apiOrders; })) / sd : null,
      peakProduction: Math.max.apply(null, prod),
      wasteUnits: a.rejected + a.expired, expiredUnits: a.expired, rejectedUnits: a.rejected,
      wasteCost: (a.rejected + a.expired) * (unitCost + p.disposal),
      avgInventory: rows.reduce(function (s, r) { return s + r.inventory; }, 0) / rows.length,
      peakQA: Math.max.apply(null, rows.map(function (r) { return r.qa; })),
      labWeeks: rows.filter(function (r) { return r.labBound; }).length * p.dt,
      apiShortUnits: a.apiShort,
      peakWorkforce: Math.max.apply(null, rows.map(function (r) { return r.workforce; })),
      hires: a.hires, otUnits: a.otUnits, expedited: a.expedited
    };
  }

  // ready-made scenarios (values in the controls' units; anything not named keeps its default)
  var PRESETS = {
    step: { label: "Demand step (+25%)", values: {} },
    flu: { label: "Flu season (16-week surge)", values: { pattern: "pulse", shockSize: 40, pulseWeeks: 16 } },
    shortLife: { label: "Short-life product (6-month shelf life)", values: { pattern: "pulse", shockSize: 40, pulseWeeks: 16, shelfLife: 26, minRemaining: 18, coverage: 5 } },
    outage: { label: "Plant outage (4 weeks)", values: { pattern: "none", outage: true, outageWeek: 20, outageWeeks: 4, outageLeft: 0 } },
    twoTier: { label: "Two-tier chain (distributor)", values: { retailTier: true } },
    calm: { label: "Calm market (noise only)", values: { pattern: "none", noise: 10 } },
    apiOutage: { label: "API supplier outage (16 weeks)", values: { pattern: "none", apiTier: true, apiLeadTime: 8, apiCoverage: 6, apiOutage: true, apiOutageWeek: 20, apiOutageWeeks: 16 } },
    biologic: { label: "Biologic (long QA, high value)", values: { shockSize: 20, price: 250, material: 80, productivity: 50, wage: 2500, qaTime: 8, rejectRate: 4, coverage: 8, minRemaining: 52, campaignWeeks: 8, changeoverDays: 5, holding: 0.8, shortagePenalty: 400, criticalShare: 60, criticalPenalty: 3 } },
    generic: { label: "Generic antibiotic (thin margin, campaigns)", values: { pattern: "seasonal", seasonAmp: 30, price: 6, material: 2.5, productivity: 1000, qaTime: 2, campaignWeeks: 6, changeoverDays: 2, holding: 0.01, shortagePenalty: 5, disposal: 0.3, apiTier: true, apiLeadTime: 16 } },
    vaccine: { label: "Pandemic vaccine (surge, lab bottleneck)", values: { pattern: "pulse", shockSize: 100, shockWeek: 8, pulseWeeks: 20, ceiling: 220, qaTime: 6, qaCapacity: 130, shelfLife: 30, minRemaining: 13, coverage: 4, price: 20, material: 6, criticalShare: 50, allocation: "critical", criticalPenalty: 5 } }
  };

  return { DEFAULTS: DEFAULTS, PATTERNS: PATTERNS, ALLOCATIONS: ALLOCATIONS, PRESETS: PRESETS, merge: merge, validate: validate, warnings: warnings, efficiency: efficiency, start: start, run: run, pattern: pattern, rng: rng, std: std };
});
