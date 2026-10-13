// PharmaSim — the model. A system-dynamics model of a pharmaceutical supply chain, integrated in time steps of dt
// weeks: market demand → (optional distributor) → manufacturer's finished goods (aged first-in, first-out, so shelf
// life is real) ← QA release (a third-order delay that can reject batches) ← production (workforce × productivity,
// capped by the plant) ← a planning rule that anchors on the forecast and corrects inventory and, with a weight, the
// supply line. Pure: no DOM. window.PSModel in the browser, module.exports in Node.
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
    noise: 5, noiseCorr: 2, serviceCover: 2,
    // supply disruption
    outage: false, outageWeek: 30, outageWeeks: 4, outageLeft: 0,
    // network
    retailTier: false, transitTime: 2, distCoverage: 3, shareDemand: false,
    // plant and quality
    productivity: 200, ceiling: 140, qaTime: 3, rejectRate: 2, shelfLife: 104, minRemaining: 26,
    // planning policy
    coverage: 4, forecastTime: 6, invAdjTime: 6, wfAdjTime: 10, supplyLineWeight: 0, employmentTime: 100,
    // levers
    overtime: false, overtimeMax: 20,
    expediteQA: false, expediteTrigger: 75, expediteSpeed: 50, expediteReject: 3, expediteCost: 1.5,
    // economics (per pack, per worker-week)
    price: 30, material: 10, wage: 1500, hireCost: 6000, otPremium: 50, holding: 0.06, shortagePenalty: 20, disposal: 2
  };
  var PATTERNS = ["none", "step", "pulse", "seasonal"];
  var ORDER_TIME = 1;   // weeks to process an order between the distributor and the manufacturer
  // Share of the week's orders that can be shipped, given the stock on hand. Stock is spread over many presentations,
  // pack sizes and markets, so service starts to slip before the total runs out: everything ships while there are at
  // least serviceCover weeks of stock, and the share falls smoothly to zero below that (g(y) = 2y − y², y = cover ratio).
  function fulfil(stock, want, cover) {
    if (want <= 0) return 0;
    var y = stock / (want * cover);
    return y >= 1 ? want : want * Math.max(0, 2 * y - y * y);
  }

  function merge(p) { var o = {}, k; for (k in DEFAULTS) o[k] = DEFAULTS[k]; for (k in p || {}) if (p[k] !== undefined) o[k] = p[k]; return o; }

  // the checks a set of inputs must pass before it is run (messages are translated by pattern in the app)
  function validate(p) {
    var e = [];
    if (!(p.dt > 0 && p.dt <= 0.5)) e.push("The time step must be between 0 and 0.5 weeks.");
    if (!(p.weeks >= 8 && p.weeks <= 520)) e.push("The horizon must be between 8 and 520 weeks.");
    if (!(p.demand > 0)) e.push("Demand must be positive.");
    if (PATTERNS.indexOf(p.pattern) < 0) e.push("Unknown demand pattern: " + p.pattern + ".");
    ["qaTime", "forecastTime", "invAdjTime", "wfAdjTime", "employmentTime", "productivity", "coverage", "noiseCorr", "serviceCover"].forEach(function (k) { if (!(p[k] > 0)) e.push(k + " must be positive."); });
    if (p.retailTier && !(p.transitTime > 0 && p.distCoverage > 0)) e.push("The distributor needs a positive transit time and cover.");
    if (!(p.rejectRate >= 0 && p.rejectRate + (p.expediteQA ? p.expediteReject : 0) < 100)) e.push("The QA rejection rate must stay below 100%.");
    if (!(p.shelfLife - p.minRemaining > p.qaTime + 1)) e.push("Shelf life minus the minimum remaining life must exceed the QA time by more than a week, or nothing could be sold.");
    if (!(p.supplyLineWeight >= 0 && p.supplyLineWeight <= 1)) e.push("The supply-line weight must be between 0 and 1.");
    if (!(p.coverage >= p.serviceCover)) e.push("The target cover must be at least the cover needed for full service, or the plant could never serve all demand.");
    if (!(p.ceiling >= 100)) e.push("The plant ceiling must be at least 100% of the starting output.");
    return e;
  }

  // a small seeded generator (mulberry32) and normal draws, so a scenario and its baseline see the same demand
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    function u() { a = (a + 0x6d2b79f5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    return function () { var x = 1 - u(), y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
  }
  // the demand pattern without noise, as a multiple of the starting demand
  function pattern(p, t) {
    var s = p.shockSize / 100;
    switch (p.pattern) {
      case "step": return t >= p.shockWeek ? 1 + s : 1;
      case "pulse": return t >= p.shockWeek && t < p.shockWeek + p.pulseWeeks ? 1 + s : 1;
      case "seasonal": return 1 + (p.seasonAmp / 100) * Math.sin(2 * Math.PI * t / p.seasonPeriod);
      default: return 1;
    }
  }
  // exact first-order outflow over a step: stable for any dt, and the same as Euler as dt → 0
  function frac(dt, tau) { return 1 - Math.exp(-dt / tau); }
  // the stock a three-stage delay of total time T holds per unit of flow when it is in balance (→ T as dt → 0)
  function hold(dt, T) { return 3 * dt / frac(dt, T / 3); }

  function run(input) {
    var p = merge(input), errs = validate(p);
    if (errs.length) return { ok: false, errors: errs, params: p };
    var dt = p.dt, n = Math.round(p.weeks / dt), multi = !!p.retailTier;
    var rej0 = p.rejectRate / 100, w = p.supplyLineWeight;
    var D0 = p.demand, P0 = D0 / (1 - rej0);                     // the plant makes enough to cover rejections
    var Cmax = P0 * p.ceiling / 100;                             // what the equipment can make in a week
    var L = Math.round((p.shelfLife - p.minRemaining) / dt);     // age (in steps) after which a pack can no longer be sold
    var entry0 = Math.round(p.qaTime / dt);

    // ---- the starting state: everything balanced at the starting demand
    var age = new Float64Array(L);                               // finished goods by age (steps since manufacture)
    var cov = Math.round(p.coverage / dt);
    for (var i = 0; i < cov && entry0 + i < L; i++) age[entry0 + i] = D0 * dt;   // FIFO in balance: one step's shipments per age
    var qStage = P0 * hold(dt, p.qaTime) / 3, q = [qStage, qStage, qStage]; // QA quarantine, three stages
    var W = P0 / p.productivity;                                  // workforce
    var Fm = D0;                                                  // manufacturer's forecast of incoming orders
    var Id = multi ? D0 * p.distCoverage : 0, Fd = D0;            // distributor stock and forecast
    var tStage = D0 * hold(dt, p.transitTime) / 3, tr = multi ? [tStage, tStage, tStage] : [0, 0, 0];   // in transit to the distributor
    var B = multi ? D0 * ORDER_TIME : 0;                          // manufacturer's order backlog (from the distributor)

    var gauss = rng(p.seed), pink = 0, sigma = p.noise / 100;
    var nscale = sigma * Math.sqrt(2 * p.noiseCorr / dt);         // white noise scaled so the filtered noise has std sigma for any dt
    var A = frac(dt, p.noiseCorr);

    var rows = [], acc = { demand: 0, served: 0, lost: 0, produced: 0, approved: 0, rejected: 0, expired: 0, shippedMfg: 0, hires: 0, otUnits: 0, expedited: 0,
      revenue: 0, cMaterial: 0, cWages: 0, cHiring: 0, cOvertime: 0, cHolding: 0, cShortage: 0, cDisposal: 0, cExpedite: 0 };
    var start = { inv: sum(age), qa: q[0] + q[1] + q[2], dist: Id, transit: tr[0] + tr[1] + tr[2], backlog: B };

    for (var k = 0; k < n; k++) {
      var t = k * dt;
      // ---- market demand (pink noise: white noise smoothed over noiseCorr weeks)
      pink += (nscale * gauss() - pink) * (sigma > 0 ? A : 0);
      var D = Math.max(0, D0 * pattern(p, t) * (1 + pink));
      var Im = sum(age);

      // ---- the distributor (optional): serves the market, orders from the manufacturer
      var served, Od = 0, arr;
      if (multi) {
        served = fulfil(Id, D, p.serviceCover);
        Fd += (D - Fd) * frac(dt, p.forecastTime);
        var SLd = B + tr[0] + tr[1] + tr[2], SLdStar = Fd * (hold(dt, p.transitTime) + ORDER_TIME);
        Od = Math.max(0, Fd + (Fd * p.distCoverage - Id) / p.invAdjTime + w * (SLdStar - SLd) / p.invAdjTime);
      }

      // ---- manufacturer: ship first-in, first-out from what is on hand
      var want = multi ? B / ORDER_TIME : D;
      var Sm = fulfil(Im, want, p.serviceCover);
      takeOldest(age, Sm * dt);
      if (!multi) served = Sm;
      var lost = D - served;

      // ---- forecast of incoming orders (or of market demand, if the distributor shares its sales data)
      var signal = multi ? (p.shareDemand ? D : Od) : D;
      Fm += (signal - Fm) * frac(dt, p.forecastTime);

      // ---- QA status: expedite when stock falls below the trigger
      var target = Fm * p.coverage;
      var expediting = !!p.expediteQA && Im < target * p.expediteTrigger / 100;
      var qaT = p.qaTime * (expediting ? 1 - p.expediteSpeed / 100 : 1);
      var rej = rej0 + (expediting ? p.expediteReject / 100 : 0);

      // ---- planning: forecast + inventory correction (+ backlog) + a weight on the QA supply line, grossed up for rejections
      var Q = q[0] + q[1] + q[2], Qstar = Fm / (1 - rej) * hold(dt, qaT);
      var backlogCorr = multi ? (B - Fm * ORDER_TIME) / p.invAdjTime : 0;
      var desired = Math.max(0, (Fm + (target - Im) / p.invAdjTime + backlogCorr) / (1 - rej) + w * (Qstar - Q) / p.invAdjTime);

      // ---- capacity and production
      var out = p.outage && t >= p.outageWeek && t < p.outageWeek + p.outageWeeks ? p.outageLeft / 100 : 1;
      var regular = W * p.productivity * out, ceil = Cmax * out;
      var avail = Math.min(ceil, W * p.productivity * (1 + (p.overtime ? p.overtimeMax / 100 : 0)) * out);
      var P = Math.min(desired, avail);
      var ot = Math.max(0, P - Math.min(regular, ceil));

      // ---- workforce: hire towards what the plan needs (never beyond what the plant can use); people leave over time
      var Wstar = Math.min(desired, Cmax) / p.productivity;
      var leave = W / p.employmentTime, hire = Math.max(0, leave + (Wstar - W) / p.wfAdjTime);

      // ---- QA: three stages; released packs are approved or rejected
      var fq = frac(dt, qaT / 3), o1 = q[0] * fq, o2 = q[1] * fq, o3 = q[2] * fq;
      q[0] += P * dt - o1; q[1] += o1 - o2; q[2] += o2 - o3;
      var released = o3 / dt, approved = released * (1 - rej), rejected = released * rej;

      // ---- finished goods (already shipped from, oldest first): everything ages one step, and what reaches the age
      // limit can no longer be sold and is written off; then the packs QA just released join at the age QA took
      var expired = age[L - 1];
      for (var j = L - 1; j > 0; j--) age[j] = age[j - 1];
      age[0] = 0;
      age[Math.min(L - 1, Math.round(qaT / dt))] += approved * dt;

      // ---- stocks
      W += (hire - leave) * dt;
      if (multi) {
        var f2 = frac(dt, p.transitTime / 3), m1 = tr[0] * f2, m2 = tr[1] * f2, m3 = tr[2] * f2;
        tr[0] += Sm * dt - m1; tr[1] += m1 - m2; tr[2] += m2 - m3;
        arr = m3 / dt;
        Id += (arr - served) * dt;
        B += (Od - Sm) * dt;
      }

      // ---- the manufacturer's money
      var labUnit = p.wage / p.productivity;
      var c = {
        revenue: p.price * Sm, cMaterial: p.material * P, cWages: p.wage * W, cHiring: p.hireCost * hire, cOvertime: labUnit * p.otPremium / 100 * ot,
        cHolding: p.holding * Im, cShortage: p.shortagePenalty * lost, cDisposal: p.disposal * (rejected + expired / dt), cExpedite: expediting ? p.expediteCost * released : 0
      };
      for (var key in c) acc[key] += c[key] * dt;
      acc.demand += D * dt; acc.served += served * dt; acc.lost += lost * dt; acc.produced += P * dt; acc.approved += approved * dt;
      acc.rejected += rejected * dt; acc.expired += expired; acc.shippedMfg += Sm * dt; acc.hires += hire * dt; acc.otUnits += ot * dt; acc.expedited += expediting ? released * dt : 0;
      var profitRate = c.revenue - c.cMaterial - c.cWages - c.cHiring - c.cOvertime - c.cHolding - c.cShortage - c.cDisposal - c.cExpedite;

      rows.push({
        t: t, demand: D, served: served, lost: lost, ordersToMfg: multi ? Od : D, forecast: Fm, production: P, desired: desired, capacity: avail, overtime: ot,
        released: released, approved: approved, rejected: rejected, expired: expired / dt, shipped: Sm,
        inventory: Im, target: target, qa: Q, workforce: W, distInventory: Id, transit: tr[0] + tr[1] + tr[2], backlog: B,
        expediting: expediting, outage: out < 1, profitRate: profitRate,
        profit: acc.revenue - acc.cMaterial - acc.cWages - acc.cHiring - acc.cOvertime - acc.cHolding - acc.cShortage - acc.cDisposal - acc.cExpedite
      });
    }
    var end = { inv: sum(age), qa: q[0] + q[1] + q[2], dist: Id, transit: tr[0] + tr[1] + tr[2], backlog: B };
    return { ok: true, params: p, rows: rows, totals: acc, start: start, end: end, kpi: kpis(p, rows, acc), multi: multi, maxAge: L * dt };
  }

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  // ship the oldest packs first
  function takeOldest(a, amt) {
    for (var i = a.length - 1; i >= 0 && amt > 1e-12; i--) { var x = Math.min(a[i], amt); a[i] -= x; amt -= x; }
  }
  function std(xs) { var m = 0, i; for (i = 0; i < xs.length; i++) m += xs[i]; m /= xs.length; var v = 0; for (i = 0; i < xs.length; i++) v += (xs[i] - m) * (xs[i] - m); return Math.sqrt(v / xs.length); }

  // the headline numbers
  function kpis(p, rows, a) {
    var dem = rows.map(function (r) { return r.demand; }), prod = rows.map(function (r) { return r.production; }), ord = rows.map(function (r) { return r.ordersToMfg; });
    var sd = std(dem);
    var unitCost = p.material + p.wage / p.productivity;
    // weeks in which less than 99% of the week's demand was served
    var short = 0, per = Math.round(1 / p.dt);
    for (var k = 0; k + per <= rows.length; k += per) { var d = 0, s = 0; for (var j = k; j < k + per; j++) { d += rows[j].demand; s += rows[j].served; } if (d > 0 && s / d < 0.99) short++; }
    var profit = a.revenue - a.cMaterial - a.cWages - a.cHiring - a.cOvertime - a.cHolding - a.cShortage - a.cDisposal - a.cExpedite;
    return {
      profit: profit,
      fillRate: a.demand > 0 ? a.served / a.demand : 1,
      lost: a.lost,
      shortWeeks: short,
      // amplification: how much more production varies than market demand (1 = it simply follows demand)
      bullwhip: sd > 1e-9 ? std(prod) / sd : null,
      orderBullwhip: sd > 1e-9 ? std(ord) / sd : null,
      peakProduction: Math.max.apply(null, prod),
      wasteUnits: a.rejected + a.expired, expiredUnits: a.expired, rejectedUnits: a.rejected,
      wasteCost: (a.rejected + a.expired) * (unitCost + p.disposal),
      avgInventory: rows.reduce(function (s, r) { return s + r.inventory; }, 0) / rows.length,
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
    calm: { label: "Calm market (noise only)", values: { pattern: "none", noise: 10 } }
  };

  return { DEFAULTS: DEFAULTS, PATTERNS: PATTERNS, PRESETS: PRESETS, merge: merge, validate: validate, run: run, pattern: pattern, rng: rng, std: std };
});
