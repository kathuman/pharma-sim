// Supply Pulse — the decision lab: saved scenarios side by side, many demand futures, sensitivity and the policy search,
// on top of src/analysis.js. Works through window.SPApp; every option is run on the same random futures.
(function () {
  "use strict";
  var APP = window.SPApp, A = window.SPAnalysis, M = window.SPModel, S = window.SPSpecs, I18 = window.PSi18n, T = I18.T, CH = window.SPCharts;
  if (!APP || !A) return;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "sp-scenarios-v1", tab = "scn", timer = null, optRun = null, optResult = null, optStamp = null;
  var num = function (v, d) { return v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var money = function (v, sign) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = v < 0 ? "−" : sign && v > 0 ? "+" : ""; return s + (a >= 1e6 ? "$" + (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + (a / 1e3).toFixed(0) + "k" : "$" + a.toFixed(0)); };
  var pct = function (v, d) { return v == null ? "—" : (v * 100).toFixed(d == null ? 2 : d) + "%"; };
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var stamp = function (p) { return JSON.stringify(p); };

  // ---- tabs
  document.querySelectorAll("#p-lab [data-tab]").forEach(function (b) {
    b.addEventListener("click", function () {
      tab = b.getAttribute("data-tab");
      document.querySelectorAll("#p-lab [data-tab]").forEach(function (x) { var on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
      ["scn", "fut", "sens", "opt"].forEach(function (k) { $("pane-" + k).hidden = k !== tab; });
      refresh(true);
    });
  });
  function refresh(now) {
    clearTimeout(timer);
    var go = function () { if (tab === "scn") scenarios(); else if (tab === "fut") futures(); else if (tab === "sens") sensitivity(); else if (tab === "opt") optimiserState(); };
    if (now) go(); else timer = setTimeout(go, 250);
  }
  APP.onChange(function () { refresh(false); });

  // ---- saved scenarios
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (e) { return []; } }
  function store(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  var ROWS = [
    [T("Profit"), "profit", 1, function (k) { return money(k.profit); }],
    [T("Fill rate"), "fillRate", 1, function (k) { return pct(k.fillRate); }],
    [T("Priority customers served"), "criticalFill", 1, function (k) { return pct(k.criticalFill); }],
    [T("Weeks short"), "shortWeeks", -1, function (k) { return num(k.shortWeeks); }],
    [T("Bullwhip"), "bullwhip", -1, function (k) { return k.bullwhip == null ? "—" : k.bullwhip.toFixed(2) + "×"; }],
    [T("Waste"), "wasteUnits", -1, function (k) { return num(k.wasteUnits); }],
    [T("Average stock"), "avgInventory", -1, function (k) { return num(k.avgInventory); }],
    [T("Peak workforce"), "peakWorkforce", -1, function (k) { return num(k.peakWorkforce, 1); }]
  ];
  function scenarios() {
    var list = load(), cols = [{ name: T("Current scenario"), params: APP.params(), current: true }].concat(list);
    cols.forEach(function (c) { var r = M.run(c.params); c.kpi = r.ok ? r.kpi : null; });
    var head = "<thead><tr><th></th>" + cols.map(function (c, i) {
      return "<th>" + esc(c.name) + (c.current ? "" : "<div class='scn-actions'><button type='button' data-load='" + (i - 1) + "'>" + T("Load") + "</button><button type='button' data-del='" + (i - 1) + "' aria-label='" + T("Delete {name}", { name: esc(c.name) }) + "'>✕</button></div>") + "</th>";
    }).join("") + "</tr></thead>";
    var body = "<tbody>" + ROWS.map(function (row) {
      var vals = cols.map(function (c) { return c.kpi ? c.kpi[row[1]] : null; }), ok = vals.filter(function (v) { return v != null && isFinite(v); });
      var best = cols.length > 1 && ok.length > 1 ? (row[2] > 0 ? Math.max.apply(null, ok) : Math.min.apply(null, ok)) : null;
      return "<tr><th>" + row[0] + "</th>" + cols.map(function (c, i) { var v = vals[i]; return "<td" + (best != null && v != null && Math.abs(v - best) < 1e-9 * Math.max(1, Math.abs(best)) ? " class='best'" : "") + ">" + (c.kpi ? row[3](c.kpi) : "—") + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    $("scn-table").innerHTML = head + body;
    $("scn-empty").hidden = list.length > 0;
    $("scn-table").querySelectorAll("[data-load]").forEach(function (b) { b.addEventListener("click", function () { var s = load()[+b.getAttribute("data-load")]; if (s) APP.set(s.params, { preset: s.preset }); }); });
    $("scn-table").querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { var l = load(); l.splice(+b.getAttribute("data-del"), 1); store(l); scenarios(); }); });
    state.cols = cols;
  }
  var state = { cols: [] };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  $("scn-save").addEventListener("click", function () {
    var l = load(), name = ($("scn-name").value || "").trim() || T("Scenario {n}", { n: l.length + 1 });
    l.push({ name: name.slice(0, 40), preset: APP.preset(), params: APP.params() });
    $("scn-msg").textContent = store(l) ? T("Saved ✓") : T("This browser cannot store scenarios.");
    $("scn-name").value = ""; scenarios();
    setTimeout(function () { $("scn-msg").textContent = ""; }, 1800);
  });
  $("scn-csv").addEventListener("click", function () {
    var cols = state.cols, lines = [["result"].concat(cols.map(function (c) { return '"' + String(c.name).replace(/"/g, '""') + '"'; })).join(",")];
    ROWS.forEach(function (row) { lines.push([row[1]].concat(cols.map(function (c) { var v = c.kpi ? c.kpi[row[1]] : null; return v == null ? "" : +(+v).toFixed(6); })).join(",")); });
    download("supply-pulse-scenarios.csv", lines.join("\n"));
  });
  function download(name, text) { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  // ---- many futures
  function futures() {
    var n = +$("fut-n").value, p = APP.params(), f = A.futures(p, n), bp = APP.baselineParams(), b = bp ? A.futures(bp, n) : null;
    if (!f.ok) { $("fut-sum").textContent = ""; return; }
    var s = f.summary, txt = T("In {n} demand futures the fill rate runs from <b>{lo}</b> to <b>{hi}</b> (median {mid}), at least one week is short in <b>{sh}</b> of them, and profit runs from {plo} to {phi}.", {
      n: n, lo: pct(s.fillRate.p10), hi: pct(s.fillRate.p90), mid: pct(s.fillRate.p50), sh: pct(f.shortageChance, 0), plo: money(s.profit.p10), phi: money(s.profit.p90) });
    if (b && b.ok) {
      var hp = A.headToHead(f, b, "profit"), hf = A.headToHead(f, b, "fillRate");
      txt += " " + T("Against the baseline, in the very same futures, it makes more profit in <b>{w}</b> of {n} and serves more customers in <b>{f}</b>.", { w: hp.wins, f: hf.wins, n: hp.n });
    } else txt += " " + T("Save a baseline to see in how many futures your change wins.");
    $("fut-sum").innerHTML = txt;
    var C = { s1: css("--s1"), s2: css("--s2"), b: css("--s-base"), d: css("--s-demand") };
    var rows = f.bands.map(function (x, i) { var o = { t: x.t, fillLo: x.fillLo, fillHi: x.fillHi, fill: x.fillMid, prodLo: x.productionLo, prodHi: x.productionHi, prod: x.productionMid }; if (b && b.ok) { o.bFill = b.bands[i].fillMid; o.bProd = b.bands[i].productionMid; } return o; });
    var common = { rows: rows, xLabel: T("week"), tipTitle: function (r) { return T("Week {w}", { w: r.t }); }, ariaLabel: T("Chart") };
    var lowFill = Math.min.apply(null, rows.map(function (r) { return Math.min(r.fillLo, r.bFill == null ? 100 : r.bFill); }));
    CH.line($("fut-fill"), Object.assign({}, common, { height: 200, yMax: 100, yMin: Math.min(90, Math.floor(lowFill / 5) * 5), yFmt: function (v) { return v.toFixed(0) + "%"; }, tipFmt: function (v) { return v.toFixed(1) + "%"; },
      series: [{ band: ["fillLo", "fillHi"], label: T("Middle 80% of futures"), color: C.s1 }, { key: "fill", label: T("Median future"), color: C.s1, width: 2 }].concat(b && b.ok ? [{ key: "bFill", label: T("Baseline median"), color: C.b, dash: "5 4" }] : []) }));
    CH.line($("fut-prod"), Object.assign({}, common, { height: 200, yMin: null, yFmt: function (v) { return num(v); },
      series: [{ band: ["prodLo", "prodHi"], label: T("Middle 80% of futures"), color: C.s2 }, { key: "prod", label: T("Median future"), color: C.s2, width: 2 }].concat(b && b.ok ? [{ key: "bProd", label: T("Baseline median"), color: C.b, dash: "5 4" }] : []) }));
    var F = { profit: function (v) { return money(v); }, fillRate: function (v) { return pct(v); }, criticalFill: function (v) { return pct(v); }, shortWeeks: function (v) { return num(v, 1); }, bullwhip: function (v) { return v == null ? "—" : v.toFixed(2) + "×"; }, wasteUnits: function (v) { return num(v); }, avgInventory: function (v) { return num(v); } };
    $("fut-table").innerHTML = "<thead><tr><th></th><th>" + T("10th percentile") + "</th><th>" + T("Median") + "</th><th>" + T("90th percentile") + "</th>" + (b && b.ok ? "<th>" + T("Baseline median") + "</th>" : "") + "</tr></thead><tbody>" +
      Object.keys(A.KPIS).filter(function (k) { return s[k]; }).map(function (k) {
        return "<tr><th>" + T(A.KPIS[k].label) + "</th><td>" + F[k](s[k].p10) + "</td><td>" + F[k](s[k].p50) + "</td><td>" + F[k](s[k].p90) + "</td>" + (b && b.ok ? "<td>" + (b.summary[k] ? F[k](b.summary[k].p50) : "—") + "</td>" : "") + "</tr>";
      }).join("") + "</tbody>";
  }
  $("fut-n").addEventListener("change", function () { refresh(true); });

  // ---- sensitivity
  var SENS_KPIS = ["profit", "fillRate", "shortWeeks", "bullwhip", "wasteUnits"];
  $("sens-kpi").innerHTML = SENS_KPIS.map(function (k) { return "<option value='" + k + "'>" + T(A.KPIS[k].label) + "</option>"; }).join("");
  $("sens-input").innerHTML = A.TORNADO.map(function (k) { return "<option value='" + k + "'>" + T(S.BY_KEY[k].label) + "</option>"; }).join("");
  $("sens-input").value = "coverage";
  $("sens-kpi").addEventListener("change", function () { refresh(true); });
  $("sens-input").addEventListener("change", function () { refresh(true); });
  function fmtFor(k) { return k === "profit" ? function (v) { return money(v); } : k === "fillRate" ? function (v) { return pct(v); } : k === "bullwhip" ? function (v) { return v.toFixed(2) + "×"; } : function (v) { return num(v, k === "shortWeeks" ? 0 : 0); }; }
  function showInput(k, v) { var c = S.BY_KEY[k], d = c.step < 0.1 ? 2 : c.step < 1 ? 1 : 0; return num(v, d) + (c.unit === "%" ? "%" : c.unit ? " " + T(c.unit) : ""); }
  function sensitivity() {
    var key = $("sens-kpi").value, p = M.merge(APP.params()), t = A.tornado(p, key, 0.2, S), fmt = fmtFor(key);
    if (!t.ok) return;
    var bars = t.bars.slice(0, 10).filter(function (b) { return b.swing > 1e-9; });
    if (!bars.length) { $("sens-tornado").innerHTML = "<p class='panel-note'>" + T("Nothing moves this result by a 20% change in any input.") + "</p>"; }
    else CH.tornado($("sens-tornado"), { base: t.base, fmt: fmt, colors: { down: css("--s2"), up: css("--s1") }, downLabel: T("input −20%"), upLabel: T("input +20%"), baseLabel: T("now {v}", { v: fmt(t.base) }), ariaLabel: T("Chart"),
      bars: bars.map(function (b) { var c = S.BY_KEY[b.key]; return { label: T(c.label), atLo: b.atLo, atHi: b.atHi, loText: T("at {v}", { v: showInput(b.key, b.lo) }), hiText: T("at {v}", { v: showInput(b.key, b.hi) }) }; }) });
    var input = $("sens-input").value, c = S.BY_KEY[input], cur = p[input], sw = A.sweep(p, input, key, c.min, c.max, 21);
    var rows = sw.map(function (r) { return { t: +r.x.toFixed(6), y: r.y }; });
    CH.line($("sens-sweep"), { rows: rows, height: 200, yMin: null, xLabel: T(c.label) + (c.unit ? " (" + (c.unit === "%" ? "%" : T(c.unit)) + ")" : ""), yFmt: fmt, tipTitle: function (r) { return showInput(input, r.t); }, ariaLabel: T("Chart"),
      series: [{ key: "y", label: T(A.KPIS[key].label), color: css("--s1"), width: 2 }], bands: [{ from: cur - (c.max - c.min) * 0.004, to: cur + (c.max - c.min) * 0.004, cls: "now", label: T("now {v}", { v: showInput(input, cur) }) }] });
  }

  // ---- the optimiser
  var GRIDN = A.candidates(M.merge({})).length;
  $("opt-count").textContent = GRIDN;
  function optimiserState() {
    if (optResult && optStamp !== stamp(APP.params())) $("opt-status").innerHTML = T("The scenario has changed since this search; run it again to update the results.");
  }
  $("opt-run").addEventListener("click", function () {
    if (optRun) return;
    var p = M.merge(APP.params()), futuresN = +$("opt-futures").value, minFill = +$("opt-target").value, t0 = Date.now();
    var o = A.optimiser(p, { futures: futuresN, minFill: minFill }), btn = $("opt-run");
    optRun = o; btn.disabled = true; $("opt-status").textContent = T("Searching {n} policies in {f} futures each…", { n: o.total, f: futuresN }); $("opt-table").innerHTML = ""; $("opt-plot").innerHTML = "";
    (function slice() {
      var i = o.step(6); $("opt-bar").style.width = (100 * i / o.total) + "%";
      if (!o.done()) { setTimeout(slice, 0); return; }
      optRun = null; btn.disabled = false; optResult = o.result(); optStamp = stamp(APP.params());
      showOptimiser(p, optResult, Date.now() - t0);
    })();
  });
  function policyCells(pol) {
    return ["<td>" + num(pol.coverage, 0) + " " + T("wk") + "</td>", "<td>" + num(pol.invAdjTime, 0) + " " + T("wk") + "</td>", "<td>" + num(pol.supplyLineWeight, 1) + "</td>", "<td>" + num(pol.forecastTime, 0) + " " + T("wk") + "</td>",
      "<td>" + (pol.overtime ? T("on") : T("off")) + "</td>", "<td>" + (pol.expediteQA ? T("on") : T("off")) + "</td>"].join("");
  }
  function showOptimiser(p, r, ms) {
    var keys = Object.keys(A.GRID), current = {}; keys.forEach(function (k) { current[k] = p[k]; });
    var cur = A.evaluate(p, current, r.seeds), best = r.best[0];
    if (!best) {
      $("opt-status").innerHTML = T("{n} policies tried in {f} futures each ({ms} ms): none reaches a fill rate of {t} on average. Lower the target, or change the plant (capacity, QA, campaigns) first.", { n: r.evaluated, f: r.seeds.length, ms: ms, t: pct(r.minFill, 1) });
    } else {
      $("opt-status").innerHTML = T("{n} policies tried in {f} futures each ({ms} ms); {k} reach the target. The best makes <b>{p}</b> on average with a fill rate of <b>{fill}</b>, {d} against the current policy.", {
        n: r.evaluated, f: r.seeds.length, ms: ms, k: r.feasible, p: money(best.mean.profit), fill: pct(best.mean.fillRate), d: money(best.mean.profit - cur.profit, true) });
    }
    var head = "<thead><tr><th></th><th>" + T("Target stock cover") + "</th><th>" + T("Time to correct stock") + "</th><th>" + T("Weight on the supply line") + "</th><th>" + T("Forecast smoothing") + "</th><th>" + T("Overtime") + "</th><th>" + T("Expedite QA") + "</th><th>" + T("Profit") + "</th><th>" + T("Fill rate") + "</th><th>" + T("Weeks short") + "</th><th>" + T("Waste") + "</th><th></th></tr></thead>";
    var line = function (label, pol, mean, apply) {
      return "<tr" + (apply === "cur" ? " class='cur'" : "") + "><th>" + label + "</th>" + policyCells(pol) + "<td>" + money(mean.profit) + "</td><td>" + pct(mean.fillRate) + "</td><td>" + num(mean.shortWeeks, 1) + "</td><td>" + num(mean.wasteUnits) + "</td><td>" + (apply === "cur" ? "" : "<button class='btn small' type='button' data-apply='" + apply + "'>" + T("Apply") + "</button>") + "</td></tr>";
    };
    $("opt-table").innerHTML = head + "<tbody>" + line(T("Current policy"), current, cur, "cur") + r.best.map(function (b, i) { return line("#" + (i + 1), b.policy, b.mean, i); }).join("") + "</tbody>";
    $("opt-table").querySelectorAll("[data-apply]").forEach(function (b) { b.addEventListener("click", function () { APP.set(r.best[+b.getAttribute("data-apply")].policy); }); });
    var title = function (pol, mean) { return "<b>" + money(mean.profit) + " · " + pct(mean.fillRate) + "</b><span>" + T("Target stock cover") + "<em>" + num(pol.coverage, 0) + " " + T("wk") + "</em></span><span>" + T("Weight on the supply line") + "<em>" + num(pol.supplyLineWeight, 1) + "</em></span><span>" + T("Overtime") + "<em>" + (pol.overtime ? T("on") : T("off")) + "</em></span>"; };
    var pts = r.all.map(function (x) { return { x: x.mean.fillRate * 100, y: x.mean.profit, front: r.front.indexOf(x) >= 0, best: x === best, title: title(x.policy, x.mean), policy: x.policy }; });
    pts.push({ x: cur.fillRate * 100, y: cur.profit, current: true, title: "<b>" + T("Current policy") + "</b><span>" + money(cur.profit) + "<em>" + pct(cur.fillRate) + "</em></span>" });
    CH.scatter($("opt-plot"), { points: pts, height: 300, xFmt: function (v) { return v.toFixed(1) + "%"; }, yFmt: function (v) { return money(v); }, xLabel: T("fill rate (average over the futures) →"), yLabel: T("↑ profit"), ariaLabel: T("Chart"),
      onPick: function (pt) { if (pt.policy) APP.set(pt.policy); },
      legend: "<span class='legend-item'><i class='pt-key'></i>" + T("a policy") + "</span><span class='legend-item'><i class='pt-key front'></i>" + T("the trade-off frontier: nothing else has both more profit and a higher fill rate") + "</span><span class='legend-item'><i class='pt-key best'></i>" + T("best that meets the target") + "</span><span class='legend-item'><i class='pt-key current'></i>" + T("current policy") + "</span>" });
  }

  refresh(true);
  window.SPLab = { refresh: function () { refresh(true); }, tab: function () { return tab; } };
})();
