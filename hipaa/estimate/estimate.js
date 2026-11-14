// CustodyTap record-keeping estimate. Runs entirely in the browser and makes no network requests
// (the page's CSP has no connect-src, so it can't).
//
// A port of custody-tracker analysis/practice_savings.py (2026-11-14): the same ranges, the same
// calibration to the national breach rate, the same paired comparison. The one difference is that
// whatever the visitor enters is held fixed instead of drawn from its range. Every random number is
// drawn whether or not it is overridden, so typing a value changes only that value, not the rest of
// the simulation.
"use strict";

(function () {
  const N_SIMS = 10000;
  const SEED = 20261114;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Per method, as [low, most likely, high]. All are assumptions; the pilot measures them.
  //   move: minutes per recorded move · rec: share of moves recorded · cnt: inventory counts a year
  //   tcnt: minutes per device per count · disp: minutes per disposal · req: hours per "show me" request
  //   ctrl: share of disposals the method keeps from leaving unwiped · mit: penalty reduction from records
  //   tool: tool cost a year · setup: [staff hours, manager hours], "tag" = tag every device
  const METHODS = {
    informal:    { move: [0, 0, 0], rec: [0, 0, 0], cnt: [0, 0.5, 1], tcnt: [3, 5, 10], disp: [5, 10, 20], req: [4, 8, 16], ctrl: [0, 0, 0], mit: [0, 0, 0], tool: [0, 0, 0], setup: [0, 0] },
    clipboard:   { move: [0.5, 1, 2], rec: [0.3, 0.6, 0.85], cnt: [0.5, 1, 1], tcnt: [3, 5, 10], disp: [15, 30, 60], req: [3, 6, 12], ctrl: [0.1, 0.2, 0.4], mit: [0, 0, 0], tool: [0, 20, 50], setup: [0, 1] },
    spreadsheet: { move: [1, 3, 6], rec: [0.4, 0.65, 0.9], cnt: [1, 1, 2], tcnt: [3, 5, 10], disp: [15, 30, 60], req: [2, 4, 8], ctrl: [0.2, 0.35, 0.5], mit: [0, 0.05, 0.15], tool: [0, 0, 0], setup: [2, 4] },
    asset_sw:    { move: [0.5, 1, 2], rec: [0.6, 0.8, 0.95], cnt: [1, 1, 2], tcnt: [1, 2, 4], disp: [10, 20, 40], req: [1, 2, 4], ctrl: [0.3, 0.45, 0.6], mit: [0, 0.1, 0.3], tool: [400, 600, 1500], setup: ["tag", 6] },
    custodytap:  { move: [0.4, 0.75, 1.5], rec: [0.7, 0.9, 0.98], cnt: [1, 1, 2], tcnt: [0.5, 1, 2], disp: [3, 6, 12], req: [0.5, 1, 2], ctrl: [0.6, 0.8, 0.92], mit: [0, 0.15, 0.4], tool: null, setup: ["tag", 2] },
  };
  const ORDER = ["informal", "clipboard", "spreadsheet", "asset_sw", "custodytap"];

  // inp: { method, encrypted, devices, requests, reqHours, staffRate, mgrRate, moves, staff, assetSw }
  // null for any number = use its range.
  function simulate(inp, nSims) {
    const n = nSims || N_SIMS;
    const rand = mulberry32(SEED);
    const tri = (a) => {
      const lo = a[0], m = a[1], hi = a[2];
      const u = rand();
      if (hi <= lo) return m;
      const c = (m - lo) / (hi - lo);
      return u < c ? lo + Math.sqrt(u * (hi - lo) * (m - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - m));
    };
    const logn = (median, sigma) => {
      let u = rand(); const v = rand();
      if (u === 0) u = 1e-12;
      return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    };
    const pick = (v, a) => { const d = tri(a); return v == null ? d : v; };

    const cur = inp.method;
    const keys = ["hours", "labor", "setup", "tool", "risk", "total", "p5", "p5enc"];
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
      // risk inputs
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
      const pOcr = tri([0.005, 0.02, 0.05]);
      const pen = tri([25000, 75000, 250000]);
      const tagMin = tri([2, 4, 6]);
      const tagCost = tri([2, 4, 7]);
      const trainH = tri([0.25, 0.5, 1.0]);
      const lookFound = tri([1, 3, 5]);
      const lookSearch = tri([15, 45, 120]);
      // national rate per device-year for a spreadsheet practice without full encryption
      // (63,966 small breaches in 2022; 5-15% device loss/theft/disposal; 500k-800k covered entities)
      const tgt = logn(0.007 / 30, 0.70);

      const out = {};
      for (const k of ORDER) {
        const P = METHODS[k];
        const tMove = tri(P.move), r = tri(P.rec), kCnt = tri(P.cnt), tCnt = tri(P.tcnt), tDisp = tri(P.disp);
        let hReq = tri(P.req);
        const ctrl = tri(P.ctrl), mit = tri(P.mit);
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
        out[k] = { hours: staffH + hReqTot, labor, setup, tool, bUn, bEnc, perBreach, hardware: lost * val };
      }
      // Calibration: the spreadsheet practice without full encryption is pinned to the national
      // rate; the same factor applies to every method, so the chain sets only the relative risk.
      const kappa = tgt * N / out.spreadsheet.bUn;
      for (const k of [cur, "custodytap"]) {
        const o = out[k];
        const lam = (inp.encrypted ? o.bEnc : o.bUn) * kappa;
        o.risk = lam * o.perBreach + o.hardware;
        o.total = o.labor + o.setup + o.tool + o.risk;
        o.p5 = 1 - Math.exp(-5 * lam);
        o.p5enc = 1 - Math.exp(-5 * o.bEnc * kappa);
      }
      const b = out[cur], c = out.custodytap;
      for (const k of keys) { sum.cur[k] += b[k]; sum.ct[k] += c[k]; }
      saving[i] = b.total - c.total;
      hoursSaved[i] = b.hours - c.hours;
    }
    for (const k of keys) { sum.cur[k] /= n; sum.ct[k] /= n; }
    const sorted = Float64Array.from(saving).sort();
    const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      cur: sum.cur, ct: sum.ct,
      saving: { mean: meanOf(saving), p10: pct(sorted, 0.10), p50: pct(sorted, 0.50), p90: pct(sorted, 0.90) },
      hoursSaved: meanOf(hoursSaved),
      n,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { simulate, METHODS };
    return;
  }

  // ── Page ──────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const form = $("est");
  if (!form) return;

  const NAMES = { informal: "no written record", clipboard: "a paper sign-out sheet", spreadsheet: "a spreadsheet", asset_sw: "asset software" };
  const SHORT = { informal: "No record", clipboard: "Paper sheet", spreadsheet: "Spreadsheet", asset_sw: "Asset software" };
  const REQ_RANGE = { informal: "4 to 16 hours", clipboard: "3 to 12 hours", spreadsheet: "2 to 8 hours", asset_sw: "1 to 4 hours" };

  const FIELDS = {
    devices:   { required: true, min: 1, max: 2000, int: true, msg: "Enter a number of devices from 1 to 2,000." },
    requests:  { min: 0, max: 50, msg: "Enter a number from 0 to 50, or leave it blank." },
    reqHours:  { min: 0, max: 200, msg: "Enter hours from 0 to 200, or leave it blank." },
    staffRate: { min: 8, max: 300, msg: "Enter a dollar amount from 8 to 300, or leave it blank." },
    mgrRate:   { min: 8, max: 500, msg: "Enter a dollar amount from 8 to 500, or leave it blank." },
    moves:     { min: 0, max: 200, msg: "Enter a number from 0 to 200, or leave it blank." },
    staff:     { min: 1, max: 2000, int: true, msg: "Enter a whole number from 1 to 2,000, or leave it blank." },
    assetSw:   { min: 0, max: 200000, msg: "Enter a dollar amount, or leave it blank." },
  };

  function parse(name) {
    const f = FIELDS[name];
    const raw = form.elements[name].value.trim().replace(/[$,\s]/g, "");
    if (raw === "") return f.required ? { ok: false, empty: true } : { ok: true, value: null };
    if (!/^(\d+\.?\d*|\.\d+)$/.test(raw)) return { ok: false };
    const v = Number(raw);
    if (v < f.min || v > f.max || (f.int && !Number.isInteger(v))) return { ok: false };
    return { ok: true, value: v };
  }

  function showError(name, on) {
    const el = form.elements[name];
    const err = $("e-" + name);
    if (on) { el.setAttribute("aria-invalid", "true"); err.textContent = FIELDS[name].msg; err.hidden = false; }
    else { el.removeAttribute("aria-invalid"); err.textContent = ""; err.hidden = true; }
  }

  // step: round to this many dollars (default: $50 from $1,000, $10 from $100)
  const money = (v, step) => {
    const a = Math.abs(v);
    const st = step || (a >= 1000 ? 50 : a >= 100 ? 10 : 1);
    const r = Math.round(a / st) * st;
    return (v < 0 ? "−$" : "$") + r.toLocaleString("en-US");
  };
  const pct = (p) => {
    const x = p * 100;
    if (x < 0.1) return "under 0.1%";
    return (x < 10 ? x.toFixed(1) : String(Math.round(x))) + "%";
  };
  const hrs = (h) => (h < 10 ? h.toFixed(1) : String(Math.round(h)));
  const set = (id, text) => { $(id).textContent = text; };

  function read() {
    const inp = { method: form.elements.method.value, encrypted: form.elements.enc.value === "yes" };
    const bad = [];
    for (const name of Object.keys(FIELDS)) {
      const r = parse(name);
      if (r.ok) inp[name] = r.value; else bad.push({ name, empty: !!r.empty });
    }
    return { inp, bad };
  }

  function render() {
    const method = form.elements.method.value;
    $("f-assetSw-wrap").hidden = method !== "asset_sw";
    set("h-reqHours-range", REQ_RANGE[method]);

    const { inp, bad } = read();
    const out = $("est-out");
    if (bad.length) {
      out.classList.add("stale");
      const first = bad[0];
      set("o-status", first.empty && first.name === "devices"
        ? "Enter how many devices you have to see an estimate."
        : "Check the highlighted entry to update the estimate.");
      $("o-status").hidden = false;
      return;
    }
    out.classList.remove("stale");
    $("o-status").hidden = true;

    const r = simulate(inp);
    const s = r.saving;
    const ahead = s.mean >= 0;
    set("o-big", money(Math.abs(s.mean)) + " a year");
    set("o-sub", (ahead ? "less" : "more") + " in staff time and expected losses than " + NAMES[method] +
      ", before CustodyTap's own subscription.");
    set("o-range", "8 in 10 simulations fall between " + money(s.p10) + " and " + money(s.p90) + ".");
    const hs = r.hoursSaved;
    set("o-hours", hs >= 0
      ? "About " + hrs(hs) + " fewer staff and manager hours a year (" + hrs(r.cur.hours) + " now, " + hrs(r.ct.hours) + " with CustodyTap)."
      : "About " + hrs(-hs) + " more staff and manager hours a year.");

    set("t-cur-head", SHORT[method]);
    const m10 = (v) => money(v, 10); // one step for the whole table, so the rows add up to the total
    const rows = [["hours", hrs], ["labor", m10], ["setup", m10], ["tool", m10], ["risk", m10], ["total", m10]];
    for (const [k, f] of rows) { set("t-cur-" + k, f(r.cur[k])); set("t-ct-" + k, f(r.ct[k])); }

    set("r-cur-head", SHORT[method]);
    set("r-cur", pct(r.cur.p5));
    set("r-ct", pct(r.ct.p5));
    set("r-note", inp.encrypted
      ? "Because your laptops and portable drives are encrypted, most of this risk is already gone. What's left is mostly old drives that leave without being wiped, which is where the record helps."
      : "If every laptop and portable drive were encrypted, it would be about " + pct(r.cur.p5enc) + " with " +
        NAMES[method] + " and " + pct(r.ct.p5enc) + " with CustodyTap. Encryption lowers this risk more than any record can, and CustodyTap doesn't encrypt anything.");
  }

  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 250); };

  form.addEventListener("input", (e) => {
    const name = e.target.name;
    if (FIELDS[name] && e.target.getAttribute("aria-invalid") === "true" && parse(name).ok) showError(name, false);
    later();
  });
  form.addEventListener("change", later);
  form.addEventListener("focusout", (e) => {
    const name = e.target.name;
    if (!FIELDS[name]) return;
    const r = parse(name);
    showError(name, !r.ok);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); render(); });

  render();
})();
