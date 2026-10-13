// PharmaSim — the page: builds the inputs from src/specs.js, runs src/model.js on every change, and shows the
// headline, the results, the charts, the diagram and the equations, with a saved baseline that sees the same random
// demand. window.PSApp is the interface the tutorial uses.
(function () {
  "use strict";
  var APP_VERSION = "3.1.0";
  var M = window.PSModel, S = window.PSSpecs, EQ = window.PSEquations, I18 = window.PSi18n, T = I18.T, tw = I18.tw;
  var $ = function (id) { return document.getElementById(id); }, listeners = [];
  var state = { p: M.merge(M.PRESETS.step.values), preset: "step", base: null, baseParams: null, res: null, hoverT: null, diagram: null, diagramMulti: null, charts: {} };

  // ---- formatting
  var num = function (v, d) { return (v == null || !isFinite(v)) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  function money(v, sign) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v), s = v < 0 ? "−" : sign && v > 0 ? "+" : "";
    return s + (a >= 1e6 ? "$" + (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + (a / 1e3).toFixed(0) + "k" : "$" + a.toFixed(0));
  }
  var pct = function (v, d) { return (v * 100).toFixed(d == null ? 1 : d) + "%"; };
  function signed(v, d, suffix) { if (v == null || !isFinite(v)) return "—"; var r = v.toFixed(d); if (+r === 0) return "±0" + (suffix || ""); return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(d) + (suffix || ""); }
  function unit(u) { return u ? T(u) : ""; }
  function showVal(c, v) {
    if (c.type === "toggle") return v ? T("on") : T("off");
    if (c.zero && v === 0) return T(c.zero);
    var d = c.step < 0.1 ? 2 : c.step < 1 ? 1 : 0;
    var s = num(v, d);
    return c.unit === "%" ? s + "%" : c.unit ? s + " " + unit(c.unit) : s;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---- the rail
  function start() { return M.merge(M.PRESETS[state.preset] ? M.PRESETS[state.preset].values : {}); }
  function buildRail() {
    var sel = $("preset");
    sel.innerHTML = Object.keys(M.PRESETS).map(function (k) { return "<option value='" + k + "'>" + T(M.PRESETS[k].label) + "</option>"; }).join("");
    var host = $("controls"); host.innerHTML = "";
    S.GROUPS.forEach(function (g) {
      var sec = document.createElement("section"); sec.className = "rail-section"; sec.id = "g_" + g.id;
      sec.innerHTML = "<h2>" + T(g.title) + "</h2>";
      g.controls.forEach(function (c) {
        var d = document.createElement("div"); d.className = "ctrl"; d.id = "c_" + c.key; d.setAttribute("data-key", c.key);
        var note = c.note ? "<div class='note'>" + T(c.note) + "</div>" : "";
        if (c.type === "toggle") {
          d.innerHTML = "<label class='switch'><span class='name'>" + T(c.label) + "</span><input type='checkbox' id='in_" + c.key + "'><span class='knob' aria-hidden='true'></span></label>" + note;
        } else if (c.type === "select") {
          d.innerHTML = "<label class='name' for='in_" + c.key + "'>" + T(c.label) + "</label><select class='choice' id='in_" + c.key + "'>" + c.options.map(function (o) { return "<option value='" + o[0] + "'>" + T(o[1]) + "</option>"; }).join("") + "</select>" + note;
        } else {
          d.innerHTML = "<div class='row-head'><label class='name' for='in_" + c.key + "'>" + T(c.label) + "</label><output class='val' id='out_" + c.key + "'></output></div>" +
            "<input type='range' id='in_" + c.key + "' min='" + c.min + "' max='" + c.max + "' step='" + c.step + "'>" + note;
        }
        sec.appendChild(d);
        var input = d.querySelector("#in_" + c.key);
        input.addEventListener(c.type === "range" || !c.type ? "input" : "change", function () {
          var v = c.type === "toggle" ? input.checked : c.type === "select" ? input.value : +input.value;
          state.p[c.key] = v; syncRail(); recompute();
        });
      });
      host.appendChild(sec);
    });
  }
  function syncRail() {
    var s = start();
    $("preset").value = state.preset;
    S.GROUPS.forEach(function (g) {
      var anyShown = false;
      g.controls.forEach(function (c) {
        var d = $("c_" + c.key), input = $("in_" + c.key), v = state.p[c.key];
        var shown = !c.show || c.show(state.p); d.hidden = !shown; anyShown = anyShown || shown;
        if (c.type === "toggle") input.checked = !!v; else input.value = v;
        if (!c.type || c.type === "range") { $("out_" + c.key).textContent = showVal(c, v); input.setAttribute("aria-valuetext", showVal(c, v)); }
        d.classList.toggle("changed", v !== s[c.key]);
      });
      $("g_" + g.id).hidden = !anyShown;
    });
  }

  // ---- running the model and showing the results
  function recompute() {
    var res = M.run(state.p), err = $("errors");
    if (!res.ok) { err.hidden = false; err.innerHTML = res.errors.map(function (e) { return "● " + tw(e); }).join("<br>"); return; }
    err.hidden = true;
    state.res = res;
    var notes = $("notes"); notes.hidden = !res.warnings.length; notes.innerHTML = res.warnings.map(function (e) { return "● " + tw(e); }).join("<br>");
    headline(); kpis(); compareBar(); charts(); model(); saveHash();
    listeners.forEach(function (fn) { try { fn(res); } catch (e) { if (window.console) console.error(e); } });
  }
  function headline() {
    var k = state.res.kpi, p = state.res.params, b = state.base && state.base.kpi;
    var parts = T("Over {w} weeks the plant served <b>{fill}</b> of demand", { w: p.weeks, fill: pct(k.fillRate, 2) }) +
      (k.lost > 0.5 ? T(" ({lost} packs short, in {n} weeks)", { lost: num(k.lost), n: k.shortWeeks }) : "") + ". ";
    parts += k.bullwhip == null ? T("Demand stayed level, so there was nothing to amplify") : T("Production swung <b>{bw}×</b> as much as demand", { bw: k.bullwhip.toFixed(2) }) + (state.res.multi && k.orderBullwhip != null ? T(", and the distributor's orders {obw}×", { obw: k.orderBullwhip.toFixed(2) }) : "");
    parts += T("; <b>{waste}</b> packs were wasted and profit was <b>{profit}</b>.", { waste: num(k.wasteUnits), profit: money(k.profit) });
    if (b) parts += "<span class='cmp'>" + T("Against the baseline: profit {dp}, fill rate {df} points, waste {dw} packs, bullwhip {db}.", {
      dp: money(k.profit - b.profit, true), df: signed((k.fillRate - b.fillRate) * 100, 2), dw: signed(k.wasteUnits - b.wasteUnits, 0).replace(/(\d)(?=(\d{3})+$)/g, "$1,"),
      db: k.bullwhip != null && b.bullwhip != null ? signed(k.bullwhip - b.bullwhip, 2) : "—" }) + "</span>";
    $("headline").innerHTML = parts;
  }
  function tile(label, value, sub, delta, status) {
    return "<div class='kpi-tile" + (status ? " status-" + status : "") + "'><div class='kpi-label'>" + label + "</div><div class='kpi-value'>" + value + "</div><div class='kpi-sub'>" + sub + "</div>" + (delta || "") + "</div>";
  }
  // a change against the baseline, coloured by whether it is better (good = +1 when higher is better)
  function delta(cur, base, good, fmt) {
    if (base == null || cur == null) return "";
    var d = cur - base, tiny = Math.abs(d) < 1e-9 * Math.max(1, Math.abs(base));
    var cls = tiny || !good ? "same" : (d > 0) === (good > 0) ? "up" : "down";
    return "<div class='kpi-delta " + cls + "'>" + T("vs baseline {d}", { d: tiny ? "±0" : fmt(d) }) + "</div>";
  }
  function kpis() {
    var r = state.res, k = r.kpi, p = r.params, b = state.base ? state.base.kpi : null, B = function (f) { return b ? f(b) : null; };
    var avgDemand = r.totals.demand / p.weeks, waste = k.wasteUnits / Math.max(1, r.totals.demand);
    var html = [
      tile(T("Profit"), money(k.profit), T("revenue minus every cost, {w} weeks", { w: p.weeks }), delta(k.profit, B(function (x) { return x.profit; }), 1, function (d) { return money(d, true); })),
      tile(T("Fill rate"), pct(k.fillRate, 2), T("{n} packs not supplied", { n: num(k.lost) }) + (k.criticalFill != null && p.criticalShare < 100 ? " · " + T("critical patients {c}", { c: pct(k.criticalFill, 2) }) : ""), delta(k.fillRate * 100, B(function (x) { return x.fillRate * 100; }), 1, function (d) { return signed(d, 2, " " + T("pts")); }), k.fillRate < 0.98 ? "critical" : k.fillRate < 0.995 ? "warning" : null),
      tile(T("Weeks short"), num(k.shortWeeks), T("weeks with under 99% of demand served"), delta(k.shortWeeks, B(function (x) { return x.shortWeeks; }), -1, function (d) { return signed(d, 0); }), k.shortWeeks > 8 ? "warning" : null),
      tile(T("Bullwhip"), k.bullwhip == null ? "—" : k.bullwhip.toFixed(2) + "×", k.bullwhip == null ? T("demand did not vary") : T("production varies {x}× as much as demand", { x: k.bullwhip.toFixed(2) }), delta(k.bullwhip, B(function (x) { return x.bullwhip; }), -1, function (d) { return signed(d, 2); }), k.bullwhip > 1.5 ? "warning" : null),
      r.multi ? tile(T("Distributor's orders"), k.orderBullwhip == null ? "—" : k.orderBullwhip.toFixed(2) + "×", T("its orders vary this much more than demand"), delta(k.orderBullwhip, B(function (x) { return x.orderBullwhip; }), -1, function (d) { return signed(d, 2); }), k.orderBullwhip > 1.5 ? "warning" : null)
        : tile(T("Peak production"), num(k.peakProduction), T("packs/wk · {x} of the starting output", { x: pct(k.peakProduction / (p.demand / (1 - p.rejectRate / 100)), 0) }) + (k.labWeeks > 0 ? " · " + T("the QA lab at its limit for {w} weeks", { w: num(k.labWeeks, 0) }) : ""), delta(k.peakProduction, B(function (x) { return x.peakProduction; }), 0, function (d) { return signed(d, 0); }), k.labWeeks > 0 ? "warning" : null),
      r.api ? tile(T("API supplier orders"), k.apiBullwhip == null ? "—" : k.apiBullwhip.toFixed(2) + "×", T("vary this much more than demand") + (k.apiShortUnits > 0.5 ? " · " + T("{n} packs not made for lack of API", { n: num(k.apiShortUnits) }) : ""), delta(k.apiBullwhip, B(function (x) { return x.apiBullwhip; }), -1, function (d) { return signed(d, 2); }), k.apiShortUnits > 0.5 ? "critical" : k.apiBullwhip > 3 ? "warning" : null) : null,
      tile(T("Waste"), num(k.wasteUnits) + " " + T("packs"), T("{e} written off · {r} rejected · {v}", { e: num(k.expiredUnits), r: num(k.rejectedUnits), v: money(k.wasteCost) }), delta(k.wasteUnits, B(function (x) { return x.wasteUnits; }), -1, function (d) { return signed(d, 0); }), waste > 0.04 ? "warning" : null),
      tile(T("Average stock"), num(k.avgInventory / avgDemand, 1) + " " + T("wk"), T("{n} packs on hand on average", { n: num(k.avgInventory) }), delta(k.avgInventory, B(function (x) { return x.avgInventory; }), 0, function (d) { return signed(d, 0); })),
      tile(T("Workforce"), num(k.peakWorkforce, 0) + " " + T("people"), T("at the peak · {h} hired", { h: num(k.hires) }), delta(k.peakWorkforce, B(function (x) { return x.peakWorkforce; }), -1, function (d) { return signed(d, 1); }))
    ];
    $("kpis").innerHTML = html.filter(Boolean).join("");
  }
  function compareBar() {
    var has = !!state.base;
    $("cmp-msg").innerHTML = has ? T("Comparing with the baseline <b>{name}</b>. Change anything and the differences appear beside every result.", { name: state.baseLabel }) : T("Save this run as a baseline, change a lever or the policy, and see the difference on every result.");
    $("btn-base").textContent = has ? T("Replace baseline") : T("Save as baseline");
    $("btn-base-clear").hidden = !has;
  }

  // ---- charts
  function weekly(res) {
    var per = Math.round(1 / res.params.dt), out = [];
    for (var k = 0; k + per <= res.rows.length; k += per) {
      var d = 0, s = 0, dc = 0, sc = 0;
      for (var j = k; j < k + per; j++) { var r = res.rows[j]; d += r.demand; s += r.served; dc += r.critDemand; sc += r.critServed; }
      out.push({ t: res.rows[k].t, fill: d > 0 ? 100 * s / d : 100, crit: dc > 0 ? 100 * sc / dc : null, other: d - dc > 0 ? 100 * (s - sc) / (d - dc) : null });
    }
    return out;
  }
  function withWaste(res) {
    var dt = res.params.dt, cr = 0, ce = 0;
    return res.rows.map(function (r) { cr += r.rejected * dt; ce += r.expired * dt; return { cumRej: cr, cumExp: ce, cumWaste: cr + ce }; });
  }
  function bands(res) {
    var out = [], p = res.params;
    if (p.outage) out.push({ from: p.outageWeek, to: Math.min(p.weeks, p.outageWeek + p.outageWeeks), cls: "outage", label: T("Plant outage") });
    if (p.apiTier && p.apiOutage) out.push({ from: p.apiOutageWeek, to: Math.min(p.weeks, p.apiOutageWeek + p.apiOutageWeeks), cls: "apioutage", label: T("API supplier outage") });
    var lab = null; res.rows.forEach(function (r, i) { if (r.labBound && lab == null) lab = r.t; if ((!r.labBound || i === res.rows.length - 1) && lab != null) { out.push({ from: lab, to: r.t, cls: "lab", label: T("QA lab at its limit") }); lab = null; } });
    var on = null; res.rows.forEach(function (r, i) { if (r.expediting && on == null) on = r.t; if ((!r.expediting || i === res.rows.length - 1) && on != null) { out.push({ from: on, to: r.t, cls: "expedite", label: T("Expediting QA") }); on = null; } });
    return out;
  }
  function charts() {
    var res = state.res, base = state.base, multi = res.multi, api = res.api, crit = res.params.criticalShare > 0 && res.params.allocation === "critical";
    var bw = base ? withWaste(base) : null, rw = withWaste(res), wk = weekly(res), bwk = base ? weekly(base) : null;
    var same = base && base.rows.length === res.rows.length && base.params.dt === res.params.dt;
    var rows = res.rows.map(function (r, i) {
      var o = { t: r.t, demand: r.demand, orders: multi ? r.ordersToMfg : null, production: r.production, capacity: r.capacity, inventory: r.inventory, target: r.target,
        dist: multi ? r.distInventory : null, api: api ? r.apiStock : null, apiOrders: api ? r.apiOrders : null, profit: r.profit / 1e6, workforce: r.workforce, cumRej: rw[i].cumRej, cumExp: rw[i].cumExp };
      if (same) { var b = base.rows[i]; o.bProduction = b.production; o.bInventory = b.inventory; o.bProfit = b.profit / 1e6; o.bWorkforce = b.workforce; o.bWaste = bw[i].cumWaste; }
      return o;
    });
    var wrows = wk.map(function (r, i) { return { t: r.t, fill: r.fill, crit: crit ? r.crit : null, other: crit ? r.other : null, bFill: bwk && bwk[i] && same ? bwk[i].fill : null }; });
    var C = { d: css("--s-demand"), s1: css("--s1"), s2: css("--s2"), s3: css("--s3"), s4: css("--s4"), b: css("--s-base") };
    var bd = bands(res), wkLabel = T("week"), tipT = function (r) { return T("Week {w}", { w: num(r.t, r.t % 1 ? 2 : 0) }); };
    var hover = function (t) { state.hoverT = t; modelValues(); };
    var defs = {
      "ch-prod": { height: 250, auto: true, yFmt: function (v) { return num(v); }, series: [
        { key: "demand", label: T("Market demand"), color: C.d, width: 1.5 },
        multi ? { key: "orders", label: T("Distributor's orders"), color: C.s2 } : null,
        api ? { key: "apiOrders", label: T("API orders"), color: C.s3, width: 1.5 } : null,
        { key: "production", label: T("Production"), color: C.s1, width: 2.5 },
        { key: "capacity", label: T("Capacity"), color: C.s4, width: 1.5, dash: "2 4" },
        same ? { key: "bProduction", label: T("Baseline production"), color: C.b, dash: "5 4" } : null ] },
      "ch-stock": { yFmt: function (v) { return num(v); }, series: [
        { key: "inventory", label: T("Plant stock"), color: C.s1, area: true },
        { key: "target", label: T("Target stock"), color: C.d, width: 1.2, dash: "4 4" },
        multi ? { key: "dist", label: T("Distributor stock"), color: C.s3 } : null,
        api ? { key: "api", label: T("API stock"), color: C.s4 } : null,
        same ? { key: "bInventory", label: T("Baseline plant stock"), color: C.b, dash: "5 4" } : null ] },
      "ch-profit": { yFmt: function (v) { return money(v * 1e6); }, series: [
        { key: "profit", label: T("Profit"), color: C.s1, width: 2.5 },
        same ? { key: "bProfit", label: T("Baseline profit"), color: C.b, dash: "5 4" } : null ] },
      "ch-people": { yFmt: function (v) { return num(v); }, tipFmt: function (v) { return num(v, 1); }, series: [
        { key: "workforce", label: T("Workforce"), color: C.s1, width: 2.5 },
        same ? { key: "bWorkforce", label: T("Baseline workforce"), color: C.b, dash: "5 4" } : null ] },
      "ch-waste": { height: 180, yFmt: function (v) { return num(v); }, series: [
        { key: "cumRej", label: T("Rejected in QA"), color: C.s4 },
        { key: "cumExp", label: T("Written off (short-dated)"), color: C.s2 },
        same ? { key: "bWaste", label: T("Baseline total waste"), color: C.b, dash: "5 4" } : null ] }
    };
    Object.keys(defs).forEach(function (id) {
      var d = defs[id];
      var opts = { rows: rows, series: d.series.filter(Boolean), bands: bd, yFmt: d.yFmt, tipFmt: d.tipFmt, yMin: d.auto ? null : 0, height: d.height || 200, xLabel: wkLabel, tipTitle: tipT, onHover: hover, ariaLabel: T("Chart") };
      if (state.charts[id]) state.charts[id].update(opts); else state.charts[id] = window.PSCharts.line($(id), opts);
    });
    var lows = [];
    wrows.forEach(function (r) { [r.fill, r.crit, r.other, r.bFill].forEach(function (v) { if (v != null) lows.push(v); }); });
    var sopts = { rows: wrows, series: [{ key: "fill", label: T("Demand served"), color: C.s1, width: 2 }]
        .concat(crit ? [{ key: "crit", label: T("Critical patients"), color: C.s3, width: 1.5 }, { key: "other", label: T("Other patients"), color: C.s2, width: 1.5 }] : [])
        .concat(same && bwk ? [{ key: "bFill", label: T("Baseline"), color: C.b, dash: "5 4" }] : []), bands: bd,
      yFmt: function (v) { return v.toFixed(0) + "%"; }, tipFmt: function (v) { return v.toFixed(1) + "%"; }, yMax: 100, yMin: Math.min(90, Math.floor(Math.min.apply(null, lows) / 5) * 5), height: 200, xLabel: wkLabel, tipTitle: tipT, onHover: hover, ariaLabel: T("Chart") };
    if (state.charts["ch-service"]) state.charts["ch-service"].update(sopts); else state.charts["ch-service"] = window.PSCharts.line($("ch-service"), sopts);
  }

  // ---- the model panel: diagram and equations, at the week the reader points at
  function model() {
    var shape = (state.res.multi ? "m" : "") + (state.res.api ? "a" : "");
    if (state.diagramMulti !== shape) { state.diagram = window.PSDiagram.render($("diagram"), state.res.multi, state.res.api); state.diagramMulti = shape; }
    var html = "";
    EQ.SECTIONS.forEach(function (sec, si) {
      if (sec.tier && !state.res.multi) return;
      if (sec.api && !state.res.api) return;
      html += "<div class='eq-sec'><h3>" + T(sec.title) + "</h3>" + sec.items.map(function (it, ii) {
        return "<div class='eq-row'><span class='n'>" + T(it.name) + "</span><span class='e'>" + T(it.eq) + (it.note ? "<small>" + T(it.note) + "</small>" : "") + "</span><span class='v' data-eq='" + si + "." + ii + "'></span></div>";
      }).join("") + "</div>";
    });
    $("equations").innerHTML = html;
    modelValues();
  }
  function modelValues() {
    var res = state.res; if (!res) return;
    var rows = res.rows, r = rows[rows.length - 1], hovering = state.hoverT != null;
    if (hovering) r = rows.reduce(function (a, x) { return Math.abs(x.t - state.hoverT) < Math.abs(a.t - state.hoverT) ? x : a; }, rows[0]);
    $("eq-week").textContent = hovering ? T("Values in week {w}", { w: num(r.t, r.t % 1 ? 2 : 0) }) : T("Values at the end of week {w} — point at a chart to see another week", { w: num(r.t, r.t % 1 ? 2 : 0) });
    window.PSDiagram.update(state.diagram, r);
    var k = res.kpi;
    document.querySelectorAll("#equations [data-eq]").forEach(function (span) {
      var ix = span.getAttribute("data-eq").split("."), it = EQ.SECTIONS[+ix[0]].items[+ix[1]];
      var v = it.v ? it.v(r, res.params) : null;
      if (it.name === "Fill rate") { span.textContent = pct(k.fillRate, 2); return; }
      if (it.name === "Bullwhip (production)") { span.textContent = k.bullwhip == null ? "—" : k.bullwhip.toFixed(2) + "×"; return; }
      span.textContent = v == null ? "" : (it.u.charAt(0) === "$" ? money(v) : num(v, Math.abs(v) < 100 ? 1 : 0)) + (it.u && it.u.charAt(0) !== "$" ? " " + T(it.u) : it.u === "$/wk" ? " " + T("/wk") : "");
    });
  }

  // ---- baseline, seed, link, CSV
  function saveBaseline(label) {
    state.base = state.res; state.baseParams = Object.assign({}, state.p);
    state.baseLabel = label || (M.PRESETS[state.preset] ? T(M.PRESETS[state.preset].label) : T("Your scenario"));
    recompute();
  }
  function clearBaseline() { state.base = null; state.baseParams = null; recompute(); }
  $("btn-base").addEventListener("click", function () { saveBaseline(); });
  $("btn-base-clear").addEventListener("click", clearBaseline);
  $("btn-seed").addEventListener("click", function () {
    var s = 1 + Math.floor(Math.random() * 99999); state.p.seed = s;
    if (state.base) { state.baseParams.seed = s; state.base = M.run(state.baseParams); }
    recompute();
  });
  $("btn-reset").addEventListener("click", function () { applyPreset(state.preset); });
  $("preset").addEventListener("change", function () { applyPreset($("preset").value); });
  function applyPreset(id) { state.preset = id; state.p = start(); syncRail(); recompute(); }
  function flash(btn, text) { var old = btn.textContent; btn.textContent = text; setTimeout(function () { btn.textContent = old; }, 1600); }
  $("btn-link").addEventListener("click", function () {
    var url = location.href, b = $("btn-link");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { flash(b, T("Link copied ✓")); }, function () { prompt(T("Copy this link:"), url); });
    else prompt(T("Copy this link:"), url);
  });
  $("btn-csv").addEventListener("click", function () {
    var cols = ["t", "demand", "served", "lost", "ordersToMfg", "forecast", "desired", "production", "capacity", "overtime", "qa", "approved", "rejected", "expired", "inventory", "target", "shipped", "workforce", "distInventory", "transit", "backlog", "profitRate", "profit"];
    var csv = ["week," + cols.slice(1).join(",")].concat(state.res.rows.map(function (r) { return cols.map(function (c) { var v = r[c]; return typeof v === "number" ? +v.toFixed(4) : v; }).join(","); })).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "pharmasim-run.csv"; document.body.appendChild(a); a.click(); a.remove();
  });
  // the scenario lives in the address (#s=…), so a link reopens it exactly
  function saveHash() {
    var d = {}, s = start(); Object.keys(state.p).forEach(function (k) { if (state.p[k] !== s[k]) d[k] = state.p[k]; });
    var enc = btoa(unescape(encodeURIComponent(JSON.stringify({ pr: state.preset, v: d }))));
    try { history.replaceState(null, "", location.pathname + location.search + "#s=" + enc); } catch (e) { /* the link just does not update */ }
  }
  function loadHash() {
    var m = /#s=([^&]+)/.exec(location.hash); if (!m) return;
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      if (o.pr && M.PRESETS[o.pr]) state.preset = o.pr;
      state.p = start(); Object.keys(o.v || {}).forEach(function (k) { if (k in M.DEFAULTS) state.p[k] = o.v[k]; });
    } catch (e) { /* a broken link opens the default scenario */ }
  }

  // ---- the interface the tutorial drives
  window.PSApp = {
    // opts.preset: start from a preset (defaults otherwise); opts.baseline: "save" (after the preset) or "clear"
    set: function (values, opts) {
      opts = opts || {};
      if (opts.preset !== undefined) { state.preset = opts.preset || "step"; state.p = start(); }
      if (opts.baseline === "clear") { state.base = null; state.baseParams = null; }
      if (opts.baseline === "save") {
        var bp = Object.assign({}, state.p, opts.baselineValues || {}), r = M.run(bp);
        if (r.ok) { state.base = r; state.baseParams = bp; state.baseLabel = T(M.PRESETS[state.preset].label); }
      }
      Object.keys(values || {}).forEach(function (k) { state.p[k] = values[k]; });
      syncRail(); recompute();
    },
    params: function () { return Object.assign({}, state.p); },
    result: function () { return state.res; },
    baseline: function () { return state.base; },
    baselineParams: function () { return state.baseParams ? Object.assign({}, state.baseParams) : null; },
    preset: function () { return state.preset; },
    onChange: function (fn) { listeners.push(fn); },
    version: APP_VERSION
  };

  // ---- start
  $("ver").textContent = "v" + APP_VERSION; $("ver-foot").textContent = "v" + APP_VERSION;
  loadHash(); buildRail(); syncRail(); recompute();
})();
