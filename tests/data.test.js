// PharmaSim demand-history tests — run with: node tests/data.test.js
const D = require("../src/data.js"), M = require("../src/model.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const weekly = (vals, head) => (head || "week,demand") + "\n" + vals.map((v, i) => (i + 1) + "," + v).join("\n");

check("numbers: 1,234.5 · 1.234,5 · 1234,5 · spaces", D.number("1,234.5") === 1234.5 && D.number("1.234,5") === 1234.5 && D.number("1234,5") === 1234.5 && D.number(" 12 000 ") === 12000 && D.number("abc") === null);
check("dates: ISO and day-first", D.day("2026-03-02") === D.day("02/03/2026") && D.day("2026/03/09") - D.day("2026-03-02") === 7 && D.day("nope") === null);
check("CSV: semicolons, quotes, a byte-order mark, blank lines", D.rows('﻿a;b\n"x;y";2\n\n3;4\n').rows.length === 3 && D.rows('a;b\n"x;y";2').rows[1][0] === "x;y");
{
  const h = D.read(weekly([100, 100, 100, 100, 120, 120, 120, 120, 120, 120]));
  check("weekly with a header: ten weeks, level from the first four", h.ok && h.weeks.length === 10 && h.level === 100 && h.notes.length === 0);
  const p = D.toParams(h), r = M.run(Object.assign({}, p, { noise: 0 }));
  check("…replayed by the model: demand follows the history", r.ok && Math.abs(r.rows[Math.round(5 / 0.25)].demand - 120) < 1e-9 && p.weeks === 26 && p.noise === 0);
}
{
  const es = "Semana;Unidades\n" + Array.from({ length: 12 }, (_, i) => (i + 1) + ";" + (i < 6 ? "1.000,0" : "1.500,0")).join("\n");
  const h = D.read(es);
  check("Spanish headers, semicolons and decimal commas", h.ok && h.weeks.length === 12 && h.weeks[0] === 1000 && h.weeks[11] === 1500);
}
{
  const lines = ["fecha,pedidos"]; for (let d = 0; d < 70; d++) lines.push(new Date(Date.UTC(2026, 0, 5 + d)).toISOString().slice(0, 10) + "," + (d < 35 ? 100 : 200));
  const h = D.read(lines.join("\n"));
  check("daily data added up into weeks", h.ok && h.weeks.length === 10 && h.weeks[0] === 700 && h.weeks[9] === 1400 && h.notes.some((n) => /Daily data/.test(n)), JSON.stringify(h.weeks));
  lines.pop(); const h2 = D.read(lines.join("\n"));
  check("…an incomplete last week is left out", h2.weeks.length === 9 && h2.notes.some((n) => /incomplete/.test(n)));
}
{
  const h = D.read("month,product,value\n" + Array.from({ length: 9 }, (_, i) => "2026-0" + 1 + "-" + String(i * 7 + 1).padStart(2, "0") + ",A," + (500 + i)).join("\n"));
  check("a column called value is found; weekly dates kept as weeks", h.ok && h.weeks.length === 9 && h.weeks[8] === 508);
  const g = D.read("x,y,z\n" + Array.from({ length: 9 }, (_, i) => "a" + i + ",b," + (300 + i)).join("\n"));
  check("no known header: the last numeric column is used, with a note", g.ok && g.weeks[0] === 300 && g.notes.some((n) => /No column called demand/.test(n)));
  const n = D.read(Array.from({ length: 9 }, (_, i) => String(50 + i)).join("\n"));
  check("no header at all: a single column of numbers", n.ok && n.weeks.length === 9 && n.weeks[0] === 50);
}
{
  const h = D.read(weekly([10, 10, "", 10, "x", 10, 10, 10, 10, 10]));
  check("rows without a usable number are skipped, with a note", h.ok && h.weeks.length === 8 && h.notes.some((n) => /2 rows/.test(n)));
  check("too short, empty, or no level: refused with a reason", !D.read(weekly([1, 2, 3])).ok && !D.read("").ok && !D.read(weekly([0, 0, 0, 0, 5, 5, 5, 5, 5])).ok && !D.read("a,b\nx,y\nz,w").ok);
}
{
  const flat = D.read(weekly(Array(52).fill(1000))), up = D.read(weekly(Array.from({ length: 52 }, (_, i) => 1000 + 10 * i)));
  check("summary: no trend and no variation for a flat history", Math.abs(flat.trend) < 1e-12 && flat.variation < 1e-12);
  check("…a rising history has a positive trend (per year, as a share of the mean)", up.trend > 0.3 && up.trend < 0.5, up.trend);
  const s = D.read(D.sample());
  check("the sample file reads: 104 weeks, a level near 11,500, some variation", s.ok && s.weeks.length === 104 && Math.abs(s.level - 11500) < 600 && s.variation > 0.02, s.level);
  const r = M.run(D.toParams(s));
  check("…and the model runs it without errors", r.ok && r.rows.length === 104 / 0.25);
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
