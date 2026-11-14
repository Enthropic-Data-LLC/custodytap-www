// CustodyTap estimate for healthcare practices (HIPAA §164.310(d)).
// Model: custody-tracker analysis/practice_savings.py (2026-11-14), updated the same day:
//   - the breach rate is calibrated to OCR's 2024 count of small breaches (74,299; was 63,966 for 2022);
//   - the chance of a federal penalty after a small breach reflects that OCR opened investigations
//     into only 2 of 74,299 small breaches in 2024;
//   - a compliance-finding path was added: an OCR complaint investigation that asks for device records.
// Entered values are held fixed; everything else is drawn from its range.
"use strict";

(function (root) {
  const C = (typeof module !== "undefined" && module.exports) ? require("../../estimate-core.js") : root.CTEstimate;
  const N_SIMS = 10000;
  const SEED = 20261114;

  // Per method, as [low, most likely, high]. All are assumptions; the pilot measures them.
  //   move: minutes per recorded move · rec: share of moves recorded · cnt: inventory counts a year
  //   tcnt: minutes per device per count · disp: minutes per disposal · req: hours per "show me" request
  //   ctrl: share of disposals the method keeps from leaving unwiped · mit: penalty reduction from records
  //   find: chance OCR finds a device-records problem when it asks for them
  //   tool: tool cost a year · setup: [staff hours, manager hours], "tag" = tag every device
  const METHODS = {
    informal:    { move: [0, 0, 0], rec: [0, 0, 0], cnt: [0, 0.5, 1], tcnt: [3, 5, 10], disp: [5, 10, 20], req: [4, 8, 16], ctrl: [0, 0, 0], mit: [0, 0, 0], find: [0.6, 0.8, 0.95], tool: [0, 0, 0], setup: [0, 0] },
    clipboard:   { move: [0.5, 1, 2], rec: [0.3, 0.6, 0.85], cnt: [0.5, 1, 1], tcnt: [3, 5, 10], disp: [15, 30, 60], req: [3, 6, 12], ctrl: [0.1, 0.2, 0.4], mit: [0, 0, 0], find: [0.4, 0.6, 0.8], tool: [0, 20, 50], setup: [0, 1] },
    spreadsheet: { move: [1, 3, 6], rec: [0.4, 0.65, 0.9], cnt: [1, 1, 2], tcnt: [3, 5, 10], disp: [15, 30, 60], req: [2, 4, 8], ctrl: [0.2, 0.35, 0.5], mit: [0, 0.05, 0.15], find: [0.3, 0.5, 0.7], tool: [0, 0, 0], setup: [2, 4] },
    asset_sw:    { move: [0.5, 1, 2], rec: [0.6, 0.8, 0.95], cnt: [1, 1, 2], tcnt: [1, 2, 4], disp: [10, 20, 40], req: [1, 2, 4], ctrl: [0.3, 0.45, 0.6], mit: [0, 0.1, 0.3], find: [0.15, 0.3, 0.5], tool: [400, 600, 1500], setup: ["tag", 6] },
    custodytap:  { move: [0.4, 0.75, 1.5], rec: [0.7, 0.9, 0.98], cnt: [1, 1, 2], tcnt: [0.5, 1, 2], disp: [3, 6, 12], req: [0.5, 1, 2], ctrl: [0.6, 0.8, 0.92], mit: [0, 0.15, 0.4], find: [0.05, 0.15, 0.3], tool: null, setup: ["tag", 2] },
  };
  const ORDER = ["informal", "clipboard", "spreadsheet", "asset_sw", "custodytap"];

  // inp: { method, encrypted, devices, requests, reqHours, staffRate, mgrRate, moves, staff, assetSw }
  // null for any number = use its range.
  function simulate(inp, nSims) {
    const n = nSims || N_SIMS;
    const { tri, logn, pick } = C.sampler(SEED);
    const cur = inp.method;
    const keys = ["hours", "labor", "setup", "tool", "risk", "total", "p5", "p5enc", "p5find"];
    const sum = { cur: {}, ct: {} };
    keys.forEach((k) => { sum.cur[k] = 0; sum.ct[k] = 0; });
    const saving = new Float64Array(n);
    const hoursSaved = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      // practice profile
      const N = pick(inp.devices, [15, 30, 60]);
      const S = pick(inp.staff, [10, 20, 40]);
      const port = tri([0.3, 0.5, 0.7]);
      const D = N / tri([3, 4, 6]);
      const m = pick(inp.moves, [1, 4, 12]);
      const w = tri([0.05, 0.10, 0.25]);
      const q = pick(inp.requests, [0.5, 1.5, 3]);
      // loaded wages: BLS OEWS medical secretaries $19.54/h (May 2023), medical and health services
      // managers $56.71/h (May 2024), benefits ~30% of compensation (ECEC 2025)
      const ws = pick(inp.staffRate, [26, 29, 34]);
      const wm = pick(inp.mgrRate, [45, 65, 85]);
      // breach inputs
      const pLoss = tri([0.010, 0.025, 0.040]); // Ponemon/Intel 2010: 5-10% of laptops lost over 3 years
      const g = tri([0.2, 0.4, 0.6]);           // share of "lost" devices a record would find
      const fUn = tri([0.05, 0.25, 0.50]);      // lost device holds unencrypted ePHI
      const fEd = tri([0.2, 0.5, 0.8]);         // disposed device still holds ePHI
      const fEdEnc = tri([0.0, 0.05, 0.15]);    // same, when everything is encrypted
      const p0 = tri([0.05, 0.12, 0.25]);       // device leaves unwiped with no process
      const pDisc = tri([0.02, 0.10, 0.30]);    // an unwiped device becomes a known breach
      const val = tri([800, 1200, 2000]);
      const pats = logn(300, Math.log(10) / 1.645);
      const cpp = tri([3, 10, 25]);
      const fix = tri([5000, 15000, 50000]);
      // OCR opened investigations into 2 of 74,299 small breaches in 2024, so a penalty after a small
      // breach is rare: 0 to 0.5%
      const pOcr = tri([0, 0.0005, 0.005]);
      const pen = tri([25000, 75000, 250000]);
      const tagMin = tri([2, 4, 6]);
      const tagCost = tri([2, 4, 7]);
      const trainH = tri([0.25, 0.5, 1.0]);
      const lookFound = tri([1, 3, 5]);
      const lookSearch = tri([15, 45, 120]);
      // national rate per device-year for a spreadsheet practice without full encryption
      // (74,299 small breaches in 2024; 5-15% device loss/theft/disposal; 500k-800k covered entities)
      const tgt = logn(0.009 / 30, 0.70);
      // compliance findings: OCR complaint investigations a practice-year (about 30,000 complaints in
      // 2024, most closed without one), the share that ask for device records, and the cost of a finding
      const inv = tri([0.001, 0.002, 0.004]);
      const askDev = tri([0.05, 0.15, 0.30]);
      const findCost = tri([10, 30, 80]) * wm + tri([0, 3000, 15000]) + tri([0.005, 0.02, 0.05]) * tri([10000, 50000, 250000]);

      const out = {};
      for (const k of ORDER) {
        const P = METHODS[k];
        const tMove = tri(P.move), r = tri(P.rec), kCnt = tri(P.cnt), tCnt = tri(P.tcnt), tDisp = tri(P.disp);
        let hReq = tri(P.req);
        const ctrl = tri(P.ctrl), mit = tri(P.mit), pFind = tri(P.find);
        let tool = P.tool ? tri(P.tool) : 0;
        if (k === cur && inp.reqHours != null) hReq = inp.reqHours;
        if (k === "custodytap" && inp.reqHours != null) hReq = Math.min(hReq, inp.reqHours);
        if (k === "asset_sw" && inp.assetSw != null) tool = inp.assetSw;

        const hMove = N * m * r * tMove / 60;
        const hLook = N * w * (r * lookFound + (1 - r) * lookSearch) / 60;
        const hCount = kCnt * N * tCnt / 60;
        const hDisp = D * tDisp / 60;
        const hReqTot = q * hReq;
        const staffH = hMove + hLook + hCount + hDisp;
        const labor = staffH * ws + hReqTot * wm;
        const setup = P.setup[0] === "tag"
          ? (N * tagMin / 60 * ws + P.setup[1] * wm + S * trainH * ws) / 3
          : (P.setup[0] * ws + P.setup[1] * wm) / 3;
        if (k === "custodytap") tool = (N + D * 2) / 3 * tagCost; // tags only; no subscription
        const lost = N * port * pLoss * (1 - g * r);
        const bUn = lost * fUn + D * p0 * (1 - ctrl) * fEd * pDisc;
        const bEnc = D * p0 * (1 - ctrl) * fEdEnc * pDisc;
        const perBreach = fix + pats * cpp + pOcr * pen * (1 - mit);
        out[k] = { hours: staffH + hReqTot, labor, setup, tool, bUn, bEnc, perBreach, hardware: lost * val,
                   lamFind: inv * askDev * pFind };
      }
      // Calibration: the spreadsheet practice without full encryption is pinned to the national
      // rate; the same factor applies to every method, so the chain sets only the relative risk.
      const kappa = tgt * N / out.spreadsheet.bUn;
      for (const k of [cur, "custodytap"]) {
        const o = out[k];
        const lam = (inp.encrypted ? o.bEnc : o.bUn) * kappa;
        o.risk = lam * o.perBreach + o.hardware + o.lamFind * findCost;
        o.total = o.labor + o.setup + o.tool + o.risk;
        o.p5 = 1 - Math.exp(-5 * lam);
        o.p5enc = 1 - Math.exp(-5 * o.bEnc * kappa);
        o.p5find = 1 - Math.exp(-5 * o.lamFind);
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

  const NAMES = { informal: "no written record", clipboard: "a paper sign-out sheet", spreadsheet: "a spreadsheet", asset_sw: "asset software" };
  const SHORT = { informal: "No record", clipboard: "Paper sheet", spreadsheet: "Spreadsheet", asset_sw: "Asset software" };
  const REQ_RANGE = { informal: "4 to 16 hours", clipboard: "3 to 12 hours", spreadsheet: "2 to 8 hours", asset_sw: "1 to 4 hours" };

  const F = C.form(formEl, {
    devices:   { required: true, min: 1, max: 2000, int: true, msg: "Enter a number of devices from 1 to 2,000." },
    requests:  { min: 0, max: 50, msg: "Enter a number from 0 to 50, or leave it blank." },
    reqHours:  { min: 0, max: 200, msg: "Enter hours from 0 to 200, or leave it blank." },
    staffRate: { min: 8, max: 300, msg: "Enter a dollar amount from 8 to 300, or leave it blank." },
    mgrRate:   { min: 8, max: 500, msg: "Enter a dollar amount from 8 to 500, or leave it blank." },
    moves:     { min: 0, max: 200, msg: "Enter a number from 0 to 200, or leave it blank." },
    staff:     { min: 1, max: 2000, int: true, msg: "Enter a whole number from 1 to 2,000, or leave it blank." },
    assetSw:   { min: 0, max: 200000, msg: "Enter a dollar amount, or leave it blank." },
  });

  function render() {
    const method = formEl.elements.method.value;
    document.getElementById("f-assetSw-wrap").hidden = method !== "asset_sw";
    set("h-reqHours-range", REQ_RANGE[method]);

    const { inp, bad } = F.read();
    if (!F.ready(bad, document.getElementById("est-out"), "Enter how many devices you have to see an estimate.")) return;
    inp.method = method;
    inp.encrypted = formEl.elements.enc.value === "yes";

    const r = simulate(inp);
    const s = r.saving;
    set("o-big", C.money(Math.abs(s.mean)) + " a year");
    set("o-sub", (s.mean >= 0 ? "less" : "more") + " in staff time and expected losses than " + NAMES[method] +
      ", before CustodyTap's own subscription.");
    set("o-range", "8 in 10 simulations fall between " + C.money(s.p10) + " and " + C.money(s.p90) + ".");
    const hs = r.hoursSaved;
    set("o-hours", hs >= 0
      ? "About " + C.hrs(hs) + " fewer staff and manager hours a year (" + C.hrs(r.cur.hours) + " now, " + C.hrs(r.ct.hours) + " with CustodyTap)."
      : "About " + C.hrs(-hs) + " more staff and manager hours a year.");

    set("t-cur-head", SHORT[method]);
    const m10 = (v) => C.money(v, 10); // one step for the whole table, so the rows add up to the total
    const rows = [["hours", C.hrs], ["labor", m10], ["setup", m10], ["tool", m10], ["risk", m10], ["total", m10]];
    for (const [k, f] of rows) { set("t-cur-" + k, f(r.cur[k])); set("t-ct-" + k, f(r.ct[k])); }

    set("r-cur-head", SHORT[method]);
    set("r-cur-breach", C.pct(r.cur.p5));
    set("r-ct-breach", C.pct(r.ct.p5));
    set("r-cur-find", C.pct(r.cur.p5find));
    set("r-ct-find", C.pct(r.ct.p5find));
    set("r-note", inp.encrypted
      ? "Because your laptops and portable drives are encrypted, most of the breach risk is already gone. What's left is mostly old drives that leave without being wiped, which is where the record helps."
      : "If every laptop and portable drive were encrypted, the breach chance would be about " + C.pct(r.cur.p5enc) + " with " +
        NAMES[method] + " and " + C.pct(r.ct.p5enc) + " with CustodyTap. Encryption lowers this risk more than any record can, and CustodyTap doesn't encrypt anything.");
  }

  F.listen(render);
})(this);
