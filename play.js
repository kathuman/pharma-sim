// PharmaSim — the play page: you set the production plan turn by turn (src/game.js), then see your two years against
// the planning rule on the same demand. Best results are remembered in this browser for convenience only.
(function () {
  "use strict";
  var APP_VERSION = "3.2.0";
  var M = window.PSModel, G = window.PSGame, CH = window.PSCharts, I18 = window.PSi18n, T = I18.T;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "ps-play-best-v1", game = null, chosen = null, surprise = false, seed = 1;
  var num = function (v, d) { return v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var money = function (v, sign) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = v < 0 ? "−" : sign && v > 0 ? "+" : ""; return s + (a >= 1e6 ? "$" + (a / 1e6).toFixed(2) + "M" : "$" + (a / 1e3).toFixed(0) + "k"); };
  var pct = function (v) { return v == null ? "—" : (v * 100).toFixed(2) + "%"; };
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  $("ver").textContent = "v" + APP_VERSION; $("ver-foot").textContent = "v" + APP_VERSION;

  // ---- setup
  $("g-scn").innerHTML = "<option value='surprise'>" + T("Surprise me (the scenario stays hidden)") + "</option>" + G.SCENARIOS.map(function (s) { return "<option value='" + s + "'>" + T(M.PRESETS[s].label) + "</option>"; }).join("");
  function bests() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function showBest() {
    var b = bests(), keys = Object.keys(b);
    $("g-best").innerHTML = keys.length ? T("Your best so far:") + " " + keys.map(function (k) { return T(M.PRESETS[k].label) + " " + money(b[k].margin, true); }).join(" · ") : "";
  }
  showBest();
  $("g-start").addEventListener("click", function () { begin($("g-scn").value, 1 + Math.floor(Math.random() * 99999)); });
  function begin(which, s) {
    surprise = which === "surprise"; chosen = surprise ? G.SCENARIOS[Math.floor(Math.random() * G.SCENARIOS.length)] : which; seed = s;
    game = G.create(chosen, { turnWeeks: +$("g-turn").value, seed: seed });
    $("setup").hidden = true; $("end").hidden = true; $("game").hidden = false;
    var v = game.view(); $("g-plan").max = v.maxPlan; $("g-plan-num").max = v.maxPlan; setPlan(v.rule);
    turn(); window.scrollTo(0, 0);
  }

  // ---- a turn
  function setPlan(x) { x = Math.max(0, Math.round(x / 100) * 100); $("g-plan").value = x; $("g-plan-num").value = x; }
  $("g-plan").addEventListener("input", function () { $("g-plan-num").value = $("g-plan").value; });
  $("g-plan-num").addEventListener("input", function () { $("g-plan").value = $("g-plan-num").value; });
  document.querySelectorAll("[data-quick]").forEach(function (b) {
    b.addEventListener("click", function () { var v = game.view(), q = b.getAttribute("data-quick"); setPlan(q === "orders" ? v.orders : q === "avg" ? v.orders4 : v.rule); });
  });
  $("g-hint").addEventListener("change", function () { if (game) turn(); });
  function fact(label, value, sub) { return "<div class='fact'><span>" + label + "</span><b>" + value + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>"; }
  function turn() {
    var v = game.view(), p = game.params, hint = $("g-hint").checked;
    $("g-week").innerHTML = T("Week <b>{w}</b> of {n}", { w: num(v.week), n: v.weeks }) + (surprise ? "" : " · " + T(M.PRESETS[chosen].label));
    $("g-facts").innerHTML = [
      fact(T("Orders this week"), num(v.orders), T("{x} a week over the last 4 weeks", { x: num(v.orders4) })),
      fact(T("Your stock"), num(v.stock), T("{x} weeks of this week's orders", { x: num(v.coverWeeks, 1) })),
      v.qa != null ? fact(T("In QA quarantine"), num(v.qa), T("released after about {w} weeks", { w: num(p.qaTime, 1) })) : "",
      fact(T("Workforce"), num(v.workforce, 1), T("can make {x} a week", { x: num(v.capacity) })),
      fact(T("Production last week"), num(v.production), T("patients served: {x}", { x: num(v.served) })),
      v.apiStock != null ? fact(T("API stock"), num(v.apiStock), T("enough for {x} weeks at that rate", { x: num(v.apiStock / Math.max(1, v.production), 1) })) : ""
    ].join("");
    $("g-hintline").innerHTML = hint ? T("The planning rule would plan <b>{x}</b> a week now.", { x: num(v.rule) }) : "";
    $("g-quick-rule").hidden = !hint;
    var left = Math.min(game.turnWeeks, v.weeks - v.week);
    $("g-next").textContent = T("Plan this for the next {n} weeks →", { n: num(left, left % 1 ? 2 : 0) });
    charts();
  }
  $("g-next").addEventListener("click", function () {
    game.play(+$("g-plan-num").value);
    if (game.done()) finish(); else turn();
  });
  $("g-quit").addEventListener("click", function () {
    // the rest of the horizon is played with the plan as it stands
    var x = +$("g-plan-num").value; while (!game.done()) game.play(x);
    finish();
  });
  function charts() {
    var rows = game.result().rows, p = game.params, per = Math.round(1 / p.dt), n = Math.round(p.weeks);
    var C = { d: css("--s-demand"), s1: css("--s1"), s2: css("--s2"), s4: css("--s4") };
    var full = [], wk = [];
    for (var w = 0; w < n; w++) {
      var seg = rows.slice(w * per, (w + 1) * per), has = seg.length === per;
      var avg = function (k) { return has ? seg.reduce(function (s, r) { return s + r[k]; }, 0) / per : null; };
      full.push({ t: w, orders: avg("ordersToMfg"), production: avg("production"), stock: avg("inventory"), target: avg("target") });
      var d = has ? seg.reduce(function (s, r) { return s + r.demand; }, 0) : 0, s = has ? seg.reduce(function (s2, r) { return s2 + r.served; }, 0) : 0;
      wk.push({ t: w, fill: has && d > 0 ? 100 * s / d : null });
    }
    var common = { xLabel: T("week"), tipTitle: function (r) { return T("Week {w}", { w: r.t }); }, ariaLabel: T("Chart"), yMin: 0, height: 170 };
    var v0 = game.view();
    CH.line($("g-ch1"), Object.assign({}, common, { rows: full, emptyMax: v0.startOutput * 1.5, yFmt: function (v) { return num(v); },
      series: [{ key: "orders", label: T("Orders received"), color: C.d, width: 1.5 }, { key: "production", label: T("Production"), color: C.s1, width: 2.5 }] }));
    CH.line($("g-ch2"), Object.assign({}, common, { rows: full, emptyMax: v0.stock * 1.5, yFmt: function (v) { return num(v); },
      series: [{ key: "stock", label: T("Your stock"), color: C.s1, area: true }] }));
    var lows = wk.filter(function (r) { return r.fill != null; }).map(function (r) { return r.fill; });
    CH.line($("g-ch3"), Object.assign({}, common, { rows: wk, yMax: 100, yMin: lows.length ? Math.min(90, Math.floor(Math.min.apply(null, lows) / 5) * 5) : 90, yFmt: function (v) { return v.toFixed(0) + "%"; }, tipFmt: function (v) { return v.toFixed(1) + "%"; },
      series: [{ key: "fill", label: T("Demand served"), color: C.s1, width: 2 }] }));
  }

  // ---- the end
  var VERDICT = {
    both: T("You beat the planning rule on both profit and service."),
    profit: T("More profit than the rule, but fewer patients served."),
    service: T("More patients served than the rule, at a lower profit."),
    neither: T("The rule did better on both. Try again: watch the stock and what is already in QA, not only this week's orders.")
  };
  function finish() {
    var c = game.compare(), y = c.you, r = c.rule, v = G.verdict(c);
    $("game").hidden = true; $("end").hidden = false;
    $("g-verdict").innerHTML = "<b>" + VERDICT[v] + "</b> " + (surprise ? T("The scenario was: {s}.", { s: T(M.PRESETS[chosen].label) }) : "") + " " + T("Profit {d} against the rule.", { d: money(y.profit - r.profit, true) });
    var rows = [[T("Profit"), money(y.profit), money(r.profit), y.profit >= r.profit], [T("Fill rate"), pct(y.fillRate), pct(r.fillRate), y.fillRate >= r.fillRate],
      [T("Weeks short"), num(y.shortWeeks), num(r.shortWeeks), y.shortWeeks <= r.shortWeeks], [T("Bullwhip"), y.bullwhip == null ? "—" : y.bullwhip.toFixed(2) + "×", r.bullwhip == null ? "—" : r.bullwhip.toFixed(2) + "×", (y.bullwhip || 0) <= (r.bullwhip || 0)],
      [T("Waste"), num(y.wasteUnits), num(r.wasteUnits), y.wasteUnits <= r.wasteUnits], [T("Peak workforce"), num(y.peakWorkforce, 1), num(r.peakWorkforce, 1), y.peakWorkforce <= r.peakWorkforce]];
    $("g-table").innerHTML = "<thead><tr><th></th><th>" + T("You") + "</th><th>" + T("The planning rule") + "</th></tr></thead><tbody>" + rows.map(function (x) { return "<tr><th>" + x[0] + "</th><td" + (x[3] ? " class='best'" : "") + ">" + x[1] + "</td><td" + (!x[3] ? " class='best'" : "") + ">" + x[2] + "</td></tr>"; }).join("") + "</tbody>";
    var p = game.params, per = Math.round(1 / p.dt), out = [];
    for (var w = 0; w < Math.round(p.weeks); w++) {
      var a = c.youRows.slice(w * per, (w + 1) * per), b = c.ruleRows.slice(w * per, (w + 1) * per), m = function (rs, k) { return rs.reduce(function (s, x) { return s + x[k]; }, 0) / rs.length; };
      out.push({ t: w, demand: m(a, "demand"), you: m(a, "production"), rule: m(b, "production") });
    }
    CH.line($("g-ch4"), { rows: out, height: 230, yMin: null, xLabel: T("week"), tipTitle: function (x) { return T("Week {w}", { w: x.t }); }, ariaLabel: T("Chart"), yFmt: function (x) { return num(x); },
      series: [{ key: "demand", label: T("Market demand"), color: css("--s-demand"), width: 1.5 }, { key: "you", label: T("Your production"), color: css("--s1"), width: 2.5 }, { key: "rule", label: T("The rule's production"), color: css("--s2"), width: 2, dash: "5 4" }] });
    // remember the best margin over the rule for this scenario
    var b2 = bests(), margin = y.profit - r.profit;
    if (!b2[chosen] || margin > b2[chosen].margin) { b2[chosen] = { margin: margin, fill: y.fillRate }; try { localStorage.setItem(KEY, JSON.stringify(b2)); } catch (e) { /* not remembered */ } }
    var enc = btoa(unescape(encodeURIComponent(JSON.stringify({ pr: chosen, v: { seed: seed } }))));
    $("g-open").setAttribute("href", I18.withLang("index.html") + "#s=" + enc);
    showBest(); window.scrollTo(0, 0);
  }
  $("g-again").addEventListener("click", function () { begin(surprise ? "surprise" : chosen, 1 + Math.floor(Math.random() * 99999)); });
  $("g-other").addEventListener("click", function () { $("end").hidden = true; $("setup").hidden = false; });
  window.PSPlay = { game: function () { return game; }, begin: begin, version: APP_VERSION };
})();
