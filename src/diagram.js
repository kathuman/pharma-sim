// Supply Pulse — the stock-and-flow diagram (window.SPDiagram). Boxes are stocks, valves are flows, circles are the
// planners' information; each shows its value in the week the reader points at on any chart.
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function T(t, v) { var I = window.SPi18n; return I ? I.T(t, v) : String(t).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; }); }
  function el(tag, attrs, parent, text) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  var I18 = function () { return window.SPi18n || { locale: "en-US", fx: function (v, d) { return Number(v).toFixed(d); } }; };
  var fmt = function (v) { return v == null ? "—" : Math.round(v).toLocaleString(I18().locale); };
  var fx = function (v, d) { return I18().fx(v, d); };

  function render(host, multi, ing) {
    host.innerHTML = "";
    var W = multi ? 1040 : 820, H = ing ? 430 : 330;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "sfd", role: "img", "aria-label": T("Stock-and-flow diagram of the supply chain") }, host);
    var defs = el("defs", {}, svg);
    var mk = el("marker", { id: "arw", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", "class": "arw" }, mk);
    var mk2 = el("marker", { id: "arwi", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", "class": "arwi" }, mk2);
    var vals = {};
    function stock(id, x, y, w, label) {
      var g = el("g", { "class": "sfd-stock", "data-id": id }, svg);
      el("rect", { x: x, y: y, width: w, height: 56, rx: 3 }, g);
      el("text", { x: x + w / 2, y: y + 22, "class": "sfd-name" }, g, label);
      vals[id] = el("text", { x: x + w / 2, y: y + 42, "class": "sfd-val" }, g, "");
    }
    function flow(id, x1, y1, x2, y2, label, below) {
      el("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": "sfd-pipe", "marker-end": "url(#arw)" }, svg);
      var vx = (x1 + x2) / 2, vy = (y1 + y2) / 2;
      el("path", { d: "M" + (vx - 7) + "," + (vy - 7) + " L" + (vx + 7) + "," + (vy + 7) + " M" + (vx + 7) + "," + (vy - 7) + " L" + (vx - 7) + "," + (vy + 7), "class": "sfd-valve" }, svg);
      var horiz = Math.abs(y2 - y1) < 1;
      el("text", { x: horiz ? vx : vx + 12, y: horiz ? (below ? vy + 24 : vy - 14) : vy + 4, "class": "sfd-flow", "text-anchor": horiz ? "middle" : "start" }, svg, label);
      vals[id] = el("text", { x: horiz ? vx : vx + 12, y: horiz ? (below ? vy + 37 : vy - 27) : vy + 17, "class": "sfd-fval", "text-anchor": horiz ? "middle" : "start" }, svg, "");
    }
    function cloud(x, y) { el("circle", { cx: x, cy: y, r: 9, "class": "sfd-cloud" }, svg); }
    function aux(id, x, y, label) {
      el("circle", { cx: x, cy: y, r: 6, "class": "sfd-aux" }, svg);
      el("text", { x: x, y: y + 20, "class": "sfd-flow", "text-anchor": "middle" }, svg, label);
      vals[id] = el("text", { x: x, y: y + 33, "class": "sfd-fval", "text-anchor": "middle" }, svg, "");
    }
    function link(x1, y1, x2, y2, bend) {
      var mx = (x1 + x2) / 2 + (bend || 0), my = (y1 + y2) / 2 - Math.abs(bend || 0) * 0.4;
      el("path", { d: "M" + x1 + "," + y1 + " Q" + mx + "," + my + " " + x2 + "," + y2, "class": "sfd-link", "marker-end": "url(#arwi)" }, svg);
    }
    var y = 150, my = y + 28;
    // workforce sets capacity
    cloud(28, 64); flow("hire", 37, 64, 92, 64, T("Hiring")); stock("workforce", 92, 36, 120, T("Workforce")); flow("leave", 212, 64, 262, 64, T("Leaving")); cloud(271, 64);
    // production → QA → plant stock → shipments
    cloud(28, my); flow("production", 37, my, 150, my, T("Production"), true); stock("qa", 150, y, 130, T("QA hold"));
    flow("approved", 280, my, 390, my, T("Released"), true); stock("inventory", 390, y, 140, T("Plant stock"));
    // waste
    el("line", { x1: 335, y1: my, x2: 335, y2: my - 2, "class": "sfd-pipe" }, svg);
    flow("rejected", 335, my - 4, 335, 112, T("Rejected")); cloud(335, 103);
    flow("expired", 460, y, 460, 112, T("Written off")); cloud(460, 103);
    if (!multi) {
      flow("shipped", 530, my, 650, my, T("Shipped to customers")); cloud(660, my);
    } else {
      flow("shipped", 530, my, 620, my, T("Shipped"), true); stock("transit", 620, y, 110, T("In transit"));
      flow("arrive", 730, my, 790, my, "", true); stock("distInventory", 790, y, 130, T("Distributor stock"));
      flow("served", 920, my, 1010, my, T("Served"), true); cloud(1020, my);
    }
    // information
    aux("forecast", multi ? 700 : 600, 290, T("Forecast"));
    aux("target", 460, 290, T("Target stock"));
    aux("desired", 215, 290, T("Desired production"));
    link(multi ? 694 : 594, 290, 470, 290); link(454, 290, 225, 290); link(460, 206, 300, 286, -20); link(215, 206, 215, 280);
    link(209, 286, 98, my + 10, 30);            // desired production → production
    link(205, 284, 64, 74, -90);                // desired production → hiring
    link(92, 92, 92, my - 4, 0);
    if (multi) { aux("orders", 850, 290, T("Orders to the plant")); link(850, 206, 850, 282); link(842, 290, 708, 290); }
    else link(590, my + 8, 594, 282);
    // the ingredient supplier: what is on order and on its way, the plant's ingredient stock, and what production uses
    if (ing) {
      var ay = 352, amy = ay + 28;
      cloud(20, amy); flow("ingOrdered", 29, amy, 120, amy, T("Ingredient ordered"), true); stock("ingOnOrder", 120, ay, 120, T("Ingredient on order"));
      flow("ingDeliver", 240, amy, 300, amy, "", true); stock("ingStock", 300, ay, 120, T("Ingredient stock"));
      flow("ingUsed", 420, amy, 550, amy, T("Used by production"), true); cloud(560, amy);
      link(330, ay, 98, my + 12, -60);
    }
    return { svg: svg, vals: vals };
  }
  function update(d, r) {
    if (!d || !r) return;
    var v = { workforce: fx(r.workforce, 1), qa: fmt(r.qa), inventory: fmt(r.inventory), transit: fmt(r.transit), distInventory: fmt(r.distInventory),
      production: fmt(r.production), approved: fmt(r.approved), rejected: fmt(r.rejected), expired: fmt(r.expired), shipped: fmt(r.shipped), served: fmt(r.served),
      forecast: fmt(r.forecast), target: fmt(r.target), desired: fmt(r.desired), orders: fmt(r.ordersToMfg), hire: "", leave: "", arrive: "",
      ingOrdered: fmt(r.ingOrders), ingOnOrder: fmt(r.ingBacklog + r.ingTransit), ingStock: fmt(r.ingStock), ingUsed: fmt(r.production), ingDeliver: "" };
    for (var k in d.vals) d.vals[k].textContent = v[k] != null ? v[k] : "";
  }
  window.SPDiagram = { render: render, update: update };
})();
