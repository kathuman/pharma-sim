// PharmaSim — reading a demand history (window.PSData / module.exports). A CSV of weekly (or daily) demand, with or
// without dates, headers in English or Spanish, commas or semicolons, decimal points or commas. Daily rows are added
// up into weeks. The result drives the model: demand = the level of the first weeks × the history as a multiple of
// that level. Messages are English and translated by pattern in the app. Pure: no DOM.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PSData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var DEMAND = ["demand", "demanda", "units", "unidades", "qty", "quantity", "cantidad", "packs", "envases", "sales", "ventas", "orders", "pedidos", "consumption", "consumo", "value", "valor"];
  var DATE = ["date", "fecha", "week", "semana", "period", "periodo", "día", "dia", "day", "mes", "month"];
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/^"|"$/g, ""); }

  // split a CSV into rows, guessing the delimiter (comma, semicolon or tab) from the first line
  function rows(text) {
    var t = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n"), first = t.split("\n")[0] || "";
    var d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
    var out = [], row = [], cell = "", q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true; else if (c === d) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); out.push(row); }
    return { rows: out.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ""; }); }), delimiter: d };
  }
  // a number written as 1,234.5 or 1.234,5 or 1234,5
  function number(s) {
    var x = String(s == null ? "" : s).trim().replace(/\s/g, "");
    if (!x) return null;
    if (/^-?[\d.]+,\d+$/.test(x)) x = x.replace(/\./g, "").replace(",", ".");
    else x = x.replace(/,/g, "");
    var v = Number(x);
    return isFinite(v) ? v : null;
  }
  // a date as 2026-03-02, 02/03/2026 (day first) or 2026/03/02; returns days since 1970 or null
  function day(s) {
    var x = String(s || "").trim(), m;
    if ((m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(x))) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(x))) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5;
    return null;
  }

  // read a demand history: { ok, weeks: [...], level, notes: [...], errors: [...] }
  function read(text) {
    var r = rows(text).rows, notes = [], errors = [];
    if (r.length < 2) return { ok: false, errors: ["The file has no data rows."] };
    var head = r[0].map(norm), hasHead = head.some(function (h) { return h && number(h) == null; });
    var body = hasHead ? r.slice(1) : r;
    var find = function (names) { for (var i = 0; i < head.length; i++) for (var j = 0; j < names.length; j++) if (head[i] === names[j] || head[i].indexOf(names[j]) === 0) return i; return -1; };
    var dc = hasHead ? find(DEMAND) : -1, tc = hasHead ? find(DATE) : -1;
    if (dc < 0) {
      // the last column that is numeric in most rows
      for (var c = (body[0] || []).length - 1; c >= 0; c--) { var nums = body.filter(function (x) { return number(x[c]) != null; }).length; if (nums >= body.length * 0.8 && c !== tc) { dc = c; break; } }
      if (dc >= 0 && hasHead) notes.push("No column called demand, units or quantity: used \"" + r[0][dc] + "\".");
    }
    if (dc < 0) return { ok: false, errors: ["No numeric demand column found."] };
    if (tc < 0 && hasHead) { for (var k = 0; k < head.length; k++) if (k !== dc && body.length && day(body[0][k]) != null) { tc = k; break; } }
    var pts = [], skipped = 0;
    body.forEach(function (x) { var v = number(x[dc]); if (v == null || v < 0) { skipped++; return; } pts.push({ v: v, d: tc >= 0 ? day(x[tc]) : null }); });
    if (skipped) notes.push(skipped + " row" + (skipped === 1 ? "" : "s") + " without a usable number skipped.");
    var weeks;
    var dated = pts.filter(function (p) { return p.d != null; });
    if (dated.length >= pts.length * 0.9 && dated.length >= 2) {
      dated.sort(function (a, b) { return a.d - b.d; });
      var gap = (dated[dated.length - 1].d - dated[0].d) / (dated.length - 1);
      if (gap < 6) {
        // daily (or several per week): add up into weeks counted from the first date
        var w0 = dated[0].d, sums = {};
        dated.forEach(function (p) { var w = Math.floor((p.d - w0) / 7); sums[w] = (sums[w] || 0) + p.v; });
        var last = Math.max.apply(null, Object.keys(sums).map(Number)), full = (dated[dated.length - 1].d - w0) % 7 >= 6;
        weeks = []; for (var i = 0; i <= last; i++) weeks.push(sums[i] || 0);
        if (!full && weeks.length > 1) { weeks.pop(); notes.push("The last, incomplete week was left out."); }
        notes.push("Daily data added up into " + weeks.length + " weeks.");
      } else weeks = dated.map(function (p) { return p.v; });
    } else weeks = pts.map(function (p) { return p.v; });
    if (weeks.length < 8) return { ok: false, errors: ["At least 8 weeks of demand are needed (found " + weeks.length + ")."] };
    if (weeks.length > 520) { weeks = weeks.slice(0, 520); notes.push("Only the first 520 weeks are used."); }
    var level = weeks.slice(0, 4).reduce(function (a, b) { return a + b; }, 0) / 4;
    if (!(level > 0)) return { ok: false, errors: ["The first four weeks have no demand, so there is no starting level to work from."] };
    // a summary of the history: its trend and its week-to-week variation
    var n = weeks.length, mean = weeks.reduce(function (a, b) { return a + b; }, 0) / n, xs = 0, xy = 0;
    for (var t = 0; t < n; t++) { xs += (t - (n - 1) / 2) * (t - (n - 1) / 2); xy += (t - (n - 1) / 2) * (weeks[t] - mean); }
    var slope = xy / xs, trend = mean > 0 ? slope * 52 / mean : 0;
    var diffs = []; for (var u = 1; u < n; u++) if (weeks[u - 1] > 0 && weeks[u] > 0) diffs.push(Math.log(weeks[u] / weeks[u - 1]));
    var dm = diffs.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, diffs.length), dv = diffs.reduce(function (a, b) { return a + (b - dm) * (b - dm); }, 0) / Math.max(1, diffs.length);
    return { ok: true, weeks: weeks, level: level, mean: mean, trend: trend, variation: Math.sqrt(dv / 2), notes: notes, errors: errors };
  }
  // the model inputs that replay a history: starting demand = its level, demand = the history as multiples, no extra noise
  function toParams(h) {
    return { pattern: "history", demand: Math.round(h.level), history: h.weeks.map(function (v) { return +(v / h.level).toFixed(4); }), weeks: Math.max(26, h.weeks.length), noise: 0 };
  }
  // a small example file: two years of weekly demand with a winter peak, a lasting rise and noise
  function sample() {
    var a = 7, rnd = function () { a = (a * 16807) % 2147483647; return a / 2147483647; }, lines = ["week,demand"];
    for (var w = 0; w < 104; w++) {
      var v = 10000 * (1 + 0.15 * Math.cos(2 * Math.PI * (w - 2) / 52)) * (w >= 60 ? 1.2 : 1) * (1 + 0.06 * (rnd() * 2 - 1));
      lines.push((w + 1) + "," + Math.round(v));
    }
    return lines.join("\n") + "\n";
  }
  return { rows: rows, number: number, day: day, read: read, toParams: toParams, sample: sample };
});
