// Shared code for the CustodyTap estimate pages (hipaa/estimate, nerc-cip/estimate).
// Runs entirely in the browser and makes no network requests. Also loads in Node for checks:
//   const C = require("./estimate-core.js");
"use strict";

(function (root) {
  // Seeded PRNG, so the same inputs always give the same estimate.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // tri([low, mode, high]) draws from a triangular distribution; logn(median, sigma) from a lognormal;
  // pick(value, range) returns value when it is set and a draw otherwise. Every call consumes the same
  // random numbers whether or not the value is set, so entering one number changes only that number.
  function sampler(seed) {
    const rand = mulberry32(seed);
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
    return { rand, tri, logn, pick };
  }

  function summary(arr) {
    const s = Float64Array.from(arr).sort();
    const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    let sum = 0; for (let i = 0; i < arr.length; i++) sum += arr[i];
    return { mean: sum / arr.length, p10: at(0.10), p50: at(0.50), p90: at(0.90) };
  }

  // step: round to this many dollars (default: $50 from $1,000, $10 from $100)
  const money = (v, step) => {
    const a = Math.abs(v);
    const st = step || (a >= 1000 ? 50 : a >= 100 ? 10 : 1);
    const r = Math.round(a / st) * st;
    return (v < 0 && r > 0 ? "−$" : "$") + r.toLocaleString("en-US");
  };
  const pct = (p) => {
    const x = p * 100;
    if (x < 0.1) return "under 0.1%";
    return (x < 10 ? x.toFixed(1) : String(Math.round(x))) + "%";
  };
  const hrs = (h) => (h < 10 ? h.toFixed(1) : String(Math.round(h)));
  const count = (n) => (n < 0.1 ? n.toFixed(2) : n < 10 ? n.toFixed(1) : String(Math.round(n)));

  // Form handling shared by both pages. FIELDS: { name: { required, min, max, int, msg } }.
  // Inputs are id="f-<name>", errors id="e-<name>"; the results panel shows id="o-status" when an entry is bad.
  function form(formEl, FIELDS) {
    const $ = (id) => document.getElementById(id);
    function parse(name) {
      const f = FIELDS[name];
      const raw = formEl.elements[name].value.trim().replace(/[$,\s]/g, "");
      if (raw === "") return f.required ? { ok: false, empty: true } : { ok: true, value: null };
      if (!/^(\d+\.?\d*|\.\d+)$/.test(raw)) return { ok: false };
      const v = Number(raw);
      if (v < f.min || v > f.max || (f.int && !Number.isInteger(v))) return { ok: false };
      return { ok: true, value: v };
    }
    function showError(name, on) {
      const el = formEl.elements[name];
      const err = $("e-" + name);
      if (on) { el.setAttribute("aria-invalid", "true"); err.textContent = FIELDS[name].msg; err.hidden = false; }
      else { el.removeAttribute("aria-invalid"); err.textContent = ""; err.hidden = true; }
    }
    function read() {
      const inp = {}, bad = [];
      for (const name of Object.keys(FIELDS)) {
        const r = parse(name);
        if (r.ok) inp[name] = r.value; else bad.push({ name, empty: !!r.empty });
      }
      return { inp, bad };
    }
    // Shows the "check the entry" state; returns true when the estimate can be drawn.
    function ready(bad, outEl, emptyMsg) {
      const status = $("o-status");
      if (bad.length) {
        outEl.classList.add("stale");
        status.textContent = bad[0].empty ? emptyMsg : "Check the highlighted entry to update the estimate.";
        status.hidden = false;
        return false;
      }
      outEl.classList.remove("stale");
      status.hidden = true;
      return true;
    }
    function listen(render) {
      let timer = 0;
      const later = () => { clearTimeout(timer); timer = setTimeout(render, 250); };
      formEl.addEventListener("input", (e) => {
        const name = e.target.name;
        if (FIELDS[name] && e.target.getAttribute("aria-invalid") === "true" && parse(name).ok) showError(name, false);
        later();
      });
      formEl.addEventListener("change", later);
      formEl.addEventListener("focusout", (e) => {
        const name = e.target.name;
        if (FIELDS[name]) showError(name, !parse(name).ok);
      });
      formEl.addEventListener("submit", (e) => { e.preventDefault(); render(); });
      render();
    }
    return { read, ready, listen };
  }

  const setText = (id, text) => { document.getElementById(id).textContent = text; };

  const api = { sampler, summary, money, pct, hrs, count, form, setText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CTEstimate = api;
})(this);
