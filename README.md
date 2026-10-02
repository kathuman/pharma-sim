# PharmaSim — Pharma Supply Chain Simulator (Executive Edition)

**Live: [kathuman.github.io/pharma-sim](https://kathuman.github.io/pharma-sim/)**

A system-dynamics simulator of a pharmaceutical supply chain for strategy discussions: shock the market,
change the network, apply a policy, and see the effect on profit, service, the bullwhip effect and waste —
against a saved baseline.

![The dashboard: profit, fill rate, bullwhip and waste, and demand against production](docs/screenshot.jpg)

## What it shows

- **The bullwhip effect** — a step change in market demand, smoothed into a forecast (exponential
  smoothing), drives production that overshoots and oscillates; the dashboard measures the amplification
  (supply fluctuation over market fluctuation).
- **Multi-echelon amplification** — add a retail/distributor tier between the market and the factory and
  watch the factory's view of demand distort further.
- **Pharma-specific stocks and delays** — QA quarantine before release, a workforce that sets production,
  and expiry of inventory past its shelf life.
- **Policy levers and their trade-offs** — emergency overtime (faster recovery, higher labour cost) and
  expedited QA (shorter quarantine, more defects and waste).
- **KPIs** — annual profit, order fill rate, bullwhip ratio and the cost of expired goods, with a saved
  baseline to compare against.

The **Explanation** and **Equations** tabs document the causal structure and the stock-and-flow
equations (integrated by Euler's method).

## Run it

A single static page — open `index.html`, or serve the folder with any static server
(`python -m http.server`).

---

Daniel Sepulveda Estay · [Estay Dynamics](https://kathuman.github.io/estay-dynamics/) — system dynamics and supply chain network design.
