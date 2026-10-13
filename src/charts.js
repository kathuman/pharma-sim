// Supply Pulse — small SVG line charts with one y-axis, a legend, shaded periods and a hover read-out (window.SPCharts).
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function T(t, v) { var I = window.PSi18n; return I ? I.T(t, v) : String(t).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; }); }
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function nice(lo, hi, n) {
    if (hi - lo < 1e-9) { hi = lo + 1; }
    var raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, ticks = [];
    for (var v = a; v <= b + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { lo: a, hi: b, ticks: ticks };
  }

  // opts: rows, series [{key, label, color, dash, width, area}], bands [{from, to, cls, label}], yFmt, tipFmt, xLabel,
  //       yMin (default 0), yMax, height, onHover(t | null), ariaLabel
  // the chart's own title (the nearest .chart-title before it), for its label and its table's caption
  function titleOf(host) { for (var n = host.previousElementSibling; n; n = n.previousElementSibling) if (n.classList && n.classList.contains("chart-title")) return n.textContent.trim(); return null; }
  function line(host, opts) {
    var state = { opts: opts, hoverI: null };
    host.classList.add("chart");
    host.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "chart-plot"; host.appendChild(wrap);
    var tip = document.createElement("div"); tip.className = "chart-tip"; tip.hidden = true; wrap.appendChild(tip);
    var legend = document.createElement("div"); legend.className = "chart-legend"; host.appendChild(legend);
    // the same numbers as a table, one row a week, for screen readers and for reading exact values
    var tbtn = document.createElement("button"); tbtn.type = "button"; tbtn.className = "chart-table-btn"; tbtn.setAttribute("aria-expanded", "false"); tbtn.textContent = T("Show as a table"); host.appendChild(tbtn);
    var tbox = document.createElement("div"); tbox.className = "chart-table"; tbox.hidden = true; host.appendChild(tbox);
    tbtn.addEventListener("click", function () { tbox.hidden = !tbox.hidden; tbtn.setAttribute("aria-expanded", tbox.hidden ? "false" : "true"); tbtn.textContent = tbox.hidden ? T("Show as a table") : T("Hide the table"); if (!tbox.hidden) table(); });
    function table() {
      var o = state.opts, fmt = o.tipFmt || o.yFmt || String, cols = [];
      o.series.forEach(function (s) { if (s.band) { cols.push({ key: s.band[0], label: s.label + " (" + T("low") + ")" }); cols.push({ key: s.band[1], label: s.label + " (" + T("high") + ")" }); } else cols.push({ key: s.key, label: s.label }); });
      // one row for each whole week (the data may have several steps a week)
      var seen = {}, rows = o.rows.filter(function (r) { var w = Math.round(r.t); if (Math.abs(r.t - w) > 1e-9 || seen[w]) return false; seen[w] = true; return true; });
      tbox.innerHTML = "<table class='dtable'><caption>" + (o.ariaLabel || "") + "</caption><thead><tr><th scope='col'>" + (o.xLabel || "") + "</th>" + cols.map(function (c) { return "<th scope='col'>" + c.label + "</th>"; }).join("") + "</tr></thead><tbody>" +
        rows.map(function (r) { return "<tr><th scope='row'>" + (o.tipTitle ? o.tipTitle(r) : r.t) + "</th>" + cols.map(function (c) { var v = r[c.key]; return "<td>" + (v == null || !isFinite(v) ? "—" : fmt(v)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>";
    }
    function draw() {
      if (titleOf(host)) state.opts.ariaLabel = titleOf(host);
      var o = state.opts, rows = o.rows, W = Math.max(260, wrap.clientWidth || 600), H = o.height || 220;
      var m = { l: 56, r: 12, t: 10, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
      var old = wrap.querySelector("svg"); if (old) old.remove();
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": o.ariaLabel || "" });
      wrap.insertBefore(svg, tip);
      var xs = rows.map(function (r) { return r.t; }), x0 = xs[0], x1 = xs[xs.length - 1];
      var vals = []; o.series.forEach(function (s) { rows.forEach(function (r) { (s.band || [s.key]).forEach(function (key) { var v = r[key]; if (v != null && isFinite(v)) vals.push(v); }); }); });
      if (!vals.length) vals = [0, o.emptyMax || 1];   // nothing to show yet (the play mode at week 0)
      var lo = o.yMin != null ? Math.min(o.yMin, Math.min.apply(null, vals)) : Math.min.apply(null, vals), hi = o.yMax != null ? o.yMax : Math.max.apply(null, vals);
      if (o.yMin != null && o.yMin === 0 && lo > 0) lo = 0;
      var yt = nice(lo, o.yMax != null ? hi : hi + (hi - lo) * 0.04, 4);
      if (o.yMax != null) { yt.hi = o.yMax; yt.ticks = yt.ticks.filter(function (v) { return v <= o.yMax + 1e-9; }); }
      var X = function (t) { return m.l + (t - x0) / Math.max(1e-9, x1 - x0) * iw; }, Y = function (v) { return m.t + ih - (v - yt.lo) / (yt.hi - yt.lo) * ih; };
      // shaded periods
      (o.bands || []).forEach(function (b) { el("rect", { x: X(b.from), y: m.t, width: Math.max(1, X(b.to) - X(b.from)), height: ih, "class": "band " + (b.cls || "") }, svg); });
      // grid and axes
      yt.ticks.forEach(function (v) {
        el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v), "class": "grid" }, svg);
        var tx = el("text", { x: m.l - 6, y: Y(v) + 3.5, "class": "tick", "text-anchor": "end" }, svg); tx.textContent = (o.yFmt || String)(v);
      });
      var xt = nice(x0, x1, Math.max(3, Math.min(8, Math.floor(iw / 80))));
      xt.ticks.forEach(function (t) { if (t < x0 - 1e-9 || t > x1 + 1e-9) return; var tx = el("text", { x: X(t), y: m.t + ih + 16, "class": "tick", "text-anchor": "middle" }, svg); tx.textContent = t; });
      if (o.xLabel) { var xl = el("text", { x: m.l + iw, y: H - 2, "class": "tick axis-label", "text-anchor": "end" }, svg); xl.textContent = o.xLabel; }
      el("line", { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, "class": "axis" }, svg);
      // series
      o.series.forEach(function (s) {
        if (s.band) {
          var up = "", dn = "", pts = rows.filter(function (r) { return isFinite(r[s.band[0]]) && isFinite(r[s.band[1]]); });
          pts.forEach(function (r, i) { up += (i ? "L" : "M") + X(r.t).toFixed(1) + "," + Y(r[s.band[1]]).toFixed(1); });
          for (var b = pts.length - 1; b >= 0; b--) dn += "L" + X(pts[b].t).toFixed(1) + "," + Y(pts[b][s.band[0]]).toFixed(1);
          if (pts.length) el("path", { d: up + dn + "Z", fill: s.color, "fill-opacity": 0.2, stroke: "none" }, svg);
          return;
        }
        var d = "", pen = false;
        rows.forEach(function (r) { var v = r[s.key]; if (v == null || !isFinite(v)) { pen = false; return; } d += (pen ? "L" : "M") + X(r.t).toFixed(1) + "," + Y(v).toFixed(1); pen = true; });
        if (!d) return;
        if (s.area) el("path", { d: d + "L" + X(x1).toFixed(1) + "," + Y(Math.max(yt.lo, 0)).toFixed(1) + "L" + X(x0).toFixed(1) + "," + Y(Math.max(yt.lo, 0)).toFixed(1) + "Z", fill: s.color, "fill-opacity": 0.12, stroke: "none" }, svg);
        el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-dasharray": s.dash || "none", "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      });
      // hover layer
      var cross = el("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, "class": "cross", visibility: "hidden" }, svg);
      var dots = o.series.map(function (s) { return el("circle", { r: s.band ? 0 : 4, fill: s.color, stroke: "var(--panel-2)", "stroke-width": 2, visibility: "hidden" }, svg); });
      var hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", "class": "hit" }, svg);
      function at(ev) {
        var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width, t = x0 + (px - m.l) / iw * (x1 - x0);
        var i = 0, best = Infinity; for (var k = 0; k < rows.length; k++) { var dd = Math.abs(rows[k].t - t); if (dd < best) { best = dd; i = k; } }
        return i;
      }
      function show(i) {
        state.hoverI = i;
        if (i == null) { cross.setAttribute("visibility", "hidden"); dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); }); tip.hidden = true; if (o.onHover) o.onHover(null); return; }
        var r = rows[i], cx = X(r.t);
        cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
        o.series.forEach(function (s, k) { var v = s.band ? null : r[s.key]; if (v == null || !isFinite(v)) { dots[k].setAttribute("visibility", "hidden"); return; } dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", Y(v)); dots[k].setAttribute("visibility", "visible"); });
        var fmt = o.tipFmt || o.yFmt || String;
        tip.innerHTML = "<b>" + (o.tipTitle ? o.tipTitle(r) : r.t) + "</b>" + o.series.map(function (s) {
          if (s.band) { var a = r[s.band[0]], z = r[s.band[1]]; return a == null || !isFinite(a) ? "" : "<span><i style='background:" + s.color + ";opacity:.5'></i>" + s.label + "<em>" + fmt(a) + " – " + fmt(z) + "</em></span>"; }
          var v = r[s.key]; return v == null || !isFinite(v) ? "" : "<span><i style='background:" + s.color + "'></i>" + s.label + "<em>" + fmt(v) + "</em></span>"; }).join("");
        tip.hidden = false;
        var left = cx / W * wrap.clientWidth;
        tip.style.left = Math.min(wrap.clientWidth - tip.offsetWidth - 4, Math.max(4, left + 12)) + "px";
        if (left + 12 + tip.offsetWidth > wrap.clientWidth) tip.style.left = Math.max(4, left - tip.offsetWidth - 12) + "px";
        if (o.onHover) o.onHover(r.t);
      }
      hit.addEventListener("pointermove", function (ev) { show(at(ev)); });
      hit.addEventListener("pointerdown", function (ev) { show(at(ev)); });
      hit.addEventListener("pointerleave", function () { show(null); });
      state.show = show;
    }
    function legendHTML() {
      var o = state.opts;
      legend.innerHTML = o.series.length < 2 ? "" : o.series.map(function (s) {
        if (s.band) return "<span class='legend-item'><i class='band-key' style='background:" + s.color + ";opacity:.35'></i>" + s.label + "</span>";
        return "<span class='legend-item'><svg width='22' height='10' aria-hidden='true'><line x1='1' x2='21' y1='5' y2='5' stroke='" + s.color + "' stroke-width='" + (s.width || 2) + "' stroke-dasharray='" + (s.dash || "none") + "' stroke-linecap='round'/></svg>" + s.label + "</span>";
      }).join("") + (o.bands || []).filter(function (b, i, a) { return b.label && a.findIndex(function (c) { return c.cls === b.cls; }) === i; }).map(function (b) { return "<span class='legend-item'><i class='band-key " + b.cls + "'></i>" + b.label + "</span>"; }).join("");
    }
    state.update = function (opts2) { state.opts = opts2; legendHTML(); draw(); if (!tbox.hidden) table(); };
    legendHTML(); draw();
    if (typeof ResizeObserver !== "undefined") { var lastW = 0; new ResizeObserver(function () { var w = wrap.clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; draw(); } }).observe(wrap); }
    return state;
  }
  // ---- a tornado: one row per input, bars from the base value to the result with the input down and up
  // opts: bars [{label, atLo, atHi, loText, hiText}], base, fmt, downLabel, upLabel, colors {down, up}
  function tornado(host, opts) {
    host.classList.add("chart"); host.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "chart-plot"; host.appendChild(wrap);
    var tip = document.createElement("div"); tip.className = "chart-tip"; tip.hidden = true; wrap.appendChild(tip);
    var bars = opts.bars, rowH = 26, m = { l: 190, r: 16, t: 8, b: 26 }, W = Math.max(320, wrap.clientWidth || 640), H = m.t + m.b + rowH * Math.max(1, bars.length);
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": opts.ariaLabel || "" }); wrap.insertBefore(svg, tip);
    var vals = [opts.base]; bars.forEach(function (b) { vals.push(b.atLo, b.atHi); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), xt = nice(lo, hi, 4), iw = W - m.l - m.r;
    var X = function (v) { return m.l + (v - xt.lo) / (xt.hi - xt.lo) * iw; };
    xt.ticks.forEach(function (v) { el("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, "class": "grid" }, svg); var t = el("text", { x: X(v), y: H - m.b + 16, "class": "tick", "text-anchor": "middle" }, svg); t.textContent = opts.fmt(v); });
    bars.forEach(function (b, i) {
      var y = m.t + i * rowH + 5, h = rowH - 10;
      var lab = el("text", { x: m.l - 8, y: y + h / 2 + 4, "class": "tick tor-label", "text-anchor": "end" }, svg); lab.textContent = b.label;
      [["atLo", opts.colors.down, b.loText], ["atHi", opts.colors.up, b.hiText]].forEach(function (e) {
        var v = b[e[0]], x1 = Math.min(X(opts.base), X(v)), x2 = Math.max(X(opts.base), X(v));
        var r = el("rect", { x: x1, y: y, width: Math.max(1, x2 - x1), height: h, rx: 2, fill: e[1] }, svg);
        r.addEventListener("pointermove", function (ev) {
          tip.innerHTML = "<b>" + b.label + "</b><span>" + e[2] + "<em>" + opts.fmt(v) + "</em></span>"; tip.hidden = false;
          var rr = svg.getBoundingClientRect(), px = ev.clientX - rr.left; tip.style.left = Math.min(wrap.clientWidth - tip.offsetWidth - 4, px + 12) + "px"; tip.style.top = (y / H * rr.height + 18) + "px";
        });
        r.addEventListener("pointerleave", function () { tip.hidden = true; });
      });
    });
    el("line", { x1: X(opts.base), x2: X(opts.base), y1: m.t, y2: H - m.b, "class": "axis base-line" }, svg);
    var lg = document.createElement("div"); lg.className = "chart-legend";
    lg.innerHTML = "<span class='legend-item'><i class='band-key' style='background:" + opts.colors.down + "'></i>" + opts.downLabel + "</span><span class='legend-item'><i class='band-key' style='background:" + opts.colors.up + "'></i>" + opts.upLabel + "</span><span class='legend-item'>│ " + opts.baseLabel + "</span>";
    host.appendChild(lg);
  }

  // ---- a scatter of options: x and y results; points can be highlighted (the frontier) or marked (the current one)
  // opts: points [{x, y, front, current, best, title}], xFmt, yFmt, xLabel, yLabel, onPick(point), legend
  function scatter(host, opts) {
    host.classList.add("chart"); host.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "chart-plot"; host.appendChild(wrap);
    var tip = document.createElement("div"); tip.className = "chart-tip"; tip.hidden = true; wrap.appendChild(tip);
    var W = Math.max(300, wrap.clientWidth || 640), H = opts.height || 300, m = { l: 64, r: 14, t: 10, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": opts.ariaLabel || "" }); wrap.insertBefore(svg, tip);
    var xs = opts.points.map(function (p) { return p.x; }), ys = opts.points.map(function (p) { return p.y; });
    var xt = nice(Math.min.apply(null, xs), Math.max.apply(null, xs), 5), yt = nice(Math.min.apply(null, ys), Math.max.apply(null, ys), 4);
    var X = function (v) { return m.l + (v - xt.lo) / (xt.hi - xt.lo) * iw; }, Y = function (v) { return m.t + ih - (v - yt.lo) / (yt.hi - yt.lo) * ih; };
    yt.ticks.forEach(function (v) { el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v), "class": "grid" }, svg); var t = el("text", { x: m.l - 6, y: Y(v) + 3.5, "class": "tick", "text-anchor": "end" }, svg); t.textContent = opts.yFmt(v); });
    xt.ticks.forEach(function (v) { var t = el("text", { x: X(v), y: m.t + ih + 16, "class": "tick", "text-anchor": "middle" }, svg); t.textContent = opts.xFmt(v); });
    var xl = el("text", { x: m.l + iw, y: H - 2, "class": "tick axis-label", "text-anchor": "end" }, svg); xl.textContent = opts.xLabel;
    var yl = el("text", { x: m.l, y: m.t + 10, "class": "tick axis-label", "text-anchor": "start", dx: 6 }, svg); yl.textContent = opts.yLabel;
    // draw the ordinary points first, the frontier and the marked ones on top
    opts.points.slice().sort(function (a, b) { return (a.front || a.current || a.best ? 1 : 0) - (b.front || b.current || b.best ? 1 : 0); }).forEach(function (p) {
      var c = el("circle", { cx: X(p.x), cy: Y(p.y), r: p.best ? 7 : p.current ? 6.5 : p.front ? 5 : 3.5, "class": "pt" + (p.front ? " front" : "") + (p.current ? " current" : "") + (p.best ? " best" : "") }, svg);
      c.addEventListener("pointermove", function (ev) {
        tip.innerHTML = p.title; tip.hidden = false;
        var rr = svg.getBoundingClientRect(), px = ev.clientX - rr.left, py = ev.clientY - rr.top;
        tip.style.left = Math.max(4, Math.min(wrap.clientWidth - tip.offsetWidth - 4, px + 12)) + "px"; tip.style.top = Math.max(4, py - 10) + "px";
      });
      c.addEventListener("pointerleave", function () { tip.hidden = true; });
      if (opts.onPick) { c.style.cursor = "pointer"; c.addEventListener("click", function () { opts.onPick(p); }); }
    });
    if (opts.legend) { var lg = document.createElement("div"); lg.className = "chart-legend"; lg.innerHTML = opts.legend; host.appendChild(lg); }
  }
  window.SPCharts = { line: line, tornado: tornado, scatter: scatter, nice: nice };
})();
