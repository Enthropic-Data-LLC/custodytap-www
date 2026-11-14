// CustodyTap estimate for transient cyber assets (TCAs) and removable media under NERC CIP.
// Model 2026-11-14. Labor is assumed from how each method works; the noncompliance rate is anchored to
// NERC's published counts. Entered values are held fixed; everything else is drawn from its range.
//
// Noncompliance anchor (per registered entity-year, for an entity using the industry's usual methods):
//   medium/high impact: (CIP-010 reports x share that is R4 + CIP-011 reports x share that is R2) / entities
//   low impact only:     CIP-003 reports x share that is Attachment 1 Section 5 / entities
//   Reports: NERC 2024 CMEP and ORCP Annual Report Fig. 6 (CIP-010 182, CIP-003 133, CIP-011 31) and
//   2025 ORCP and CMEP Annual Report Fig. 6 (CIP-010 245, CIP-003 100, CIP-011 64).
//   Entities: FERC (86 FR 35783, July 7 2021): 343 own medium/high impact BES Cyber Systems, 1,149 low
//   impact; 1,673 U.S. entities subject to CIP as of June 2025 (FERC, Sept 23 2025).
//   Dispositions 2025: 83% Compliance Exception, 14% FFT, 2% Spreadsheet NOP (Fig. 12), rest Full NOP.
"use strict";

(function (root) {
  const C = (typeof module !== "undefined" && module.exports) ? require("../../estimate-core.js") : root.CTEstimate;
  const N_SIMS = 10000;
  const SEED = 20261114;

  // Per method, as [low, most likely, high]. All are assumptions; the pilot measures them.
  //   log: minutes to record one use (authorization, scan method and result, connect and disconnect)
  //   review: compliance hours a month checking the logs · req: hours to pull TCA/RM evidence for one
  //   audit, spot check or internal review · disp: minutes per reuse or disposal record
  //   lost: compliance hours per lost item · rate: noncompliance relative to the industry's usual methods
  //   tool: tool cost a year
  const METHODS = {
    paper:       { log: [3, 5, 10], review: [2, 4, 10], req: [8, 24, 60], disp: [20, 45, 90], lost: [4, 8, 20], rate: [1.0, 1.1, 1.3], tool: [0, 100, 300] },
    spreadsheet: { log: [3, 6, 10], review: [1, 3, 8], req: [6, 16, 40], disp: [20, 40, 80], lost: [3, 6, 16], rate: [0.9, 1.0, 1.1], tool: [0, 0, 0] },
    cmms:        { log: [2, 4, 8], review: [1, 2, 5], req: [4, 10, 24], disp: [15, 30, 60], lost: [2, 5, 12], rate: [0.7, 0.85, 1.0], tool: [0, 1500, 6000] },
    custodytap:  { log: [1, 1.5, 3], review: [0.25, 0.5, 2], req: [1, 3, 8], disp: [5, 10, 20], lost: [1, 2, 6], rate: null, tool: null },
  };

  // inp: { method, impact: "mh" | "low", tcas, media, ncCount, reqHours, techRate, compRate, uses, techs, swCost }
  function simulate(inp, nSims) {
    const n = nSims || N_SIMS;
    const { tri, pick } = C.sampler(SEED);
    const cur = inp.method;
    const mh = inp.impact !== "low";
    const keys = ["hours", "labor", "setup", "tool", "risk", "total", "nc3", "p3", "p3pen"];
    const sum = { cur: {}, ct: {} };
    keys.forEach((k) => { sum.cur[k] = 0; sum.ct[k] = 0; });
    const saving = new Float64Array(n);
    const hoursSaved = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      // program profile
      const Nt = pick(inp.tcas, [5, 20, 60]);
      const Nr = pick(inp.media, [10, 40, 150]);
      const usesT = pick(inp.uses, [12, 24, 52]);   // connections per TCA a year
      const usesR = pick(inp.uses, [4, 12, 40]);    // per removable media item
      const techs = pick(inp.techs, [5, 15, 40]);
      // loaded wages: BLS OEWS May 2023, powerhouse/substation/relay repairers median $46.44/h; compliance
      // officers in electric power generation, transmission and distribution mean $54.21/h; benefits ~30-35%
      const wt = pick(inp.techRate, [55, 68, 85]);
      const wc = pick(inp.compRate, [65, 80, 100]);
      // evidence requests a year: audits, spot checks, self-certifications, internal reviews
      const req = mh ? tri([1, 1.5, 3]) : tri([0.3, 0.7, 1.5]);
      const D = Nt / tri([3, 4, 6]) + Nr / tri([2, 3, 5]);           // reuse or disposal events a year
      const lostN = Nt * tri([0.002, 0.01, 0.03]) + Nr * tri([0.01, 0.03, 0.08]);
      const tagMin = tri([3, 5, 8]);
      const tagCost = tri([3, 6, 12]);                               // field-rated NTAG 424 DNA tags
      const trainH = tri([0.5, 1, 2]);
      // noncompliance anchor
      const entMH = tri([343, 380, 450]);
      const entLow = tri([1149, 1300, 1700]);
      const c010 = tri([182, 214, 245]), shR4 = tri([0.10, 0.25, 0.40]);
      const c011 = tri([31, 48, 64]), shR2 = tri([0.15, 0.30, 0.50]);
      const c003 = tri([100, 116, 133]), shS5 = tri([0.10, 0.20, 0.35]);
      const base = mh ? (c010 * shR4 + c011 * shR2) / entMH : (c003 * shS5) / entLow;
      // share of these noncompliances that a complete record made at the time of use would prevent
      const prevent = tri([0.2, 0.45, 0.7]);
      // cost of one noncompliance: compliance and SME hours by disposition; legal and penalty for the
      // few that go to a Notice of Penalty (CIP penalty amounts have not been public since 2020)
      const pPen = tri([0.02, 0.03, 0.05]);
      const pFft = 0.14;
      const ncHours = (1 - pFft - pPen) * tri([16, 40, 120]) + pFft * tri([40, 120, 300]) + pPen * tri([120, 300, 800]);
      const ncCost = ncHours * wc + pPen * (tri([10000, 30000, 100000]) + tri([0, 30000, 250000]));

      const out = {};
      let curRate = 1;
      for (const k of [cur, "custodytap"]) {
        const P = METHODS[k];
        const tLog = tri(P.log), rev = tri(P.review), tDisp = tri(P.disp), hLost = tri(P.lost);
        let hReq = tri(P.req);
        if (k === cur && inp.reqHours != null) hReq = inp.reqHours;
        if (k === "custodytap" && inp.reqHours != null) hReq = Math.min(hReq, inp.reqHours);
        let tool;
        if (k === "custodytap") tool = ((Nt + Nr) / 3 + D) * tagCost;   // tags only; no subscription
        else if (k === "cmms") { const d = tri(P.tool); tool = inp.swCost != null ? inp.swCost : d; }
        else tool = tri(P.tool);

        const techH = (Nt * usesT + Nr * usesR) * tLog / 60 + D * tDisp / 60;
        const compH = 12 * rev + req * hReq + lostN * hLost;
        const labor = techH * wt + compH * wc;
        const setup = k === "custodytap"
          ? (((Nt + Nr) * tagMin / 60 + techs * trainH) * wt + 8 * wc) / 3
          : 0;
        let lam;
        if (k === cur) {
          curRate = tri(P.rate);
          // your own count over three years, plus half an event so a clean record isn't read as zero risk
          lam = inp.ncCount != null ? (inp.ncCount + 0.5) / 3 : base * curRate;
        } else {
          lam = (inp.ncCount != null ? (inp.ncCount + 0.5) / 3 / curRate : base) * (1 - prevent);
        }
        const risk = lam * ncCost;
        out[k] = { hours: techH + compH, labor, setup, tool, risk, total: labor + setup + tool + risk,
                   nc3: 3 * lam, p3: 1 - Math.exp(-3 * lam), p3pen: 1 - Math.exp(-3 * lam * pPen) };
      }
      const b = out[cur], c = out.custodytap;
      for (const k of keys) { sum.cur[k] += b[k]; sum.ct[k] += c[k]; }
      saving[i] = b.total - c.total;
      hoursSaved[i] = b.hours - c.hours;
    }
    for (const k of keys) { sum.cur[k] /= n; sum.ct[k] /= n; }
    return { cur: sum.cur, ct: sum.ct, saving: C.summary(saving), hoursSaved: C.summary(hoursSaved).mean, n };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { simulate, METHODS };
    return;
  }

  // ── Page ──────────────────────────────────────────────────────────────
  const formEl = document.getElementById("est");
  if (!formEl) return;
  const set = C.setText;

  const NAMES = { paper: "paper forms", spreadsheet: "a spreadsheet", cmms: "asset or maintenance software" };
  const SHORT = { paper: "Paper forms", spreadsheet: "Spreadsheet", cmms: "Asset software" };
  const REQ_RANGE = { paper: "8 to 60 hours", spreadsheet: "6 to 40 hours", cmms: "4 to 24 hours" };
  const REQS = { mh: "CIP-010 R4 and CIP-011 R2", low: "CIP-003 Attachment 1 Section 5" };

  const F = C.form(formEl, {
    tcas:     { required: true, min: 0, max: 5000, int: true, msg: "Enter a whole number from 0 to 5,000." },
    media:    { required: true, min: 0, max: 20000, int: true, msg: "Enter a whole number from 0 to 20,000." },
    ncCount:  { min: 0, max: 500, int: true, msg: "Enter a whole number from 0 to 500, or leave it blank." },
    reqHours: { min: 0, max: 1000, msg: "Enter hours from 0 to 1,000, or leave it blank." },
    techRate: { min: 10, max: 400, msg: "Enter a dollar amount from 10 to 400, or leave it blank." },
    compRate: { min: 10, max: 500, msg: "Enter a dollar amount from 10 to 500, or leave it blank." },
    uses:     { min: 0, max: 1000, msg: "Enter a number from 0 to 1,000, or leave it blank." },
    techs:    { min: 1, max: 5000, int: true, msg: "Enter a whole number from 1 to 5,000, or leave it blank." },
    swCost:   { min: 0, max: 1000000, msg: "Enter a dollar amount, or leave it blank." },
  });

  function render() {
    const method = formEl.elements.method.value;
    const impact = formEl.elements.impact.value;
    document.getElementById("f-swCost-wrap").hidden = method !== "cmms";
    set("h-reqHours-range", REQ_RANGE[method]);
    set("r-reqs", REQS[impact]);

    const { inp, bad } = F.read();
    if (!F.ready(bad, document.getElementById("est-out"), "Enter how many transient cyber assets and removable media you have to see an estimate.")) return;
    if (inp.tcas + inp.media === 0) {
      F.ready([{ name: "tcas", empty: true }], document.getElementById("est-out"), "Enter at least one transient cyber asset or removable media item.");
      return;
    }
    inp.method = method;
    inp.impact = impact;

    const r = simulate(inp);
    const s = r.saving;
    set("o-big", C.money(Math.abs(s.mean)) + " a year");
    set("o-sub", (s.mean >= 0 ? "less" : "more") + " in staff time and expected noncompliance costs than " + NAMES[method] +
      ", before CustodyTap's own subscription.");
    set("o-range", "8 in 10 simulations fall between " + C.money(s.p10) + " and " + C.money(s.p90) + ".");
    const hs = r.hoursSaved;
    set("o-hours", hs >= 0
      ? "About " + C.hrs(hs) + " fewer technician and compliance hours a year (" + C.hrs(r.cur.hours) + " now, " + C.hrs(r.ct.hours) + " with CustodyTap)."
      : "About " + C.hrs(-hs) + " more technician and compliance hours a year.");

    set("t-cur-head", SHORT[method]);
    const m10 = (v) => C.money(v, 10);
    const rows = [["hours", C.hrs], ["labor", m10], ["setup", m10], ["tool", m10], ["risk", m10], ["total", m10]];
    for (const [k, f] of rows) { set("t-cur-" + k, f(r.cur[k])); set("t-ct-" + k, f(r.ct[k])); }

    set("r-cur-head", SHORT[method]);
    set("r-cur-p3", C.pct(r.cur.p3)); set("r-ct-p3", C.pct(r.ct.p3));
    set("r-cur-nc3", C.count(r.cur.nc3)); set("r-ct-nc3", C.count(r.ct.nc3));
    set("r-cur-pen", C.pct(r.cur.p3pen)); set("r-ct-pen", C.pct(r.ct.p3pen));
    set("r-basis", inp.ncCount != null
      ? "Based on the " + inp.ncCount + " you entered for the last three years."
      : "Based on NERC's national counts for " + REQS[impact] + ", spread across the registered entities they apply to.");
  }

  F.listen(render);
})(this);
