// Supply Pulse — the decision report: the scenario (and baseline) from the address, its results, the range over 100
// demand futures, the charts, what moves profit most and every input changed. Light, to print or save as PDF.
(function () {
  "use strict";
  var APP_VERSION = "4.0.0";
  var M = window.SPModel, S = window.SPSpecs, A = window.SPAnalysis, CH = window.SPCharts, I18 = window.PSi18n, T = I18.T;
  var $ = function (id) { return document.getElementById(id); };
  var num = function (v, d) { return v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var money = function (v, sign) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = v < 0 ? "−" : sign && v > 0 ? "+" : ""; return s + (a >= 1e6 ? "$" + (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + (a / 1e3).toFixed(0) + "k" : "$" + a.toFixed(0)); };
  var pct = function (v, d) { return v == null ? "—" : (v * 100).toFixed(d == null ? 2 : d) + "%"; };
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  function decode(key) { var m = new RegExp("[#&]" + key + "=([^&]+)").exec(location.hash); if (!m) return null; try { return JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return null; } }
  var cur = decode("s") || { pr: "step", v: {} }, base = decode("b");
  var preset = M.PRESETS[cur.pr] ? cur.pr : "step";
  var p = M.merge(Object.assign({}, M.PRESETS[preset].values, cur.v || {})), r = M.run(p);
  var bp = base ? M.merge(Object.assign({}, (M.PRESETS[base.pr] || M.PRESETS.step).values, base.v || {})) : null, b = bp ? M.run(bp) : null;
  if (b && !b.ok) b = null;
  $("r-print").addEventListener("click", function () { window.print(); });
  $("r-back").setAttribute("href", I18.withLang("index.html") + "#s=" + (/[#&]s=([^&]+)/.exec(location.hash) || [, ""])[1]);
  if (!r.ok) { $("r-title").textContent = T("This scenario cannot be run"); $("r-headline").innerHTML = r.errors.map(I18.tw).join("<br>"); return; }
  var k = r.kpi, bk = b ? b.kpi : null;

  // ---- title and summary
  $("r-title").textContent = T(M.PRESETS[preset].label);
  $("r-meta").textContent = T("Generated on {d} with Supply Pulse v{v}, over {w} weeks", { d: new Date().toLocaleDateString(I18.lang === "es" ? "es-419" : "en-GB", { year: "numeric", month: "long", day: "numeric" }), v: APP_VERSION, w: p.weeks }) +
    (b ? " · " + T("compared with the baseline {name}", { name: T(M.PRESETS[base.pr] ? M.PRESETS[base.pr].label : "Your scenario") }) : "");
  var h = T("Over {w} weeks the plant served <b>{fill}</b> of demand", { w: p.weeks, fill: pct(k.fillRate) }) + (k.lost > 0.5 ? T(" ({lost} cases short, in {n} weeks)", { lost: num(k.lost), n: k.shortWeeks }) : "") + ". ";
  h += k.bullwhip == null ? T("Demand stayed level, so there was nothing to amplify") : T("Production swung <b>{bw}×</b> as much as demand", { bw: k.bullwhip.toFixed(2) });
  h += T("; <b>{waste}</b> cases were wasted and profit was <b>{profit}</b>.", { waste: num(k.wasteUnits), profit: money(k.profit) });
  $("r-headline").innerHTML = h;

  // ---- results against the baseline
  var ROWS = [[T("Profit"), "profit", 1, function (v) { return money(v); }, function (d) { return money(d, true); }],
    [T("Fill rate"), "fillRate", 1, function (v) { return pct(v); }, function (d) { return (d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(2) + " " + T("pts"); }],
    [T("Priority customers served"), "criticalFill", 1, function (v) { return pct(v); }, function (d) { return (d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(2) + " " + T("pts"); }],
    [T("Weeks short"), "shortWeeks", -1, function (v) { return num(v); }, function (d) { return (d >= 0 ? "+" : "−") + num(Math.abs(d)); }],
    [T("Bullwhip"), "bullwhip", -1, function (v) { return v == null ? "—" : v.toFixed(2) + "×"; }, function (d) { return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(2); }],
    [T("Waste"), "wasteUnits", -1, function (v) { return num(v); }, function (d) { return (d >= 0 ? "+" : "−") + num(Math.abs(d)); }],
    [T("Average stock"), "avgInventory", -1, function (v) { return num(v); }, function (d) { return (d >= 0 ? "+" : "−") + num(Math.abs(d)); }],
    [T("Peak workforce"), "peakWorkforce", -1, function (v) { return num(v, 1); }, function (d) { return (d >= 0 ? "+" : "−") + num(Math.abs(d), 1); }]];
  $("r-results").innerHTML = "<thead><tr><th></th><th>" + T("This scenario") + "</th>" + (b ? "<th>" + T("Baseline") + "</th><th>" + T("Difference") + "</th>" : "") + "</tr></thead><tbody>" + ROWS.map(function (row) {
    var v = k[row[1]], w = bk ? bk[row[1]] : null, d = v != null && w != null ? v - w : null, cls = d == null || Math.abs(d) < 1e-9 * Math.max(1, Math.abs(w)) ? "" : (d > 0) === (row[2] > 0) ? "better" : "worse";
    return "<tr><th>" + row[0] + "</th><td>" + row[3](v) + "</td>" + (b ? "<td>" + row[3](w) + "</td><td class='" + cls + "'>" + (d == null ? "—" : row[4](d)) + "</td>" : "") + "</tr>";
  }).join("") + "</tbody>";

  // ---- many futures
  var f = A.futures(p, 100), fb = bp ? A.futures(bp, 100) : null, s = f.summary;
  var ft = T("In {n} demand futures the fill rate runs from <b>{lo}</b> to <b>{hi}</b> (median {mid}), at least one week is short in <b>{sh}</b> of them, and profit runs from {plo} to {phi}.", {
    n: 100, lo: pct(s.fillRate.p10), hi: pct(s.fillRate.p90), mid: pct(s.fillRate.p50), sh: pct(f.shortageChance, 0), plo: money(s.profit.p10), phi: money(s.profit.p90) });
  if (fb && fb.ok) { var hp = A.headToHead(f, fb, "profit"), hf = A.headToHead(f, fb, "fillRate"); ft += " " + T("Against the baseline, in the very same futures, it makes more profit in <b>{w}</b> of {n} and serves more customers in <b>{f}</b>.", { w: hp.wins, f: hf.wins, n: hp.n }); }
  $("r-futures").innerHTML = ft;
  var F = { profit: money, fillRate: function (v) { return pct(v); }, shortWeeks: function (v) { return num(v, 1); }, wasteUnits: function (v) { return num(v); } };
  $("r-fut-table").innerHTML = "<thead><tr><th></th><th>" + T("10th percentile") + "</th><th>" + T("Median") + "</th><th>" + T("90th percentile") + "</th>" + (fb ? "<th>" + T("Baseline median") + "</th>" : "") + "</tr></thead><tbody>" +
    Object.keys(F).map(function (key) { return "<tr><th>" + T(A.KPIS[key].label) + "</th><td>" + F[key](s[key].p10) + "</td><td>" + F[key](s[key].p50) + "</td><td>" + F[key](s[key].p90) + "</td>" + (fb ? "<td>" + F[key](fb.summary[key].p50) + "</td>" : "") + "</tr>"; }).join("") + "</tbody>";

  // ---- charts (weekly)
  var per = Math.round(1 / p.dt), rows = [], wk = [];
  var same = b && b.rows.length === r.rows.length;
  for (var w = 0; w * per < r.rows.length; w++) {
    var seg = r.rows.slice(w * per, (w + 1) * per), bs = same ? b.rows.slice(w * per, (w + 1) * per) : null;
    var avg = function (rs, key) { return rs.reduce(function (x, y) { return x + y[key]; }, 0) / rs.length; };
    rows.push({ t: w, demand: avg(seg, "demand"), production: avg(seg, "production"), inventory: avg(seg, "inventory"), target: avg(seg, "target"), bProduction: bs ? avg(bs, "production") : null, bInventory: bs ? avg(bs, "inventory") : null });
    var dd = seg.reduce(function (x, y) { return x + y.demand; }, 0), ss = seg.reduce(function (x, y) { return x + y.served; }, 0);
    var bd = bs ? bs.reduce(function (x, y) { return x + y.demand; }, 0) : 0, bsv = bs ? bs.reduce(function (x, y) { return x + y.served; }, 0) : 0;
    wk.push({ t: w, fill: dd > 0 ? 100 * ss / dd : 100, bFill: bs && bd > 0 ? 100 * bsv / bd : null });
  }
  var C = { d: css("--s-demand"), s1: css("--s1"), b: css("--s-base") }, common = { xLabel: T("week"), tipTitle: function (x) { return T("Week {w}", { w: x.t }); } };
  CH.line($("r-ch1"), Object.assign({}, common, { rows: rows, height: 230, yMin: null, yFmt: function (v) { return num(v); }, series: [{ key: "demand", label: T("Market demand"), color: C.d, width: 1.5 }, { key: "production", label: T("Production"), color: C.s1, width: 2.5 }].concat(same ? [{ key: "bProduction", label: T("Baseline production"), color: C.b, dash: "5 4" }] : []) }));
  CH.line($("r-ch2"), Object.assign({}, common, { rows: rows, height: 190, yMin: 0, yFmt: function (v) { return num(v); }, series: [{ key: "inventory", label: T("Plant stock"), color: C.s1, area: true }, { key: "target", label: T("Target stock"), color: C.d, width: 1.2, dash: "4 4" }].concat(same ? [{ key: "bInventory", label: T("Baseline plant stock"), color: C.b, dash: "5 4" }] : []) }));
  var lows = wk.map(function (x) { return Math.min(x.fill, x.bFill == null ? 100 : x.bFill); });
  CH.line($("r-ch3"), Object.assign({}, common, { rows: wk, height: 190, yMax: 100, yMin: Math.min(90, Math.floor(Math.min.apply(null, lows) / 5) * 5), yFmt: function (v) { return v.toFixed(0) + "%"; }, tipFmt: function (v) { return v.toFixed(1) + "%"; }, series: [{ key: "fill", label: T("Demand served"), color: C.s1, width: 2 }].concat(same ? [{ key: "bFill", label: T("Baseline"), color: C.b, dash: "5 4" }] : []) }));

  // ---- what moves profit most
  var showInput = function (key, v) { var c = S.BY_KEY[key], d = c.step < 0.1 ? 2 : c.step < 1 ? 1 : 0; return num(v, d) + (c.unit === "%" ? "%" : c.unit ? " " + T(c.unit) : ""); };
  var t = A.tornado(p, "profit", 0.2, S);
  $("r-sens").innerHTML = "<thead><tr><th></th><th>" + T("input −20%") + "</th><th>" + T("input +20%") + "</th></tr></thead><tbody>" + t.bars.slice(0, 6).map(function (x) {
    return "<tr><th>" + T(S.BY_KEY[x.key].label) + "</th><td>" + money(x.atLo - t.base, true) + " <span class='small'>(" + showInput(x.key, x.lo) + ")</span></td><td>" + money(x.atHi - t.base, true) + " <span class='small'>(" + showInput(x.key, x.hi) + ")</span></td></tr>";
  }).join("") + "</tbody>";

  // ---- every input changed from the defaults
  var changed = [];
  S.GROUPS.forEach(function (g) { g.controls.forEach(function (c) {
    if (c.show && !c.show(p)) return;
    var v = p[c.key], d = M.DEFAULTS[c.key];
    if (v === d) return;
    var show = function (x) { if (c.type === "toggle") return x ? T("on") : T("off"); if (c.type === "select") { var o = c.options.filter(function (q) { return q[0] === x; })[0]; return o ? T(o[1]) : String(x); } if (c.zero && x === 0) return T(c.zero); return showInput(c.key, x); };
    changed.push("<tr><th>" + T(g.title) + " · " + T(c.label) + "</th><td>" + show(v) + "</td><td>" + show(d) + "</td></tr>");
  }); });
  $("r-inputs-note").textContent = changed.length ? T("Every input that differs from the model's defaults; everything else is as described in the simulator.") : T("Every input is at the model's defaults.");
  $("r-inputs").innerHTML = changed.length ? "<thead><tr><th></th><th>" + T("This scenario") + "</th><th>" + T("Default") + "</th></tr></thead><tbody>" + changed.join("") + "</tbody>" : "";
  $("r-foot").innerHTML = T("Supply Pulse v{v} · kathuman.github.io/supply-pulse · a system-dynamics model by Daniel Alberto Sepulveda Estay, PhD (Estay Dynamics). The figures are illustrative; every equation is shown in the simulator.", { v: APP_VERSION });
  window.SPReport = { result: r, baseline: b, version: APP_VERSION };
})();
