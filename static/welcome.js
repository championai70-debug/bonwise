/* Landing page (/welcome): language, the words popping in, and the 3D Bonni.
   The page is complete without this script: every section has its still picture.
   The 3D (static/mascot) loads a moment after the page has drawn, only on devices that can run
   it smoothly and never with "reduce motion" or data saver (static/mascot/quality.js). */
(function () {
  "use strict";

  /* ---------- language: the same table and choice as the app ---------- */
  var I18N = window.BW_I18N || { langs: [], t: {} };
  var NAMES = { en: 1, de: 1, tr: 1, ar: 1, hi: 1 };
  function pickLang() {
    var saved = "";
    try { saved = JSON.parse(localStorage.getItem("bonwise.lang") || '""'); } catch (e) { /* private mode */ }
    if (NAMES[saved]) return saved;
    var wanted = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < wanted.length; i++) {
      var base = String(wanted[i] || "").slice(0, 2).toLowerCase();
      if (base === "ur") base = "hi";
      if (NAMES[base]) return base;
    }
    return "en";
  }
  var LANG = pickLang(), LI = I18N.langs.indexOf(LANG);
  function t(text) { var row = LI >= 0 && I18N.t[text]; return (row && row[LI]) || text; }
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
  if (LANG !== "en") {
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), node, todo = [];
    while ((node = walk.nextNode())) {
      var key = node.nodeValue.replace(/\s+/g, " ").trim();
      if (key && I18N.t[key] && !/^(SCRIPT|STYLE)$/.test(node.parentNode.nodeName)) todo.push([node, key]);
    }
    todo.forEach(function (x) {
      var m = x[0].nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
      x[0].nodeValue = m[1] + t(x[1]) + m[2];
    });
    document.querySelectorAll("[alt]").forEach(function (el) {
      var v = el.getAttribute("alt").trim();
      if (v && I18N.t[v]) el.setAttribute("alt", t(v));
    });
    document.title = t(document.title);
  }

  /* ---------- words pop in as their section arrives ---------- */
  var calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!calm && "IntersectionObserver" in window) {
    document.documentElement.classList.add("anim");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -12% 0px" });
    document.querySelectorAll(".pop").forEach(function (el) { io.observe(el); });
  }

  /* ---------- the 3D Bonni, after the page has drawn and the phone is idle ---------- */
  var src = document.body.getAttribute("data-mascot");
  if (!src || calm) return;
  function start() {
    import(src).then(function (m) {
      return m.mount({ label: t("Bonni is on the way… {pct}%") });
    }).then(function (scene) {
      window.__bonwiseMascot = scene;    // for tests: null means still pictures only
    }).catch(function () { window.__bonwiseMascot = null; /* the still pictures stay */ });
  }
  function later() {
    setTimeout(function () {
      if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 2000 });
      else start();
    }, /[?&]capture=1/.test(location.search) ? 0 : 1200);
  }
  if (document.readyState === "complete") later();
  else addEventListener("load", later);
})();
