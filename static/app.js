/* Bonwise browser app. The Python server reads the receipt (AI model on
   Hugging Face, Tesseract as backup) and works out the savings; this file
   shows the results and keeps the budget, receipts and plan in this browser. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  // Every request to the Bonwise server says which language to answer in.
  var _fetch = window.fetch.bind(window);
  function fetch(url, init) {
    if (typeof url === "string" && url.charAt(0) === "/") {
      init = Object.assign({}, init || {});
      init.headers = Object.assign({ "X-Lang": typeof LANG === "string" ? LANG : "en" }, init.headers || {});
    }
    return _fetch(url, init);
  }

  /* ---------- storage (this browser only) ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var mem = {
    budget: store.get("bonwise.budget", 300), budgetAt: store.get("bonwise.budgetAt", 0),
    receipts: store.get("bonwise.receipts", []), plan: store.get("bonwise.plan", []), list: store.get("bonwise.list", []),
    tomb: store.get("bonwise.tomb", { receipts: {}, plan: {}, list: {} }),
    settings: Object.assign({ sharePrices: true, returnDays: 14, simple: true }, store.get("bonwise.settings", {})),
    household: store.get("bonwise.household", null)
  };
  ["receipts", "plan", "list"].forEach(function (k) { if (!mem.tomb[k]) mem.tomb[k] = {}; });
  mem.receipts.forEach(function (r) { if (!r.updated) r.updated = r.at || 1; });
  mem.plan.forEach(function (x) { if (!x.updated) x.updated = 1; });
  // Save one part of the data on this phone, then share it with the household (if any).
  function persist() {
    store.set("bonwise.budget", mem.budget); store.set("bonwise.budgetAt", mem.budgetAt);
    store.set("bonwise.receipts", mem.receipts); store.set("bonwise.plan", mem.plan); store.set("bonwise.list", mem.list);
    store.set("bonwise.tomb", mem.tomb); store.set("bonwise.settings", mem.settings);
    if (typeof scheduleSync === "function") scheduleSync();
  }
  function stamp(o) { o.updated = Date.now(); return o; }

  /* ---------- languages ----------
     Texts are written in English in this file and translated with t() from static/i18n.js
     (made from i18n/strings.tsv). The page's own texts are translated once at start.
     The language follows the phone unless chosen in Settings; the server gets it as X-Lang. */
  var I18N = window.BW_I18N || { langs: [], t: {} };
  var LANG_NAMES = { en: "English", de: "Deutsch", tr: "Türkçe", ar: "العربية", hi: "हिन्दी" };
  var LOCALES = { en: "en-GB", de: "de-DE", tr: "tr-TR", ar: "ar-u-nu-latn", hi: "hi-IN" };
  function pickLang() {
    var saved = store.get("bonwise.lang", "");
    if (LANG_NAMES[saved]) return saved;
    var wanted = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < wanted.length; i++) {
      var base = String(wanted[i] || "").slice(0, 2).toLowerCase();
      if (base === "ur") base = "hi";  // Urdu speakers read the Hindi version more easily than English
      if (LANG_NAMES[base]) return base;
    }
    return "en";
  }
  var LANG = pickLang(), LI = I18N.langs.indexOf(LANG), LOCALE = LOCALES[LANG];
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
  // The text in the chosen language (English if not translated yet), with {name} parts filled in.
  function t(text, vars) {
    var row = LI >= 0 && I18N.t[text], out = (row && row[LI]) || text;
    return vars ? out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : out;
  }
  function tn(n, one, many, vars) { return t(n === 1 ? one : many, Object.assign({ n: n }, vars || {})); }
  // Words that come from the server's data (categories, product and shop kinds) when they're in the table.
  function tw(word) { return word ? t(String(word)) : ""; }
  function translatePage(root) {
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), node, todo = [];
    while ((node = walk.nextNode())) {
      var p = node.parentNode;
      if (!p || /^(SCRIPT|STYLE)$/.test(p.nodeName) || p.closest("[data-no-i18n]")) continue;
      var raw = node.nodeValue, key = raw.replace(/\s+/g, " ").trim();
      if (key && I18N.t[key]) todo.push([node, key]);
    }
    todo.forEach(function (x) {
      var m = x[0].nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
      x[0].nodeValue = m[1] + t(x[1]) + m[2];
    });
    root.querySelectorAll("[placeholder],[aria-label],[title],[alt]").forEach(function (el) {
      ["placeholder", "aria-label", "title", "alt"].forEach(function (a) {
        var v = el.getAttribute(a); if (v && I18N.t[v.trim()]) el.setAttribute(a, t(v.trim()));
      });
    });
  }
  if (LANG !== "en") translatePage(document.body);
  document.title = t(document.title);

  /* ---------- helpers ---------- */
  var MONEY = {};
  function eur(n, dec) {
    n = Number(n) || 0; dec = dec === 0 ? 0 : 2;
    if (LANG === "en") return (n < 0 ? "−" : "") + "€" + Math.abs(n).toFixed(dec);
    var f = MONEY[dec] || (MONEY[dec] = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }));
    return (n < 0 ? "−" : "") + f.format(Math.abs(n)).replace(/[\u200e\u200f\u061c]/g, "");
  }
  // Numbers in the chosen language's format (1,5 in German).
  function numTxt(x, dec) { return LANG === "en" ? x.toFixed(dec) : new Intl.NumberFormat(LOCALE, { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(x); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function r2(n) { return Math.round(n * 100) / 100; }
  // Letters of every script are kept (दूध, حليب, süt), so lists in any language work.
  function norm(s) {
    return String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^\p{L}\p{M}\p{N}.,\- ]+/gu, " ").replace(/\s+/g, " ").trim();
  }
  var now = new Date();
  var monthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var day = now.getDate();
  var monthName = now.toLocaleDateString(LOCALE, { month: "long" });
  $("monthLabel").textContent = now.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
  $("addBtn").textContent = t("Add to {month}", { month: monthName });

  function monthReceipts() { return mem.receipts.filter(function (r) { return r.month === monthKey; }); }
  function spentSaved() { return r2(monthReceipts().reduce(function (a, r) { return a + r.total; }, 0)); }

  /* ---------- current receipt ---------- */
  var cur = null;
  var marketInfo = { checked: "" };
  function itemTotal() { return r2(cur.items.reduce(function (a, it) { return a + (it.price || 0); }, 0)); }
  function itemSave() { return r2(cur.items.reduce(function (a, it) { return a + (it.save > 0 ? it.save : 0); }, 0)); }

  /* ---------- budget card ---------- */
  function renderBudget() {
    var budget = Number(mem.budget) || 0, spent = spentSaved(), pending = cur ? itemTotal() : 0;
    var after = r2(spent + pending), left = r2(budget - after);
    $("leftBig").innerHTML = (left < 0 ? t("{amount} <small>over budget</small>", { amount: eur(-left, 0) }) : t("{amount} <small>left this month</small>", { amount: eur(left, 0) }));
    $("leftBig").className = "left-big num" + (left < 0 ? " over" : "");
    var pct = function (v) { return budget > 0 ? Math.max(0, Math.min(100, v / budget * 100)) : 0; };
    $("mSpent").style.width = pct(spent) + "%";
    $("mPending").style.width = Math.max(0, Math.min(100 - pct(spent), pct(pending))) + "%";
    $("mToday").style.left = "calc(" + (day / daysInMonth * 100) + "% - 1px)";
    $("lgPending").hidden = !cur;
    $("stSpent").textContent = eur(after, 0);
    var daysLeft = daysInMonth - day + 1;
    $("stDaily").textContent = eur(left > 0 ? left / daysLeft : 0);
    var couldSave = r2(monthReceipts().reduce(function (a, r) { return a + (r.save || 0); }, 0) + (cur ? itemSave() : 0));
    $("stSaved").textContent = eur(couldSave);
    var ws = $("withSwaps"), s = cur ? itemSave() : 0;
    if (cur && s > 0) { ws.hidden = false; ws.innerHTML = t("With the swaps on this receipt you’d have <b>{amount} left</b> instead of {before}.", { amount: eur(left + s, 0), before: eur(left, 0) }); }
    else if (!cur && mem.plan.length) { var pm = r2(planPerShop() * 4.3); ws.hidden = false; ws.innerHTML = t("Your savings plan puts about <b>{amount} a month</b> back into this budget.", { amount: eur(pm, 0) }); }
    else ws.hidden = true;
    var pace = pacing(after, budget);
    var chip = $("paceChip"); chip.textContent = pace.label; chip.className = "status " + pace.cls;
    var monthSave = r2(monthReceipts().reduce(function (a, r) { return a + (r.save || 0); }, 0));
    $("heroSub").innerHTML = cur && s > 0 ? t("This receipt: you could keep <b>{amount}</b> next time.", { amount: eur(s) })
      : monthSave > 0 ? t("Bonwise found <b>{amount}</b> of savings for you in {month}.", { amount: eur(monthSave), month: esc(monthName) })
      : monthReceipts().length ? t("Nice. Every receipt you add makes prices better for everyone.")
      : t("Search or scan to start saving.");
    $("welcomeCard").hidden = mem.receipts.length > 0 || !!cur;
    $("resetBtn").hidden = monthReceipts().length === 0;
  }
  function pacing(spent, budget) {
    if (budget <= 0) return { label: t("Set a budget"), cls: "warn" };
    if (spent > budget) return { label: t("Over budget"), cls: "bad" };
    if (spent / budget > day / daysInMonth + 0.1) return { label: t("Spending fast"), cls: "warn" };
    return { label: t("On track"), cls: "good" };
  }
  $("budget").value = mem.budget;
  $("budget").addEventListener("input", function () {
    var v = Number($("budget").value);
    if (!isFinite(v) || v < 0) return;
    mem.budget = v; mem.budgetAt = Date.now(); persist(); renderBudget(); if (cur) renderRecs();
  });

  /* ---------- receipts: delete, clear month, start fresh ---------- */
  function dropReceipts(test) {
    mem.receipts = mem.receipts.filter(function (r) { if (test(r)) { mem.tomb.receipts[r.id] = Date.now(); return false; } return true; });
  }
  var wipeArmed = false;
  $("wipeBtn").addEventListener("click", function () {
    if (!wipeArmed) { wipeArmed = true; $("wipeBtn").textContent = t("Tap again: delete all receipts, the plan and the list"); setTimeout(function () { wipeArmed = false; $("wipeBtn").textContent = t("Start fresh"); }, 4000); return; }
    wipeArmed = false; $("wipeBtn").textContent = t("Start fresh");
    dropReceipts(function () { return true; });
    mem.plan.forEach(function (x) { mem.tomb.plan[x.key] = Date.now(); }); mem.plan = [];
    mem.list.forEach(function (x) { mem.tomb.list[x.id] = Date.now(); }); mem.list = [];
    persist();
    closeReceipt(); showErr(""); aiState(""); $("thumb").removeAttribute("src");
    renderAll();
  });
  var resetArmed = false;
  $("resetBtn").addEventListener("click", function () {
    if (!resetArmed) { resetArmed = true; $("resetBtn").textContent = t("Tap again to clear {month}", { month: monthName }); setTimeout(function () { resetArmed = false; $("resetBtn").textContent = t("Clear this month"); }, 3000); return; }
    dropReceipts(function (r) { return r.month === monthKey; });
    persist(); resetArmed = false; $("resetBtn").textContent = t("Clear this month");
    renderAll(); if (cur) renderRecs();
  });

  /* ---------- receipt card ---------- */
  function flagChip(it) {
    if (it.flag === "corrected") return '<span class="chip flag">' + t("OCR read {amount} — check", { amount: eur(it.ocrPrice) }) + '</span>';
    if (it.flag === "from-discount") return '<span class="chip flag">' + t("worked out: {amount} − discount", { amount: eur(it.original) }) + '</span>';
    if (it.flag === "from-total") return '<span class="chip flag">' + t("price worked out from total — check") + '</span>';
    if (it.flag === "unreadable" || it.price == null) return '<span class="chip bad">' + t("enter price") + '</span>';
    return "";
  }
  var READER = { ai: t("Read by AI"), "ai-text": t("Checked by AI"), ocr: t("Read by backup OCR"), text: t("Read from your text") };
  function renderReceipt() {
    $("receiptCard").hidden = false;
    $("rStore").textContent = cur.store || t("Receipt");
    $("rDate").textContent = cur.date || "";
    var isAi = cur.reader === "ai" || cur.reader === "ai-text";
    $("srcChip").textContent = (READER[cur.reader] || t("Read")) + (isAi && cur.model ? " · " + cur.model.split("/").pop() : "");
    $("srcChip").className = "src" + (isAi ? " ai" : "");
    $("items").innerHTML = cur.items.map(function (it, i) {
      var tip = it.tip ? '<div class="tip"><span class="arrow">↘</span><span>' + esc(it.tip) + (it.save > 0 ? ' · <b>' + t("save ~{amount}", { amount: eur(it.save) }) + '</b>' : '') + '</span></div>' : "";
      if (!it.save && it.market && it.price != null) tip = '<div class="pricecheck">✓ <span>' + goodPrice(it) + '</span></div>';
      return '<li class="item' + (it.save > 0 ? " has-save" : "") + '" data-i="' + i + '">' +
        '<div class="nm">' + esc(itemName(it)) + '<span class="chip' + (it.pfand ? " pfand" : "") + '">' + esc(tw(it.cat || "Other")) + '</span>' + flagChip(it) + '</div>' +
        '<input class="price num' + (it.price == null ? " need" : "") + '" id="price-' + i + '" type="text" inputmode="decimal" aria-label="' + esc(t("Price of {item}", { item: itemName(it) })) + '" value="' + (it.price == null ? "" : Number(it.price).toFixed(2)) + '" placeholder="0.00">' +
        '<button class="del" type="button" data-del="' + i + '" aria-label="' + esc(t("Remove item")) + '">×</button>' +
        (it.raw && norm(itemName(it)) !== norm(it.raw) ? '<div class="raw">' + esc(it.raw) + '</div>' : "") +
        (it.original != null && it.price != null && it.original > it.price ? '<div class="pricecheck">✓ <span>' + t("Discount applied: <s>{before}</s> → {after} (you saved {saved})", { before: eur(it.original), after: eur(it.price), saved: eur(it.original - it.price) }) + '</span></div>' : "") +
        tip + '</li>';
    }).join("");
    renderTotals();
  }
  // An item's name in the chosen language: the AI's local name, the English name translated,
  // or (in German) the receipt's own German text.
  function itemName(it) {
    if (it.local) return it.local;
    var en = it.en || "";
    if (LANG === "de" && it.raw && !I18N.t[en] && !I18N.t[en.replace(SIZE_END, "")]) return it.raw;
    return en ? nameWithSize(en) : (it.raw || "");
  }
  // "Pasta 500 g" -> "पास्ता 500 g": the product name translated, the pack size kept.
  var SIZE_END = /\s+\d[\d.,]*\s*(?:g|kg|ml|l|L|cl|er|x|st|pcs)\b.*$/;
  function nameWithSize(en) {
    if (I18N.t[en] || LANG === "en") return tw(en);
    var m = en.match(SIZE_END), base = m ? en.slice(0, m.index) : en;
    return I18N.t[base] ? t(base) + (m ? m[0] : "") : en;
  }
  function goodPrice(it) {
    return t("Good price.") + " " + (it.market.sport ? t("Cheapest online is from {amount} at {shop}", { amount: eur(it.market.forYours), shop: esc(it.market.store) })
      : t("{shop} charges {amount} for {size}", { shop: esc(it.market.store), amount: eur(it.market.forYours), size: esc(it.market.yourSize) }));
  }
  function renderTotals() {
    var total = itemTotal();
    $("rTotal").textContent = eur(total);
    $("rSave").textContent = eur(itemSave());
    var disc = r2(cur.items.reduce(function (a, it) { return a + (it.original != null && it.price != null && it.original > it.price ? it.original - it.price : 0); }, 0));
    $("rDiscRow").hidden = !(disc > 0); $("rDisc").textContent = eur(disc);
    var w = $("sumWarn"), missing = cur.items.filter(function (it) { return it.price == null; }).length;
    if (cur.foreign) { w.hidden = false; w.textContent = t("This receipt is in {currency}. Price checks and swaps only cover German shops in euros, so they’re off for this one.", { currency: cur.currency }); }
    else if (missing) { w.hidden = false; w.textContent = tn(missing, "1 price couldn’t be read — type it in from your receipt.", "{n} prices couldn’t be read — type them in from your receipt."); }
    else if (cur.printedTotal != null && Math.abs(cur.printedTotal - total) >= 0.01) { w.hidden = false; w.textContent = t("The items add up to {amount} but the receipt total says {total}. Check the prices above, or remove lines that aren’t products.", { amount: eur(total), total: eur(cur.printedTotal) }); }
    else w.hidden = true;
    renderBudget(); renderSavings(); renderRecs(); renderPC(); renderEco();
  }
  $("items").addEventListener("input", function (e) {
    if (!e.target.classList.contains("price")) return;
    var i = Number(e.target.closest(".item").dataset.i), it = cur.items[i];
    var v = String(e.target.value).replace(",", ".").trim();
    it.price = v === "" || !isFinite(Number(v)) ? null : r2(Number(v));
    e.target.classList.toggle("need", it.price == null);
    if (it.flag) it.flag = "edited";
    it.save = (it.altPrice != null && it.price != null) ? Math.max(0, r2(it.price - it.altPrice)) : 0;
    var tipEl = e.target.closest(".item").querySelector(".tip b");
    if (tipEl) tipEl.textContent = t("save ~{amount}", { amount: eur(it.save) });
    renderTotals();
  });
  $("items").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-del]"); if (!b) return;
    cur.items.splice(Number(b.dataset.del), 1); renderReceipt();
  });
  $("addBtn").addEventListener("click", function () {
    if (!cur) return;
    if (cur.items.some(function (it) { return it.price == null; })) { var f = document.querySelector(".price.need"); if (f) f.focus(); return; }
    var rec = stamp({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: Date.now(), month: monthKey,
      date: cur.date || now.toLocaleDateString("de-DE"), store: cur.store || t("Receipt"), total: itemTotal(), save: itemSave(),
      items: cur.items.map(function (it) { return { n: String(itemName(it)).slice(0, 60), p: it.price, c: it.cat || "Other", d: !!it.pfand }; }).slice(0, 150),
      returnDays: needsReturn({ items: cur.items.map(function (it) { return { c: it.cat }; }) }) ? mem.settings.returnDays : null
    });
    mem.receipts.push(rec);
    persist();
    reportPrices(cur);
    closeReceipt(); aiState(t("✓ Saved to {month}. Find it under Receipts.", { month: monthName }), "ok"); $("thumb").removeAttribute("src"); celebrate();
    renderAll();
  });
  $("discardBtn").addEventListener("click", function () { closeReceipt(); aiState(""); });
  $("clearBtn").addEventListener("click", function () { closeReceipt(); aiState(""); showErr(""); $("thumb").removeAttribute("src"); window.scrollTo({ top: 0, behavior: "smooth" }); });
  function closeReceipt() {
    cur = null;
    if (ctl) { ctl.abort(); ctl = null; }
    stopTimer(); setBusy(false);
    ["receiptCard", "saveCard", "swapCard", "recCard", "progress", "pcCard", "ecoCard"].forEach(function (id) { $(id).hidden = true; });
    $("pcList").innerHTML = "";
    renderBudget();
  }

  /* ---------- savings hero + swaps + plan ---------- */
  function planKey(it) { return norm(it.en || it.raw); }
  function inPlan(it) { var k = planKey(it); return mem.plan.some(function (x) { return x.key === k; }); }
  function planPerShop() { return r2(mem.plan.reduce(function (a, x) { return a + (x.save || 0); }, 0)); }
  function swapItems() {
    return cur.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (o) { return o.it.save > 0 && o.it.altPrice != null; })
      .sort(function (a, b) { return b.it.save - a.it.save; });
  }
  function renderSavings() {
    if (!cur) return;
    var total = itemTotal(), s = itemSave(), budget = Number(mem.budget) || 0, wk = budget * 7 / daysInMonth, list = swapItems();
    var hero = $("saveCard"); hero.hidden = false; hero.classList.toggle("none", !(s > 0));
    if (s > 0) {
      if (!cur.celebrated) { cur.celebrated = true; celebrate(); }
      $("svLabel").textContent = t("You could save on this shop");
      $("svBig").innerHTML = eur(s) + "<small>" + tn(list.length, "by making 1 swap next time", "by making {n} swaps next time") + "</small>";
      $("svPct").hidden = false; $("svPct").textContent = t("{pct}% less", { pct: Math.round(s / Math.max(total, 0.01) * 100) });
    } else {
      $("svLabel").textContent = t("Nice shop");
      var dsc = r2(cur.items.reduce(function (a, it) { return a + (it.original != null && it.price != null && it.original > it.price ? it.original - it.price : 0); }, 0));
      $("svBig").innerHTML = t("No cheaper swaps found") + "<small>" + (dsc > 0 ? t("You already saved {amount} with the discounts on this receipt.", { amount: eur(dsc) }) : t("These prices already look like discounter prices.")) + "</small>";
      $("svPct").hidden = true;
    }
    $("cvPaid").textContent = eur(total); $("cvSwap").textContent = eur(total - s);
    $("cbPaid").style.width = "100%"; $("cbSwap").style.width = (total > 0 ? Math.max(0, (total - s) / total * 100) : 0) + "%";
    $("cmpAfter").hidden = !(s > 0);
    $("fMonth").textContent = eur(s * 4.3, 0); $("fYear").textContent = eur(s * 52, 0);
    if (wk > 0) {
      var used = Math.round(total / wk * 100);
      $("fWeek").textContent = used + "%";
      $("fWeekTxt").textContent = s > 0 ? t("of your {amount} weekly allowance ({pct}% with swaps)", { amount: eur(wk, 0), pct: Math.round((total - s) / wk * 100) })
        : t("of your {amount} weekly allowance", { amount: eur(wk, 0) });
      $("fWeekBox").classList.toggle("warn", used > 100);
    }
    var food = cur.items.filter(function (it) { return !it.pfand && it.price != null && it.price > 0; });
    var checked = food.filter(function (it) { return it.market; }).length;
    $("coverage").innerHTML = cur.foreign ? "" : t("<b>{n} of {total}</b> items checked against real shop prices (ALDI SÜD and online shops, {date}).", { n: checked, total: food.length, date: esc(marketInfo.checked) }) + (checked < food.length ? " " + t("The rest use typical-price estimates.") : "");
    $("swapCard").hidden = !list.length;
    $("swCount").textContent = t("{n} found", { n: list.length });
    $("swaps").innerHTML = list.map(function (o) {
      var it = o.it, on = inPlan(it);
      return '<li class="swap' + (on ? " on" : "") + '"><input type="checkbox" id="sw-' + o.i + '" data-sw="' + o.i + '"' + (on ? " checked" : "") + '>' +
        '<label class="what" for="sw-' + o.i + '">' + esc(itemName(it)) + '</label><span class="amt num">−' + eur(it.save) + '</span>' +
        '<span class="how"><s>' + eur(it.price) + '</s> → <span class="to">' + (it.market && it.save ? "" : "~") + eur(it.altPrice) + '</span> · ' + esc(it.alt || t("cheaper option")) +
        (it.market && it.save ? '<span class="src-tag real">' + t("Real price") + '</span>' : '<span class="src-tag est">' + t("Estimate") + '</span>') +
        (swapChain(it) ? '<span class="near-line" data-near="' + esc(swapChain(it)) + '"></span>' : "") + '</span></li>';
    }).join("");
    renderPickTotal();
    renderSwapNear();
    autoNear();
  }

  /* ---------- where to buy the swaps: nearest branch of each shop, with directions ---------- */
  var nearShops = null, nearState = "", nearMsg = "";
  // Which shop a swap sends you to: a chain ("ALDI", "LIDL"), any discounter, any drugstore, or none (online).
  function swapChain(it) {
    var m = it.market;
    if (m && m.sport) return "";
    if (m && m.store) return /aldi/i.test(m.store) ? "ALDI" : String(m.store).toUpperCase() === "DM" ? "dm" : String(m.store).toUpperCase();
    return it.cat === "Drugstore" ? "drugstore" : "discounter";
  }
  function chainLabel(c) { return c === "discounter" ? t("a discounter") : c === "drugstore" ? t("a drugstore") : c; }
  function nearestFor(chain) {
    var list = (nearShops || []).filter(function (x) {
      return chain === "discounter" ? x.discounter : chain === "drugstore" ? x.kind === "Drugstore" : x.chain === chain;
    });
    var open = list.filter(function (x) { return x.open !== false; });
    return (open.length ? open : list).sort(function (a, b) { return a.distance - b.distance; })[0] || null;
  }
  function mapsSearch(c) {
    var q = c === "discounter" ? "Aldi Lidl Penny Netto" : c === "drugstore" ? "dm Rossmann" : c;
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }
  function renderSwapNear() {
    var box = $("swapNear"); if (!cur) { box.innerHTML = ""; return; }
    var groups = {}, order = [];
    swapItems().forEach(function (o) {
      var c = swapChain(o.it); if (!c) return;
      if (!groups[c]) { groups[c] = { items: [], save: 0 }; order.push(c); }
      groups[c].items.push(itemName(o.it)); groups[c].save = r2(groups[c].save + o.it.save);
    });
    box.hidden = !order.length;
    if (!order.length) return;
    order.sort(function (a, b) { return groups[b].save - groups[a].save; });
    var pin = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="stroke:var(--accent);fill:none;stroke-width:2"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
    var html = '<h3>' + pin + t("Where to buy these near you") + '</h3>';
    if (!nearShops) {
      html += nearState === "loading" ? '<div class="trip-load"><span class="spin" aria-hidden="true"></span><span>' + t("Finding the nearest shops…") + '</span></div>'
        : '<div class="near-go"><button class="btn small" type="button" id="nearBtn">' + t("Show the nearest shops") + '</button><span class="muted" style="margin:0">' +
          esc(order.map(chainLabel).join(", ")) + '</span></div>' +
          (nearState === "error" ? '<p class="notice warn">' + esc(nearMsg) + '</p>' : '<p class="muted">' + t("Uses your location once, rounded to about 100 m.") + '</p>');
    } else {
      html += '<ul class="near-list">' + order.map(function (c) {
        var x = nearestFor(c), g = groups[c];
        var forWhat = t(g.items.length > 3 ? "for {items} and more · save <b>{amount}</b>" : "for {items} · save <b>{amount}</b>", { items: esc(listText(g.items.slice(0, 3))), amount: eur(g.save) });
        if (!x) return '<li><div class="nh"><span class="av" style="background:var(--ink-3)">?</span><div><span class="nm">' + t("No {shop} within 1.5 km", { shop: esc(chainLabel(c)) }) + '</span></div></div>' +
          '<span class="sub">' + forWhat + '</span><a class="btn small line" href="' + mapsSearch(c) + '" target="_blank" rel="noopener">' + t("Find on map") + '</a></li>';
        var meta = [distTxt(x.distance), openTxt(x), x.address].filter(Boolean).join(" · ");
        return '<li><div class="nh">' + avatar(shopName(x)) + '<div><span class="nm">' + esc(shopName(x)) + '</span><span class="meta">' + esc(meta) + '</span></div></div>' +
          '<span class="sub">' + forWhat + '</span><a class="btn small" href="' + mapsLink(x) + '" target="_blank" rel="noopener">' + t("Directions") + '</a></li>';
      }).join("") + '</ul>';
    }
    box.innerHTML = html;
    // A short "nearest" line on each swap too.
    document.querySelectorAll("#swaps [data-near]").forEach(function (el) {
      var x = nearShops && nearestFor(el.dataset.near);
      el.innerHTML = x ? '📍 ' + esc(shopName(x)) + ' · ' + distTxt(x.distance) + ' · <a href="' + mapsLink(x) + '" target="_blank" rel="noopener">' + t("Directions") + '</a>' : "";
    });
  }
  function loadNear() {
    if (nearState === "loading") return;
    nearState = "loading"; renderSwapNear();
    locate().then(function (loc) {
      if (!loc.pos) throw { message: loc.why };
      var d = new Date(), body = { lat: round3(loc.pos.coords.latitude), lon: round3(loc.pos.coords.longitude), dow: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes() };
      return osmShops(body.lat, body.lon).then(function (osm) { if (osm) body.osm = osm; return api("/api/shops", body); });
    }).then(function (j) { nearShops = j.shops || []; nearState = "done"; renderSwapNear(); },
      function (e) { nearState = "error"; nearMsg = (e && e.message) || t("The nearest shops couldn’t be found. Try again."); renderSwapNear(); });
  }
  // If the phone already allows location for Bonwise, show the shops without asking.
  function autoNear() {
    if (nearShops || nearState || !swapItems().length) return;
    try {
      navigator.permissions.query({ name: "geolocation" }).then(function (p) { if (p.state === "granted") loadNear(); }, function () {});
    } catch (e) {}
  }
  $("swapNear").addEventListener("click", function (e) { if (e.target.closest("#nearBtn")) loadNear(); });
  function renderPickTotal() {
    var picked = swapItems().filter(function (o) { return inPlan(o.it); });
    var sum = r2(picked.reduce(function (a, o) { return a + o.it.save; }, 0));
    $("planHint").textContent = picked.length ? tn(picked.length, "1 swap added to your plan", "{n} swaps added to your plan") : t("Tick the swaps you’ll make next time");
    $("planPick").textContent = t("{amount} / month", { amount: eur(sum * 4.3, 0) });
  }
  $("swaps").addEventListener("click", function (e) {
    var li = e.target.closest(".swap"); if (!li || e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
    var cb = li.querySelector("input"); cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
  $("swaps").addEventListener("change", function (e) {
    var cb = e.target; if (!cb.dataset || cb.dataset.sw == null) return;
    var it = cur.items[Number(cb.dataset.sw)], k = planKey(it);
    mem.plan = mem.plan.filter(function (x) { return x.key !== k; });
    if (cb.checked) { mem.plan.push(stamp({ key: k, name: itemName(it), from: it.price, altPrice: it.altPrice, alt: it.alt || t("cheaper option"), save: it.save })); delete mem.tomb.plan[k]; }
    else mem.tomb.plan[k] = Date.now();
    persist();
    cb.closest(".swap").classList.toggle("on", cb.checked);
    renderPickTotal(); renderPlan(); renderBudget();
  });
  function renderPlan() {
    $("planCard").hidden = !mem.plan.length;
    $("planList").innerHTML = mem.plan.map(function (x, i) {
      return '<li><span>' + esc(x.name) + '<span class="sub">' + esc(x.alt) + ' · ' + t("~{amount} instead of {before}", { amount: eur(x.altPrice), before: eur(x.from) }) + '</span></span><span class="amt">−' + eur(x.save) + '</span><button class="del" type="button" data-plan="' + i + '" aria-label="' + esc(t("Remove from plan")) + '">×</button></li>';
    }).join("");
    var per = planPerShop();
    $("planSum").textContent = t("Saves about {amount} per shop", { amount: eur(per) });
    $("planMonth").textContent = t("{amount} / month", { amount: eur(per * 4.3, 0) });
  }
  $("planList").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-plan]"); if (!b) return;
    var gone = mem.plan.splice(Number(b.dataset.plan), 1)[0]; if (gone) mem.tomb.plan[gone.key] = Date.now(); persist();
    renderPlan(); renderBudget(); if (cur) renderSavings();
  });

  /* ---------- recommendations ---------- */
  function renderRecs() {
    if (!cur) return;
    $("recCard").hidden = false;
    var budget = Number(mem.budget) || 0, spent = spentSaved(), total = itemTotal(), s = itemSave(), after = r2(spent + total);
    var out = [], pace = pacing(after, budget);
    var usedPct = budget ? Math.round(after / budget * 100) : 0, timePct = Math.round(day / daysInMonth * 100);
    out.push({ cls: pace.cls, ic: pace.cls === "good" ? "✓" : "!", html: t("With this receipt you’ve used <strong>{amount}</strong> of your {budget} budget ({pct}%), and {time}% of {month} has passed.", { amount: eur(after), budget: eur(budget, 0), pct: usedPct, time: timePct, month: monthName }) });
    var weekly = r2(total * 4.3), wgap = r2(weekly - budget);
    out.push({ cls: wgap > 0 ? "bad" : "good", ic: "→", html: t(wgap > 0 ? "If you shop like this every week, that’s about <strong>{amount} a month</strong> — <strong>{gap} over</strong> your budget." : "If you shop like this every week, that’s about <strong>{amount} a month</strong> — {gap} under your budget.", { amount: eur(weekly, 0), gap: eur(Math.abs(wgap), 0) }) });
    var first = monthReceipts().reduce(function (m, r) { return Math.min(m, new Date(r.at).getDate()); }, day);
    if (first <= 5 && day >= 7 && after > 0) {
      var proj = r2(after / day * daysInMonth), gap = r2(proj - budget);
      out.push({ cls: gap > 0 ? "bad" : "good", ic: "≈", html: t(gap > 0 ? "At your pace so far you’ll spend about <strong>{amount}</strong> by the end of {month} — <strong>{gap} over</strong> budget." : "At your pace so far you’ll spend about <strong>{amount}</strong> by the end of {month} — {gap} under budget.", { amount: eur(proj, 0), month: monthName, gap: eur(Math.abs(gap), 0) }) });
    }
    var wk = r2(budget * 7 / daysInMonth);
    if (budget > 0) out.push({ cls: total > wk ? "bad" : (total > wk * 0.8 ? "warn" : "good"), ic: "7", html: t(s > 0 ? "Your weekly allowance is about <strong>{amount}</strong>. This shop used <strong>{pct}%</strong> of it — {swapPct}% with the swaps." : "Your weekly allowance is about <strong>{amount}</strong>. This shop used <strong>{pct}%</strong> of it.", { amount: eur(wk, 0), pct: Math.round(total / wk * 100), swapPct: Math.round((total - s) / wk * 100) }) });
    var left = r2(budget - after), daysLeft = daysInMonth - day + 1;
    if (left > 0) out.push({ cls: "", ic: "÷", html: t("To stay within budget you can spend about <strong>{amount} a day</strong> ({week} a week) for the rest of {month}.", { amount: eur(left / daysLeft), week: eur(left / daysLeft * 7, 0), month: monthName }) });
    else out.push({ cls: "bad", ic: "!", html: t("You’re {amount} over this month’s budget. Swapping to store brands and shopping at Aldi or Lidl for staples is the quickest way to cut back.", { amount: eur(-left) }) });
    $("recs").innerHTML = out.map(function (r) { return '<li class="rec ' + r.cls + '"><span class="ic">' + r.ic + '</span><p>' + r.html + '</p></li>'; }).join("");
  }

  /* ---------- talking to the server ---------- */
  var ctl = null, tick = null, pendingPayload = null, health = null;
  function showErr(msg) { $("scanErr").hidden = !msg; $("scanErr").textContent = msg || ""; }
  function aiState(msg, kind) { var s = $("aiStatus"); s.hidden = !msg; s.className = "notice " + (kind === "fail" ? "warn" : "ok"); s.textContent = msg || ""; }
  function setStage(stage, sub, p) {
    $("progress").hidden = false; $("stage").textContent = stage;
    if (sub != null) $("stageSub").textContent = sub;
    if (p != null) $("pbar").style.width = Math.round(p * 100) + "%";
  }
  function context() { return { budget: Number(mem.budget) || 0, spent: spentSaved(), day: day, daysInMonth: daysInMonth }; }
  function startTimer(useAi) {
    var t0 = Date.now(); stopTimer();
    tick = setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000);
      $("pbar").style.width = Math.min(92, 20 + s * (useAi ? 1.4 : 6)) + "%";
      $("stageSub").textContent = (useAi ? t("The AI model is reading every line… {s} s", { s: s }) : t("Reading the text… {s} s", { s: s })) + (useAi && s >= 15 ? " · " + t("the first scan can take up to a minute") : "");
      $("skipAi").hidden = !useAi || s < 10;
    }, 1000);
  }
  function stopTimer() { if (tick) { clearInterval(tick); tick = null; } $("skipAi").hidden = true; }
  function setBusy(b) { $("pickBtn").disabled = $("sampleBtn").disabled = $("pasteGo").disabled = b; }

  function post(path, payload) {
    ctl = new AbortController();
    var mine = ctl, late = false;
    var timer = setTimeout(function () { late = true; mine.abort(); }, 150000);
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: mine.signal })
      .then(function (r) {
        if (!ours(r)) throw { code: "waking", message: WAKING };
        return r.json().catch(function () { return { error: "server", message: t("The server sent an answer that couldn’t be read (HTTP {status}).", { status: r.status }) }; })
          .then(function (j) { if (!r.ok || j.error) throw { code: j.error || "server", message: j.message || ("HTTP " + r.status) }; return j; });
      }, function (e) {
        if (e && e.name === "AbortError" && !late) throw e;
        throw { code: late ? "timeout" : "network", message: late ? t("The server took too long. Try again, or use the quick reader.") : t("The Bonwise server couldn’t be reached. Check your connection and try again.") };
      })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  function run(path, payload, label) {
    pendingPayload = { path: path, payload: payload };
    $("tripCard").hidden = true;  // focus on the receipt being read
    setBusy(true);
    setStage(label, "", 0.2);
    startTimer(payload.useAi !== false && health && health.aiReader);
    return post(path, payload).then(function (res) {
      stopTimer(); setBusy(false);
      buildReceipt(res.receipt);
      var gap = cur.printedTotal != null ? r2(itemTotal() - cur.printedTotal) : 0;
      if (Math.abs(gap) >= 0.01) aiState(t("Check this receipt: the prices read add up to {amount}, but the receipt total is {total}. Compare the prices below with your receipt and correct the wrong line (tap a price to edit it).", { amount: eur(itemTotal()), total: eur(cur.printedTotal) }) + (res.notice ? " " + res.notice : ""), "fail");
      else if (res.notice) aiState(res.notice, "fail");
      else if (res.receipt.reader === "ai" || res.receipt.reader === "ai-text") aiState(t("✓ Read by {model} in {s} s.", { model: String(res.receipt.model).split("/").pop(), s: res.receipt.seconds }), "ok");
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      stopTimer(); setBusy(false);
      $("progress").hidden = true;
      showErr((e && e.message) || t("Something went wrong. Try again."));
      if (e && (e.code === "ocr_failed" || e.code === "no_items")) $("pasteBox").hidden = false;
    });
  }

  function buildReceipt(r) {
    showErr("");
    cur = { store: r.store, date: r.date, printedTotal: r.total, reader: r.reader, model: r.model || "", foreign: !!r.foreign, currency: r.currency, items: r.items };
    $("progress").hidden = true;
    renderReceipt();
    var tips = (r.tips || []).filter(Boolean).slice(0, 3);
    $("aiLabel").textContent = t("AI tips for this shop");
    $("aiTips").innerHTML = tips.map(function (tip) { return "<li>" + esc(String(tip).slice(0, 300)) + "</li>"; }).join("");
    $("aiBox").hidden = !tips.length;
    $("saveCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Shrink the photo in the browser before upload (faster, cheaper for the AI).
  function toJpeg(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", 0.88).split(",")[1]);
      };
      img.onerror = function () { rej(new Error("image")); };
      img.src = url;
    });
  }

  function scanImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { showErr(t("That isn’t an image. Choose a JPEG or PNG photo of the receipt.")); return; }
    // A new receipt replaces the last one: clear results, messages and the price search.
    closeReceipt(); showErr(""); aiState("");
    showTab("home", true);
    $("thumb").src = URL.createObjectURL(file);
    $("scanCard").hidden = false; $("scanCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setBusy(true);
    toJpeg(file).then(function (b64) {
      return run("/api/scan", { image: b64, mediaType: "image/jpeg", context: context() }, t("Reading your receipt…"));
    }).catch(function () { setBusy(false); showErr(t("That photo couldn’t be opened. Try a JPEG or PNG.")); });
  }

  $("skipAi").addEventListener("click", function () {
    if (!pendingPayload) return;
    if (ctl) ctl.abort();
    var p = Object.assign({}, pendingPayload.payload, { useAi: false });
    run(pendingPayload.path, p, t("Reading with the quick reader…"));
  });
  $("pickBtn").addEventListener("click", function () { $("file").click(); });
  $("file").addEventListener("change", function () { scanImage($("file").files[0]); $("file").value = ""; });
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); }); });
  drop.addEventListener("drop", function (e) { scanImage(e.dataTransfer.files && e.dataTransfer.files[0]); });
  $("sampleBtn").addEventListener("click", function () {
    fetch("/static/sample-receipt.jpg").then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) { scanImage(new File([b], "sample-receipt.jpg", { type: "image/jpeg" })); })
      .catch(function () { showErr(t("The sample receipt couldn’t be loaded.")); });
  });
  $("pasteToggle").addEventListener("click", function () {
    $("pasteBox").hidden = !$("pasteBox").hidden; syncScanCard();
    if (!$("pasteBox").hidden) { $("scanCard").scrollIntoView({ behavior: "smooth", block: "start" }); $("pasteText").focus(); }
  });
  $("pasteGo").addEventListener("click", function () {
    var lines = $("pasteText").value.trim();
    if (!lines) { showErr(t("Paste or type a few lines from the receipt first, e.g. “Butter 250g 2,29”.")); return; }
    closeReceipt(); showErr(""); aiState(""); $("thumb").removeAttribute("src");
    run("/api/scan-text", { text: lines, context: context() }, t("Reading your lines…"));
  });

  /* ---------- reader status ---------- */
  function showReader() {
    var pill = $("readerPill"), note = $("readerNote");
    if (!health) { pill.textContent = t("Server offline"); pill.className = "pill"; note.textContent = t("The Bonwise server isn’t answering. Reload the page in a moment."); return; }
    if (health.aiReader) {
      pill.textContent = t("AI reader"); pill.className = "pill ai";
      note.textContent = t("Open-source model {model} on Hugging Face reads any language.", { model: health.models[0].split("/").pop() });
    } else {
      pill.textContent = t("Backup reader"); pill.className = "pill";
      note.textContent = t("The AI isn’t switched on for this server yet, so receipts are read with Tesseract OCR.");
    }
  }
  /* The page opens from this phone's copy (sw.js) even while the free server is still
     waking up (up to about a minute). Ask until the server answers; after a short wait a
     small "Connecting…" note shows, instead of the host's own "starting" page. */
  var WAKING = t("Bonwise is waking up. Try again in a few seconds.");
  function ours(r) { return r.headers.get("X-Bonwise") === "1"; }
  function loadHealth(tries) {
    var slow = setTimeout(function () { $("wakeNote").hidden = false; }, 2500);
    fetch("/api/health").then(function (r) { if (!ours(r)) throw 0; return r.json(); }).then(function (h) {
      clearTimeout(slow); $("wakeNote").hidden = true;
      health = h; showReader();
      if (h.contact) $("feedbackLink").href = "mailto:" + h.contact + "?subject=" + encodeURIComponent("Bonwise feedback");
      else $("feedbackLink").hidden = true;
      if (tries) syncNow();
    }).catch(function () {
      clearTimeout(slow);
      if (tries < 30 && navigator.onLine !== false) { $("wakeNote").hidden = false; setTimeout(function () { loadHealth(tries + 1); }, 3000); }
      else { $("wakeNote").hidden = true; if (!health) showReader(); }
    });
  }
  loadHealth(0);
  window.addEventListener("online", function () { if (!health) loadHealth(0); });

  /* ---------- climate footprint (Poore & Nemecek 2018, global averages per kg) ---------- */
  var ECO_SRC = t("Estimates from Poore & Nemecek (2018, Science), the largest study of food’s climate impact, via Our World in Data: global averages per kg, farm to shop. Items the study doesn’t cover (like butter, bread or non-food) have no number.");
  function kgNum(x) { return x >= 10 ? String(Math.round(x)) : numTxt(x, 1); }
  function kgTxt(x) { return t("~{kg} kg CO₂e", { kg: kgNum(x) }); }
  // One small label for an item: its footprint, and a greener swap when the study has one.
  function ecoChips(c) {
    if (!c) return "";
    var main = c.kg != null ? kgTxt(c.kg) : t("~{kg} kg CO₂e per kg", { kg: kgNum(c.perKg) });
    var h = '<span class="eco-chip ' + c.level + '" title="' + esc(t("Climate footprint, estimate")) + '">🌱 ' + main + '</span>';
    if (c.swap) h += '<span class="eco-chip sw">' + t("{food}: {pct}% less CO₂", { food: esc(tw(c.swap.name)), pct: c.swap.pct }) + "</span>";
    return h;
  }
  function renderEco() {
    // Worked out from the items (not the scan's summary), so edited or removed lines count right.
    var card = $("ecoCard");
    var list = cur ? cur.items.filter(function (it) { return it.co2 && it.co2.kg != null; }) : [];
    card.hidden = !list.length;
    if (card.hidden) { $("ecoList").innerHTML = ""; return; }
    var top = list.reduce(function (a, it) { return it.co2.kg > a.co2.kg ? it : a; });
    var sum = { kg: list.reduce(function (a, it) { return a + it.co2.kg; }, 0), top: itemName(top), topKg: top.co2.kg,
      swapSave: list.reduce(function (a, it) { return a + (it.co2.swap && it.co2.swap.save > 0 ? it.co2.swap.save : 0); }, 0) };
    $("ecoKg").textContent = kgTxt(sum.kg);
    $("ecoOf").textContent = tn(list.length, "for 1 food item on this receipt. Biggest: {top} ({pct}%).", "for {n} food items on this receipt. Biggest: {top} ({pct}%).", { top: sum.top || "", pct: Math.round(sum.topKg / sum.kg * 100) });
    var sw = $("ecoSwap");
    sw.hidden = !(sum.swapSave > 0.05);
    if (!sw.hidden) sw.textContent = "🌱 " + t("Greener swaps could cut about {kg} kg CO₂e ({pct}%). Tap “Show each item” to see them.", { kg: kgNum(sum.swapSave), pct: Math.round(sum.swapSave / sum.kg * 100) });
    var max = Math.max.apply(null, list.map(function (it) { return it.co2.kg; }));
    list = list.slice().sort(function (a, b) { return b.co2.kg - a.co2.kg; });
    $("ecoList").innerHTML = list.map(function (it) {
      var c = it.co2;
      return '<li class="' + c.level + '"><span class="nm">' + esc(itemName(it)) + '</span><span class="kg">' + kgTxt(c.kg) + '</span>' +
        '<span class="bar"><i style="width:' + Math.max(3, Math.round(c.kg / max * 100)) + '%"></i></span>' +
        (c.swap && c.swap.kg != null ? '<span class="sw">' + t("{food} instead: {kg} ({pct}% less)", { food: esc(tw(c.swap.name)), kg: kgTxt(c.swap.kg), pct: c.swap.pct }) + "</span>" : "") + '</li>';
    }).join("");
    $("ecoNote").textContent = ECO_SRC;
  }
  $("ecoMore").addEventListener("click", function () {
    var open = $("ecoList").hidden;
    $("ecoList").hidden = !open;
    this.setAttribute("aria-expanded", String(open));
    this.textContent = open ? t("Hide items") : t("Show each item");
  });

  /* ---------- price check: the items on the current receipt ---------- */
  function renderPC() {
    var card = $("pcCard");
    if (!cur) { card.hidden = true; $("pcList").innerHTML = ""; return; }
    var list = cur.items.filter(function (it) { return !it.pfand && it.price != null && it.price > 0; });
    card.hidden = !list.length;
    // Biggest savings first, then items with a known good price, then the rest.
    var rank = function (it) { return it.save > 0 ? 3 : it.market ? 2 : (it.original != null && it.original > it.price) ? 1 : 0; };
    list = list.slice().sort(function (a, b) { return rank(b) - rank(a) || (b.save || 0) - (a.save || 0); });
    $("pcCount").textContent = tn(list.length, "1 item", "{n} items");
    $("pcList").innerHTML = list.map(function (it) {
      var name = esc(itemName(it)), amt = "", how;
      if (it.save > 0 && it.altPrice != null) {
        var real = !!(it.market && it.save);
        amt = '−' + eur(it.save) + ' <small style="font-size:13px">(' + Math.round(it.save / it.price * 100) + '%)</small>';
        how = '<s>' + eur(it.price) + '</s> → <span class="to">' + (real ? "" : "~") + eur(it.altPrice) + '</span> · ' + esc(it.alt || t("cheaper option")) +
          '<span class="src-tag ' + (real ? 'real">' + t("Real price") : 'est">' + t("Estimate")) + '</span>';
      } else if (it.market) {
        how = '✓ ' + t("Good price: {amount}.", { amount: eur(it.price) }) + ' ' + (it.market.sport ? t("Cheapest online is from {amount} at {shop}", { amount: eur(it.market.forYours), shop: esc(it.market.store) })
          : t("{shop} charges {amount} for {size}", { shop: esc(it.market.store), amount: eur(it.market.forYours), size: esc(it.market.yourSize) })) + '<span class="src-tag real">' + t("Real price") + '</span>';
      } else if (it.original != null && it.original > it.price) {
        how = '✓ ' + t("Already discounted: <s>{before}</s> → {after} ({pct}% off)", { before: eur(it.original), after: eur(it.price), pct: Math.round((1 - it.price / it.original) * 100) });
      } else {
        how = t("Paid {amount}. No comparison price for this item yet.", { amount: eur(it.price) });
      }
      return '<li class="pc"><span class="nm">' + name + '</span><span class="amt num">' + amt + '</span><span class="how">' + how + '</span></li>';
    }).join("");
    $("pcNote").textContent = t("Real prices: ALDI SÜD shelf prices and sneaker offers on günstiger.de / billiger.de, checked {date}. Estimates are typical discounter prices.", { date: marketInfo.checked || "23 Sep 2026" });
  }
  fetch("/api/prices").then(function (r) { if (!ours(r)) throw 0; return r.json(); }).then(function (p) { marketInfo = p.market; }).catch(function () {});


  /* =====================================================================
     Phase 1: tabs, receipt vault, reminders, shopping list, shops, household
     ===================================================================== */
  function api(path, body) {
    return fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        if (!ours(r)) throw { status: 503, code: "waking", message: WAKING };
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.error) throw { status: r.status, code: j.error || "server", message: j.message || t("The server didn’t answer. Try again.") };
          return j;
        });
      }, function () { throw { code: "network", message: t("No connection to the Bonwise server. Check your internet and try again.") }; });
  }

  /* ---------- tabs ---------- */
  /* One screen: greeting, search and four big buttons stay on top; the part below
     shows home (results), the list, shops, receipts or settings. Searching or scanning
     switches back to home by itself. */
  var TABS = ["home", "receipts", "list", "shops", "more"], curTab = "home";
  function showTab(name, quiet) {
    if (TABS.indexOf(name) < 0) name = "home";
    var changed = name !== curTab; curTab = name;
    TABS.forEach(function (tab) { $("view-" + tab).hidden = tab !== name; });
    document.querySelectorAll(".tile[data-tab], .icon-btn[data-tab]").forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (name === "list") refreshListPrices();
    if (!quiet && changed) {
      if (name === "home") window.scrollTo({ top: 0, behavior: "smooth" });
      else $("view-" + name).scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try { history.replaceState(null, "", name === "home" ? location.pathname + location.search : "#" + name); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]"); if (!b) return;
    // Tapping the open section's button again closes it.
    showTab(b.dataset.tab === curTab && b.classList.contains("tile") ? "home" : b.dataset.tab);
  });
  $("tileScan").addEventListener("click", function () { showTab("home", true); $("file").click(); });

  // The receipt card appears only while something is happening in it.
  function syncScanCard() {
    $("scanCard").hidden = $("progress").hidden && $("scanErr").hidden && $("aiStatus").hidden && $("pasteBox").hidden;
  }
  if (window.MutationObserver) {
    var mo = new MutationObserver(syncScanCard);
    ["progress", "scanErr", "aiStatus", "pasteBox"].forEach(function (id) { mo.observe($(id), { attributes: true, attributeFilter: ["hidden"] }); });
  }

  /* ---------- a warm welcome ---------- */
  function greet() {
    var h = new Date().getHours();
    $("hello").textContent = t(h < 5 ? "Hello, night owl" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }
  greet();
  // A short burst of confetti when Bonwise finds money for you.
  function celebrate() {
    try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    var box = document.createElement("div"), colors = ["#0E7A52", "#FFD166", "#E4573D", "#3A6FD8", "#F58E3B", "#48B87A"];
    box.className = "confetti"; box.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 36; i++) {
      var c = document.createElement("i");
      c.style.left = Math.random() * 100 + "%"; c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.35 + "s"; c.style.animationDuration = 1.2 + Math.random() * 0.8 + "s";
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 2600);
  }
  var AV_COLORS = ["#0E7A52", "#3A6FD8", "#D9642B", "#7A55C7", "#C0392B", "#1F8A9E", "#8A6D1F"];
  function avatar(name) {
    var n = String(name || "?").trim(), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
    return '<span class="av" aria-hidden="true" style="background:' + AV_COLORS[h % AV_COLORS.length] + '">' + esc(n.charAt(0).toUpperCase()) + '</span>';
  }

  /* ---------- dates ---------- */
  var DAY = 86400000;
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function purchaseDate(r) {
    var m = String(r.date || "").match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
    if (m) { var y = Number(m[3]); if (y < 100) y += 2000; var d = new Date(y, Number(m[2]) - 1, Number(m[1])); if (!isNaN(d)) return d; }
    var a = new Date(r.at || Date.now()); a.setHours(0, 0, 0, 0); return a;
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysUntil(d) { return Math.round((d - today0()) / DAY); }
  function fmtDay(d) { var o = { day: "numeric", month: "short" }; if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return d.toLocaleDateString(LOCALE, o); }
  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
  function isoDay(dateStr) { var d = purchaseDate({ date: dateStr, at: Date.now() }); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function inDays(n) { return n === 0 ? t("today") : n === 1 ? t("tomorrow") : t("in {n} days", { n: n }); }

  /* ---------- returns & warranty ---------- */
  var RETURN_CATS = ["Clothing & shoes", "Electronics", "Household"];
  function needsReturn(r) { return (r.items || []).some(function (it) { return RETURN_CATS.indexOf(it.c) >= 0; }); }
  function returnBy(r) { return r.returnDays != null && needsReturn(r) ? addDays(purchaseDate(r), Number(r.returnDays)) : null; }
  function warrantyUntil(r) { return needsReturn(r) ? addDays(purchaseDate(r), 730) : null; }  // 2-year legal warranty (Gewährleistung)
  function calLink(title, d, details) {
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) +
      "&dates=" + ymd(d) + "/" + ymd(addDays(d, 1)) + "&details=" + encodeURIComponent(details);
  }
  function reminders() {
    var out = [];
    mem.receipts.forEach(function (r) {
      var rb = returnBy(r), wu = warrantyUntil(r);
      if (rb) { var n = daysUntil(rb); if (n >= 0 && n <= 7) out.push({ r: r, kind: "return", d: rb, n: n }); }
      if (wu) { var w = daysUntil(wu); if (w >= 0 && w <= 30) out.push({ r: r, kind: "warranty", d: wu, n: w }); }
    });
    return out.sort(function (a, b) { return a.n - b.n; });
  }
  function renderReminders() {
    var list = reminders(), urgent = list.filter(function (x) { return x.kind === "return"; }).length;
    $("remindCard").hidden = !list.length;
    $("remDot").hidden = !urgent; $("remDot").textContent = urgent;
    $("remindList").innerHTML = list.map(function (x) {
      var what = t(x.kind === "return" ? "Return window ends {when}" : "Warranty ends {when}", { when: inDays(x.n) });
      var title = t(x.kind === "return" ? "Last day to return: {shop}" : "Warranty ends: {shop}", { shop: x.r.store || t("receipt") });
      return '<li class="' + (x.kind === "return" ? "" : "soft") + '"><span class="ic">' + (x.kind === "return" ? "↩" : "🛡") + '</span>' +
        '<b>' + esc(what) + '</b><span>' + esc(x.r.store || t("Receipt")) + ' · ' + esc(t("bought {date}", { date: fmtDay(purchaseDate(x.r)) })) + ' · ' + eur(x.r.total) +
        ' · <a href="' + calLink(title, x.d, t("Bonwise reminder for your receipt from {shop} ({date}).", { shop: x.r.store || "", date: x.r.date || "" })) + '" target="_blank" rel="noopener">' + t("Add to calendar") + '</a></span></li>';
    }).join("");
  }

  /* ---------- receipt vault ---------- */
  var openReceipt = null, delArmed = null;
  function renderVault() {
    var list = mem.receipts.slice().sort(function (a, b) { return purchaseDate(b) - purchaseDate(a) || b.at - a.at; });
    $("histEmpty").hidden = list.length > 0;
    $("resetBtn").hidden = monthReceipts().length === 0;
    var html = "", lastMonth = "";
    list.forEach(function (r) {
      var mk = r.month || "";
      if (mk !== lastMonth) {
        lastMonth = mk;
        var tot = r2(list.filter(function (x) { return x.month === mk; }).reduce(function (a, x) { return a + x.total; }, 0));
        var label = mk ? new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1).toLocaleDateString(LOCALE, { month: "long", year: "numeric" }) : t("Earlier");
        html += '<li class="mhead"><span>' + esc(label) + '</span><span>' + eur(tot) + '</span></li>';
      }
      var rb = returnBy(r), wu = warrantyUntil(r), tags = [];
      if (r.save > 0) tags.push('<span class="pill2">' + t("Could have saved {amount}", { amount: eur(r.save) }) + '</span>');
      if (rb) {
        var n = daysUntil(rb);
        tags.push(n < 0 ? '<span class="pill2 grey">' + esc(t("Return window ended {date}", { date: fmtDay(rb) })) + '</span>'
          : '<span class="pill2 warn">' + esc(t("Return by {date} ({when})", { date: fmtDay(rb), when: inDays(n) })) + '</span> <a class="muted" href="' + calLink(t("Last day to return: {shop}", { shop: r.store || t("receipt") }), rb, t("Bonwise reminder")) + '" target="_blank" rel="noopener">' + t("Add to calendar") + '</a>');
      }
      if (wu) tags.push('<span class="pill2 grey">' + esc(t("Warranty until {date}", { date: fmtDay(wu) })) + '</span>');
      var lines = (r.items && r.items.length) ? '<ul class="lines">' + r.items.map(function (it) {
        return '<li><span>' + esc(it.n) + '</span><span class="num">' + (it.p == null ? "–" : eur(it.p)) + '</span></li>';
      }).join("") + '</ul>' : '<p class="muted">' + t("Items weren’t saved for this receipt (it was added before this update).") + '</p>';
      var retEdit = needsReturn(r) ? '<label class="row2 muted">' + t("Return window") + ' <input class="field" type="number" min="0" max="365" data-ret="' + esc(r.id) + '" value="' + (r.returnDays == null ? "" : r.returnDays) + '" style="max-width:90px;padding:6px 8px"> ' + t("days") + '</label>' : "";
      html += '<li><details data-id="' + esc(r.id) + '"' + (openReceipt === r.id ? " open" : "") + '><summary><span class="d">' + esc(r.date || "") + '</span><span class="s">' + esc(r.store || t("Receipt")) + '</span><span class="num">' + eur(r.total) + '</span></summary>' +
        '<div class="body">' + lines + (tags.length ? '<div class="tags">' + tags.join(" ") + '</div>' : "") + retEdit +
        '<div><button class="linkbtn" type="button" data-del-r="' + esc(r.id) + '" style="color:var(--bad)">' + (delArmed === r.id ? t("Tap again to delete") : t("Delete receipt")) + '</button></div></div></details></li>';
    });
    $("hist").innerHTML = html;
  }
  $("hist").addEventListener("toggle", function (e) { if (e.target.open) openReceipt = e.target.dataset.id; else if (openReceipt === e.target.dataset.id) openReceipt = null; }, true);
  $("hist").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-del-r]"); if (!b) return;
    var id = b.dataset.delR;
    if (delArmed !== id) { delArmed = id; renderVault(); setTimeout(function () { if (delArmed === id) { delArmed = null; renderVault(); } }, 3000); return; }
    delArmed = null; dropReceipts(function (r) { return r.id === id; }); persist(); renderAll(); if (cur) renderRecs();
  });
  $("hist").addEventListener("change", function (e) {
    var id = e.target.dataset && e.target.dataset.ret; if (!id) return;
    var v = Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0)));
    mem.receipts.forEach(function (r) { if (r.id === id) { r.returnDays = v; stamp(r); } });
    persist(); renderVault(); renderReminders();
  });

  /* ---------- community prices ---------- */
  function reportPrices(receipt) {
    if (!mem.settings.sharePrices || !receipt || receipt.foreign) return;
    var items = receipt.items.filter(function (it) { return !it.pfand && it.price != null && it.price > 0; })
      .map(function (it) { return { en: it.en || it.raw, price: it.price }; });
    if (items.length) api("/api/prices/report", { store: receipt.store || "", day: isoDay(receipt.date), items: items }).catch(function () {});
  }

  /* ---------- shopping list ---------- */
  var priceCache = {};
  function listKey(n) { return norm(n); }
  function renderList() {
    var items = mem.list.slice().sort(function (a, b) { return (a.done - b.done) || (a.created || 0) - (b.created || 0); });
    $("slistEmpty").hidden = items.length > 0;
    $("clearDone").hidden = !items.some(function (x) { return x.done; });
    var total = 0, priced = 0, open = 0;
    $("slist").innerHTML = items.map(function (x) {
      var p = priceCache[listKey(x.name)], best = bestOf(p), bp = "";
      if (!x.done) { open++; if (best) { total += best.price; priced++; } }
      if (best) bp = '<span class="bp">' + t("Best: <b>{amount}</b> at {shop}", { amount: eur(best.price), shop: esc(best.where) }) + (best.note ? ' · ' + esc(best.note) : "") + '</span>';
      else if (p) bp = '<span class="bp">' + t("No price yet") + '</span>';
      return '<li class="' + (x.done ? "done" : "") + '"><input type="checkbox" data-li="' + esc(x.id) + '"' + (x.done ? " checked" : "") + ' aria-label="' + esc(t("Bought {item}", { item: x.name })) + '">' +
        '<span><span class="nm">' + esc(x.name) + '</span>' + bp + '</span><button class="del" type="button" data-rm="' + esc(x.id) + '" aria-label="' + esc(t("Remove {item}", { item: x.name })) + '">×</button></li>';
    }).join("");
    $("listTripRow").hidden = !open;
    $("listCount").hidden = !open; $("listCount").textContent = open;
    $("listTotal").textContent = open ? (priced ? t("Cheapest known prices: {amount} for {n} of {total} items", { amount: eur(r2(total)), n: priced, total: open }) : tn(open, "1 item to buy", "{n} items to buy")) : "";
    renderAgain(); renderTripChips();
  }
  function bestOf(p) {
    if (!p) return null;
    var c = [];
    if (p.aldi) c.push({ price: p.aldi.price, where: p.aldi.store, note: p.aldi.product });
    if (p.community) c.push({ price: p.community.price, where: p.community.chain, note: t("paid by Bonwise users") });
    if (p.open) c.push({ price: p.open.price, where: p.open.chain, note: p.open.product + " (Open Prices)" });
    return c.sort(function (a, b) { return a.price - b.price; })[0] || null;
  }
  function refreshListPrices() {
    var need = mem.list.filter(function (x) { return !x.done && !priceCache[listKey(x.name)]; }).map(function (x) { return x.name; });
    if (!need.length) return renderList();
    api("/api/list/prices", { items: need }).then(function (j) {
      (j.items || []).forEach(function (e) { priceCache[listKey(e.name)] = e; });
      renderList();
    }).catch(function () {});
  }
  function addToList(name, quiet) {
    name = String(name || "").trim().slice(0, 80); if (!name) return;
    if (mem.list.some(function (x) { return !x.done && listKey(x.name) === listKey(name); })) return;
    var item = stamp({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, done: false, created: Date.now() });
    mem.list.push(item); delete mem.tomb.list[item.id];
    if (!quiet) { persist(); renderList(); refreshListPrices(); }
  }
  $("listForm").addEventListener("submit", function (e) { e.preventDefault(); addToList($("listInput").value); $("listInput").value = ""; $("listInput").focus(); });
  $("slist").addEventListener("change", function (e) {
    var id = e.target.dataset && e.target.dataset.li; if (!id) return;
    mem.list.forEach(function (x) { if (x.id === id) { x.done = e.target.checked; stamp(x); } });
    persist(); renderList();
  });
  $("slist").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-rm]"); if (!b) return;
    mem.list = mem.list.filter(function (x) { if (x.id === b.dataset.rm) { mem.tomb.list[x.id] = Date.now(); return false; } return true; });
    persist(); renderList();
  });
  $("clearDone").addEventListener("click", function () {
    mem.list = mem.list.filter(function (x) { if (x.done) { mem.tomb.list[x.id] = Date.now(); return false; } return true; });
    persist(); renderList();
  });
  $("shareList").addEventListener("click", function () {
    var open = mem.list.filter(function (x) { return !x.done; });
    if (!open.length) { $("listInput").focus(); return; }
    var text = t("Shopping list (Bonwise)") + "\n" + open.map(function (x) {
      var b = bestOf(priceCache[listKey(x.name)]);
      return "• " + x.name + (b ? " (" + t("{amount} at {shop}", { amount: eur(b.price), shop: b.where }) + ")" : "");
    }).join("\n") + "\nhttps://bonwise.onrender.com";
    shareText(text, $("shareList"));
  });
  function shareText(text, btn) {
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    var done = function () { var was = btn.textContent; btn.textContent = t("Copied"); setTimeout(function () { btn.textContent = was; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {}); 
  }
  function againTop(n) {
    var counts = {}, inList = {};
    mem.list.forEach(function (x) { if (!x.done) inList[listKey(x.name)] = 1; });
    mem.receipts.forEach(function (r) {
      (r.items || []).forEach(function (it) {
        if (it.d || !it.n || it.c === "Pfand" || it.c === "Clothing & shoes" || it.c === "Electronics" || /paper bag|tragetasche|tüte/i.test(it.n)) return;
        var k = listKey(it.n); if (inList[k]) return;
        var c = counts[k] || (counts[k] = { name: it.n, n: 0, last: 0 });
        c.n++; c.last = Math.max(c.last, r.at || 0);
      });
    });
    return Object.keys(counts).map(function (k) { return counts[k]; })
      .sort(function (a, b) { return b.n - a.n || b.last - a.last; }).slice(0, n);
  }
  function renderAgain() {
    var top = againTop(12);
    $("againCard").hidden = !top.length;
    $("again").innerHTML = top.map(function (c) {
      return '<button type="button" data-again="' + esc(c.name) + '">+ ' + esc(c.name) + (c.n > 1 ? '<small>×' + c.n + '</small>' : "") + '</button>';
    }).join("");
  }
  $("again").addEventListener("click", function (e) { var b = e.target.closest("button[data-again]"); if (b) addToList(b.dataset.again); });

  /* ---------- shops from OpenStreetMap, fetched by this phone ----------
     The phone asks the free map services itself: its own internet address isn't
     rate-limited like the shared cloud server's. The position is rounded to about 100 m
     first. Overpass (with opening hours) is asked first; if it refuses or is slow, Photon
     by komoot. The Bonwise server then works out distances, "open now" and prices; if the
     phone gets nothing, the server tries the same services itself. */
  var OVERPASS = "https://overpass-api.de/api/interpreter", PHOTON = "https://photon.komoot.io/reverse";
  var OSM_KINDS = "supermarket|discount|convenience|chemist|greengrocer|bakery|butcher";
  var OSM_TAGS = ["name", "brand", "shop", "opening_hours", "addr:street", "addr:housenumber"];
  var PHOTON_GROUPS = [["supermarket", "discount", "chemist"], ["convenience", "greengrocer", "bakery", "butcher"]];
  var osmCache = {};
  function round3(x) { return Math.round(x * 1000) / 1000; }
  function getJson(url, init, ms) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms);
    return fetch(url, Object.assign({ signal: c.signal }, init || {}))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
  }
  function fromOverpass(lat, lon) {
    var dlat = 1500 / 111320, dlon = 1500 / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    var box = [lat - dlat, lon - dlon, lat + dlat, lon + dlon].map(function (x) { return x.toFixed(4); }).join(",");
    var q = '[out:json][timeout:20][bbox:' + box + '];(node[shop~"^(' + OSM_KINDS + ')$"];way[shop~"^(' + OSM_KINDS + ')$"];);out center tags;';
    // A plain form POST: no CORS preflight.
    return getJson(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" } }, 8000)
      .then(function (j) {
        if (!j || !Array.isArray(j.elements) || (!j.elements.length && j.remark)) throw new Error("no answer");
        return j.elements.slice(0, 2000).map(function (el) {
          var tags = {}; OSM_TAGS.forEach(function (k) { if (el.tags && el.tags[k] != null) tags[k] = String(el.tags[k]).slice(0, 200); });
          var pos = el.lat != null ? el : (el.center || {});
          return { lat: pos.lat, lon: pos.lon, tags: tags };
        });
      });
  }
  function fromPhoton(lat, lon) {
    return Promise.all(PHOTON_GROUPS.map(function (g) {
      var url = PHOTON + "?lat=" + lat + "&lon=" + lon + "&radius=1.5&limit=50" + g.map(function (k) { return "&osm_tag=shop:" + k; }).join("");
      return getJson(url, null, 10000);
    })).then(function (answers) {
      var out = [];
      answers.forEach(function (a) {
        (a.features || []).forEach(function (f) {
          var p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
          if (p.osm_key !== "shop" || !p.name || c.length < 2) return;
          var tags = { shop: p.osm_value, name: String(p.name).slice(0, 200) };
          if (p.street) tags["addr:street"] = String(p.street).slice(0, 100);
          if (p.housenumber) tags["addr:housenumber"] = String(p.housenumber).slice(0, 20);
          out.push({ lat: c[1], lon: c[0], tags: tags });
        });
      });
      return out;
    });
  }
  // -> shop elements, or null when neither service answered (the server then tries).
  function osmShops(lat, lon) {
    lat = round3(lat); lon = round3(lon);
    var key = lat + "," + lon;
    if (osmCache[key] && Date.now() - osmCache[key].at < 3600000) return Promise.resolve(osmCache[key].el);
    return fromOverpass(lat, lon).catch(function () { return fromPhoton(lat, lon); })
      .then(function (el) { osmCache[key] = { at: Date.now(), el: el }; return el; }, function () { return null; });
  }

  /* ---------- nearby shops ---------- */
  var shopsData = [], shopFilter = "all";
  function renderShops() {
    var list = shopsData.filter(function (x) {
      return shopFilter === "all" || (shopFilter === "disc" && x.discounter) || (shopFilter === "open" && x.open === true) || (shopFilter === "drug" && x.kind === "Drugstore");
    });
    $("shopCount").textContent = shopsData.length ? t("{n} shown", { n: list.length }) : "";
    $("shops").innerHTML = list.length ? list.map(function (x) {
      var open = x.open === true ? '<span class="pill2">' + t("Open now") + '</span>' : x.open === false ? '<span class="pill2 grey">' + t("Closed now") + '</span>' : "";
      return '<li><span class="nm">' + avatar(x.name) + esc(x.name) + '</span><span class="dist">' + distTxt(x.distance) + '</span>' +
        '<span class="meta">' + esc(tw(x.kind)) + (x.discounter ? ' <span class="pill2 warn">' + t("Discounter") + '</span>' : "") + ' ' + open + (x.address ? ' · ' + esc(x.address) : "") + '</span>' +
        (x.hours ? '<span class="meta" dir="ltr">' + esc(x.hours) + '</span>' : "") +
        '<a class="go" href="https://www.google.com/maps/dir/?api=1&destination=' + x.lat + "," + x.lon + '" target="_blank" rel="noopener">' + t("Directions →") + '</a></li>';
    }).join("") : (shopsData.length ? '<li class="muted">' + t("No shops match this filter.") + '</li>' : "");
  }
  $("findShops").addEventListener("click", function () {
    var btn = $("findShops"), err = $("shopErr");
    err.hidden = true;
    if (!navigator.geolocation) { err.hidden = false; err.textContent = t("This phone doesn’t share its location with apps."); return; }
    btn.disabled = true; btn.textContent = t("Finding your location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      var d = new Date(), q = "lat=" + round3(pos.coords.latitude) + "&lon=" + round3(pos.coords.longitude) + "&dow=" + ((d.getDay() + 6) % 7) + "&min=" + (d.getHours() * 60 + d.getMinutes());
      btn.textContent = t("Looking for shops…");
      osmShops(pos.coords.latitude, pos.coords.longitude).then(function (osm) {
        return osm ? api("/api/shops", { lat: round3(pos.coords.latitude), lon: round3(pos.coords.longitude), dow: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes(), osm: osm }) : api("/api/shops?" + q);
      }).then(function (j) {
        shopsData = j.shops || []; $("shopFilter").hidden = !shopsData.length;
        nearShops = shopsData; nearState = "done"; if (cur) renderSwapNear(); $("shopArt").hidden = !!shopsData.length;
        if (!shopsData.length) { err.hidden = false; err.className = "notice warn"; err.textContent = t("No shops found within 1.5 km."); }
        renderShops();
      }).catch(function (e) { err.hidden = false; err.className = "notice bad"; err.textContent = e.message; })
        .then(function () { btn.disabled = false; btn.textContent = t("Search again"); });
    }, function (e) {
      btn.disabled = false; btn.textContent = t("Find shops near me");
      err.hidden = false; err.className = "notice bad";
      err.textContent = e.code === 1 ? t("Bonwise isn’t allowed to use your location. Allow location for Bonwise in your phone’s settings, then try again.") : t("Your location couldn’t be found. Check that location is switched on, then try again.");
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  });
  $("shopFilter").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-f]"); if (!b) return;
    shopFilter = b.dataset.f;
    $("shopFilter").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    renderShops();
  });

  /* ---------- plan my shop: cheapest shops nearby, before shopping ---------- */
  var tripItems = [], tripBusy = false, lastTrip = null;
  function distTxt(m) { return m < 1000 ? m + " m" : numTxt(m / 1000, 1) + " km"; }
  function mapsLink(x) { return "https://www.google.com/maps/dir/?api=1&destination=" + x.lat + "," + x.lon; }
  function openTxt(x) { return x.open === true ? t("Open now") : x.open === false ? t("Closed now") : ""; }
  function shopName(x) { return x.name || x.brand || t("Shop"); }
  function listText(a) { return a.length <= 1 ? a.join("") : t("{list} and {last}", { list: a.slice(0, -1).join(", "), last: a[a.length - 1] }); }
  // Where the user's own location comes from: asked for only when they press the button.
  function locate() {
    return new Promise(function (res) {
      if (!navigator.geolocation) return res({ pos: null, why: t("This phone doesn’t share its location with apps.") });
      navigator.geolocation.getCurrentPosition(function (p) { res({ pos: p }); }, function (e) {
        res({ pos: null, why: e.code === 1 ? t("Location is off for Bonwise, so shops near you aren’t compared. Allow location in your phone’s settings to see them.") : t("Your location couldn’t be found, so shops near you aren’t compared.") });
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    });
  }
  function tripLoading(text) { $("tripBody").innerHTML = '<div class="trip-load"><span class="spin" aria-hidden="true"></span><span>' + esc(text) + '</span></div>'; }
  function runTrip(payload, slot) {
    if (tripBusy) return;
    lastTrip = { payload: payload, slot: slot };
    tripBusy = true; $("tripGo").disabled = $("listTrip").disabled = true;
    $(slot).appendChild($("tripCard")); $("tripCard").hidden = false;
    tripLoading(t("Finding your location…"));
    $("tripCard").scrollIntoView({ behavior: "smooth", block: "start" });
    locate().then(function (loc) {
      tripLoading(loc.pos ? t("Comparing the shops near you…") : t("Looking up prices…"));
      var d = new Date(), body = Object.assign({}, payload);
      if (!loc.pos) return api("/api/trip", body).then(function (j) { renderTrip(j, loc.why || ""); });
      Object.assign(body, { lat: round3(loc.pos.coords.latitude), lon: round3(loc.pos.coords.longitude), dow: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes() });
      return osmShops(body.lat, body.lon).then(function (osm) {
        if (osm) body.osm = osm;
        return api("/api/trip", body);
      }).then(function (j) { renderTrip(j, ""); });
    }).catch(function (e) {
      $("tripBody").innerHTML = '<div class="notice bad" style="margin-top:0">' + esc((e && e.message) || t("Something went wrong. Try again.")) + '</div>';
    }).then(function () { tripBusy = false; $("tripGo").disabled = $("listTrip").disabled = false; });
  }
  function srcNote(p) {
    if (p.src === "users") return " · " + t("paid by Bonwise users");
    if (p.src === "aldi") return " · " + t("ALDI SÜD shelf price");
    if (p.src === "open") return " · " + esc(p.product || "") + (p.date ? ", " + esc(t("seen {date}", { date: fmtIso(p.date) })) : "") + " (Open Prices)";
    return "";
  }
  function fmtIso(d) { var x = new Date(d + "T12:00:00"); return isNaN(x) ? d : x.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: x.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }); }
  function srcTag(p) { return p.real ? '<span class="src-tag real">' + t("Real price") + '</span>' : '<span class="src-tag est">' + t("Estimate") + '</span>'; }
  function renderTrip(j, locWhy) {
    tripItems = j.items || [];
    var shops = j.shops || [], best = j.best != null ? shops[j.best] : null, going = j.going != null ? shops[j.going] : null, html = "";
    var n = tripItems.filter(function (it) { return !it.online; }).length;
    if (locWhy) html += '<div class="notice warn" style="margin-top:0;margin-bottom:12px">' + esc(locWhy) + ' ' + t("Below are the best prices we know.") + '</div>';
    else if (j.notice) html += '<div class="notice warn" style="margin-top:0;margin-bottom:12px">' + esc(j.notice) + (j.retry ? ' <button class="linkbtn" type="button" id="tripRetry">' + t("Try again") + '</button>' : "") + '</div>';
    else if (j.located && !best && n) html += '<div class="notice warn" style="margin-top:0;margin-bottom:12px">' + t("No shop within 1.5 km sells everything on this list. See each item below.") + '</div>';
    if (best) {
      var meta = [distTxt(best.distance), openTxt(best), best.address].filter(Boolean).join(" · ");
      var note = "";
      if (j.goingTo && going && going !== best) {
        var diff = r2(going.total - best.total);
        note = diff > 0.05 ? '<p class="bs-note warn">' + t("You’re going to {shop}: about <b>{amount}</b> there ({dist}). {best} saves you about <b>{diff}</b>.", { shop: esc(j.goingTo), amount: eur(going.total), dist: distTxt(going.distance), best: esc(shopName(best)), diff: eur(diff) }) + '</p>'
          : '<p class="bs-note">' + t("{shop} costs about the same ({amount}), so either shop is fine.", { shop: esc(j.goingTo), amount: eur(going.total) }) + '</p>';
      } else if (j.goingTo && going === best) note = '<p class="bs-note">' + t("Good choice: <b>{shop}</b> is the cheapest shop near you for this list.", { shop: esc(j.goingTo) }) + '</p>';
      else if (j.goingTo) note = '<p class="bs-note">' + t("There’s no {shop} within 1.5 km of you.", { shop: esc(j.goingTo) }) + '</p>';
      html += '<div class="best-stop"><span class="label">' + t("Best stop for your list") + '</span><div class="bs-top"><div><div class="bs-name">' + avatar(shopName(best)) + esc(shopName(best)) + '</div><div class="bs-meta">' + esc(meta) + '</div></div>' +
        '<div class="bs-total num">~' + eur(best.total) + '<small>' + (best.priced < n ? t("for {n} of {total} items", { n: best.priced, total: n }) : tn(n, "for 1 item", "for {n} items")) + '</small></div></div>' + note +
        '<div class="bs-actions"><a class="btn small" href="' + mapsLink(best) + '" target="_blank" rel="noopener">' + t("Directions") + '</a><button class="btn small line" type="button" id="tripSave">' + t("Save to my list") + '</button></div></div>';
    } else html += '<div class="bs-actions" style="margin-top:0"><button class="btn small line" type="button" id="tripSave">' + t("Save to my list") + '</button></div>';
    if (j.split) {
      var parts = j.split.stops.map(function (st) { return esc(shopName(shops[st.shop])) + " (" + esc(listText(st.items.map(function (i) { return tw(tripItems[i].name); }))) + ")"; });
      html += '<div class="notice ok">' + t("Two stops save more: {stops} comes to about <b>{amount}</b>, {save} less than one stop.", { stops: parts.join(" + "), amount: eur(j.split.total), save: eur(j.split.save) }) + '</div>';
    }
    html += '<ul class="titems">' + tripItems.map(function (it) {
      // Show what was typed only when it isn't simply the product's name (in English or the chosen language).
      var tq = norm(it.query), same = [norm(it.name), norm(tw(it.name))].some(function (nm) { return nm && (tq.indexOf(nm) >= 0 || nm.indexOf(tq) >= 0); });
      var typed = same ? "" : '<span class="typed">“' + esc(it.query) + '”</span>';
      var size = (it.count > 1 ? it.count + " × " : "") + (it.size || "");
      var amt = "", where;
      if (it.online) {
        amt = eur(it.online.price) + '<span class="src-tag real">' + t("Real price") + '</span>';
        where = t("Cheapest online at <b>{shop}</b> ({src}), brand shop {amount}", { shop: esc(it.online.shop), src: esc(it.online.src), amount: eur(it.online.list) });
      } else if (it.tip) {
        amt = '<span class="src-tag tip">' + t("Tip") + '</span>';
        where = esc(it.tip);
      } else if (it.best) {
        var sh = shops[it.best.shop];
        if (it.best.price != null) {
          amt = eur(it.best.price) + srcTag(it.best);
          where = t("Cheapest at <b>{shop}</b>", { shop: esc(shopName(sh)) }) + " · " + distTxt(sh.distance) + srcNote(it.best);
        } else where = t("No price yet · sold at <b>{shop}</b>", { shop: esc(shopName(sh)) }) + " · " + distTxt(sh.distance);
      } else if (it.known) {
        amt = eur(it.known.price) + '<span class="src-tag real">' + t("Real price") + '</span>';
        where = t("Best known: <b>{shop}</b>", { shop: esc(it.known.chain) }) + srcNote(it.known);
      } else if (it.typical != null) {
        amt = "~" + eur(it.typical) + '<span class="src-tag est">' + t("Estimate") + '</span>';
        where = t("Usually cheapest at {where}", { where: esc(it.hint) });
      } else where = t("No price yet · usually cheapest at {where}", { where: esc(it.hint) });
      // Real prices at other chains, cheapest first (from Open Prices).
      var also = (it.chains || []).filter(function (c) { return !(it.best && shops[it.best.shop] && shops[it.best.shop].chain === c.chain && it.best.src === "open"); }).slice(0, 4);
      if (also.length && !it.online && !it.tip) where += '<span class="also">' + also.map(function (c) { return esc(c.chain) + " " + eur(c.price); }).join(" · ") + '</span>';
      if (it.co2) where += '<span class="eco-line">' + ecoChips(it.co2) + '</span>';
      return '<li><span class="nm">' + esc(tw(it.name)) + (size ? '<small>' + esc(size) + '</small>' : "") + typed + '</span><span class="amt num">' + amt + '</span><span class="where">' + where + '</span></li>';
    }).join("") + '</ul>';
    var ecoKnown = tripItems.filter(function (it) { return it.co2 && it.co2.kg != null; });
    if (ecoKnown.length) {
      var ecoSum = ecoKnown.reduce(function (a, it) { return a + it.co2.kg; }, 0);
      html += '<p class="trip-eco">🌍 ' + (ecoKnown.length === tripItems.length ? t("Climate footprint of this list: <b>{kg}</b>", { kg: kgTxt(ecoSum) }) : t("Climate footprint of {n} of these items: <b>{kg}</b>", { n: ecoKnown.length, kg: kgTxt(ecoSum) })) + ' <span class="src-tag est">' + t("Estimate") + '</span></p>';
    }
    var others = shops.filter(function (x) { return x.covers > 0; });
    if (others.length > 1) {
      html += '<details class="cmpshops"><summary>' + t("Compare {n} shops", { n: others.length }) + '</summary><ul class="shops">' + others.map(function (x) {
        return '<li><span class="nm">' + avatar(shopName(x)) + esc(shopName(x)) + '</span><span class="tot num">~' + eur(x.total) + '</span>' +
          '<span class="meta">' + distTxt(x.distance) + ' · ' + esc(tw(x.kind)) + (openTxt(x) ? ' · ' + openTxt(x) : "") + ' · ' + (x.missing.length ? esc(t("no {items}", { items: listText(x.missing.map(tw)) })) : t("has everything")) + '</span>' +
          '<a class="go" href="' + mapsLink(x) + '" target="_blank" rel="noopener">' + t("Directions →") + '</a></li>';
      }).join("") + '</ul></details>';
    }
    html += '<p class="pc-note">' + t("Real price: prices shoppers reported to Open Prices by Open Food Facts (ODbL, updated weekly, last {date}), ALDI SÜD shelf prices ({checked}) and what Bonwise users paid in the last 90 days. Estimate: the typical price level of that kind of shop. Prices vary by region and change often. Shop data © OpenStreetMap contributors.", { date: j.openPrices ? esc(fmtIso(j.openPrices)) : "–", checked: esc(j.checked || "") }) + '</p>';
    $("tripBody").innerHTML = html;
  }
  $("tripBody").addEventListener("click", function (e) {
    if (e.target.closest("#tripRetry") && lastTrip) { runTrip(lastTrip.payload, lastTrip.slot); return; }
    if (!e.target.closest("#tripSave")) return;
    tripItems.forEach(function (it) {
      var q = norm(it.query), nm = norm(it.name);
      addToList(q.indexOf(nm) >= 0 || nm.indexOf(q) >= 0 ? it.query : it.name, true);
    });
    persist(); renderList(); refreshListPrices();
    e.target.textContent = t("✓ Saved to your list"); e.target.disabled = true;
  });
  $("tripClose").addEventListener("click", function () { $("tripCard").hidden = true; });
  $("tripText").value = store.get("bonwise.tripText", "");
  $("tripForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var typed = $("tripText").value.trim();
    if (!typed) { $("tripText").focus(); $("tripText").placeholder = t("Type a few things first, e.g. milk, bread"); return; }
    store.set("bonwise.tripText", typed);
    $("tripText").blur();
    showTab("home", true);
    runTrip({ text: typed }, "tripSlotHome");
  });
  $("listTrip").addEventListener("click", function () {
    var open = mem.list.filter(function (x) { return !x.done; }).map(function (x) { return x.name; });
    if (open.length) runTrip({ items: open }, "tripSlotList");
  });
  // Quick picks under the box: the shopping list, and things you buy often.
  function renderTripChips() {
    var open = mem.list.filter(function (x) { return !x.done; }), top = againTop(5), html = "";
    if (open.length) html += '<button type="button" class="use" data-use-list="1">' + t("Use my list ({n})", { n: open.length }) + '</button>';
    html += top.map(function (c) { return '<button type="button" data-add="' + esc(c.name) + '">+ ' + esc(c.name) + '</button>'; }).join("");
    $("tripChips").innerHTML = html; $("tripChips").hidden = !html;
  }
  $("tripChips").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.useList) {
      var open = mem.list.filter(function (x) { return !x.done; }).map(function (x) { return x.name; });
      $("tripText").value = open.join(", "); store.set("bonwise.tripText", $("tripText").value);
      showTab("home", true); runTrip({ items: open }, "tripSlotHome"); return;
    }
    var typed = $("tripText").value.trim();
    $("tripText").value = (typed ? typed.replace(/[,\s،]+$/, "") + ", " : "") + b.dataset.add;
    b.remove(); if (!$("tripChips").children.length) $("tripChips").hidden = true;
  });

  /* ---------- simple view ---------- */
  function applySimple() {
    var on = !!mem.settings.simple;
    document.body.classList.toggle("simple", on);
    $("setSimple").checked = on;
    $("simpleToggle").textContent = on ? t("Show all details") : t("Switch to simple view");
  }
  $("setSimple").addEventListener("change", function () { mem.settings.simple = $("setSimple").checked; persist(); applySimple(); });
  $("simpleToggle").addEventListener("click", function () { mem.settings.simple = !mem.settings.simple; persist(); applySimple(); });

  /* ---------- language ---------- */
  function setLang(l) { if (!LANG_NAMES[l] || l === LANG) return; store.set("bonwise.lang", l); location.reload(); }
  $("setLang").innerHTML = Object.keys(LANG_NAMES).map(function (l) { return '<option value="' + l + '"' + (l === LANG ? " selected" : "") + ">" + LANG_NAMES[l] + "</option>"; }).join("");
  $("setLang").addEventListener("change", function () { setLang($("setLang").value); });
  $("langChips").innerHTML = Object.keys(LANG_NAMES).map(function (l) { return '<button type="button" data-lang="' + l + '"' + (l === LANG ? ' aria-pressed="true"' : ' aria-pressed="false"') + ' lang="' + l + '">' + LANG_NAMES[l] + "</button>"; }).join("");
  $("langChips").addEventListener("click", function (e) { var b = e.target.closest("button[data-lang]"); if (b) setLang(b.dataset.lang); });

  /* ---------- settings ---------- */
  function renderSettings() {
    $("setShare").checked = !!mem.settings.sharePrices;
    $("setReturn").value = mem.settings.returnDays;
    var on = !!(mem.household && mem.household.code);
    $("hhOn").hidden = !on; $("hhOff").hidden = on;
    if (on) $("hhCode").textContent = mem.household.code;
  }
  $("setShare").addEventListener("change", function () { mem.settings.sharePrices = $("setShare").checked; persist(); });
  $("setReturn").addEventListener("change", function () {
    mem.settings.returnDays = Math.max(0, Math.min(365, Math.round(Number($("setReturn").value) || 0))); persist(); renderSettings();
  });

  /* ---------- household sharing ---------- */
  var syncTimer = null, syncing = false, syncAgain = false;
  function hhMsg(text, kind) { var m = $("hhMsg"); m.hidden = !text; m.className = "notice " + (kind || "ok"); m.textContent = text || ""; }
  function syncLabel(t) { $("syncState").textContent = t || ""; }
  function buildState() {
    var st = { receipts: {}, plan: {}, list: {}, budget: { value: mem.budget, updated: mem.budgetAt || 0 } };
    mem.receipts.forEach(function (r) { st.receipts[r.id] = r; });
    mem.plan.forEach(function (x) { st.plan[x.key] = x; });
    mem.list.forEach(function (x) { st.list[x.id] = x; });
    ["receipts", "plan", "list"].forEach(function (part) {
      Object.keys(mem.tomb[part]).forEach(function (id) {
        var live = st[part][id];
        if (!live || (live.updated || 0) < mem.tomb[part][id]) st[part][id] = { id: id, key: id, deleted: true, updated: mem.tomb[part][id] };
      });
    });
    return st;
  }
  function applyState(st) {
    ["receipts", "plan", "list"].forEach(function (part) {
      var live = [], tomb = {};
      Object.keys(st[part] || {}).forEach(function (id) {
        var x = st[part][id]; if (!x || typeof x !== "object") return;
        if (x.deleted) tomb[id] = x.updated || Date.now(); else live.push(x);
      });
      mem[part] = live; mem.tomb[part] = tomb;
    });
    if (st.budget && typeof st.budget.value === "number" && (st.budget.updated || 0) >= (mem.budgetAt || 0)) {
      mem.budget = st.budget.value; mem.budgetAt = st.budget.updated || 0; $("budget").value = mem.budget;
    }
    store.set("bonwise.budget", mem.budget); store.set("bonwise.budgetAt", mem.budgetAt);
    store.set("bonwise.receipts", mem.receipts); store.set("bonwise.plan", mem.plan); store.set("bonwise.list", mem.list); store.set("bonwise.tomb", mem.tomb);
    renderAll();
  }
  function scheduleSync() {
    if (!mem.household || !mem.household.code) return;
    clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1200);
  }
  function syncNow(manual) {
    if (!mem.household || !mem.household.code) return Promise.resolve();
    if (syncing) { syncAgain = true; return Promise.resolve(); }
    syncing = true; syncLabel(t("Syncing…"));
    return api("/api/household/sync", { code: mem.household.code, state: buildState(), recreate: true }).then(function (j) {
      applyState(j.state);
      syncLabel(t("Synced {time}", { time: new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }) }));
      if (manual) hhMsg(t("Everything is up to date."), "ok");
    }).catch(function (e) {
      syncLabel(t("Not synced")); if (manual) hhMsg(e.message, "bad");
    }).then(function () { syncing = false; if (syncAgain) { syncAgain = false; scheduleSync(); } });
  }
  function joinHousehold(code, isNew) {
    return api("/api/household/sync", { code: code, state: buildState() }).then(function (j) {
      mem.household = { code: code }; store.set("bonwise.household", mem.household);
      applyState(j.state); renderSettings();
      syncLabel(t("Synced {time}", { time: new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }) }));
      hhMsg(isNew ? t("Household created. Share the code with the people you shop with.") : t("You joined the household. Receipts, list and budget are now shared."), "ok");
    });
  }
  $("hhCreate").addEventListener("click", function () {
    var b = $("hhCreate"); b.disabled = true; hhMsg("");
    api("/api/household/new", {}).then(function (j) { return joinHousehold(j.code, true); })
      .catch(function (e) { hhMsg(e.message, "bad"); }).then(function () { b.disabled = false; });
  });
  $("hhJoinForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = $("hhJoinCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^BW/, "");
    if (raw.length !== 12) { hhMsg(t("A household code looks like BW-XXXX-XXXX-XXXX."), "warn"); return; }
    var code = "BW-" + raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8);
    joinHousehold(code, false).then(function () { $("hhJoinCode").value = ""; }).catch(function (e) { hhMsg(e.message, "bad"); });
  });
  $("hhShare").addEventListener("click", function () {
    shareText(t("Join my Bonwise household with this code: {code}", { code: mem.household.code }) + "\n" + t("Open Bonwise → ⚙ Settings → Household sharing → Join.") + "\nhttps://bonwise.onrender.com", $("hhShare"));
  });
  $("hhSync").addEventListener("click", function () { syncNow(true); });
  $("hhLeave").addEventListener("click", function () {
    mem.household = null; try { localStorage.removeItem("bonwise.household"); } catch (e) {}
    renderSettings(); syncLabel(""); hhMsg(t("This phone left the household. Its own copy of your data stays here."), "ok");
  });
  var hhDelArmed = false;
  $("hhDelete").addEventListener("click", function () {
    if (!hhDelArmed) { hhDelArmed = true; $("hhDelete").textContent = t("Tap again to delete it from the server"); setTimeout(function () { hhDelArmed = false; $("hhDelete").textContent = t("Delete household data"); }, 4000); return; }
    hhDelArmed = false; $("hhDelete").textContent = t("Delete household data");
    api("/api/household/delete", { code: mem.household.code }).then(function () {
      mem.household = null; try { localStorage.removeItem("bonwise.household"); } catch (e) {}
      renderSettings(); syncLabel(""); hhMsg(t("The household’s data was deleted from the server. This phone keeps its own copy."), "ok");
    }).catch(function (e) { hhMsg(e.message, "bad"); });
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { syncNow(); renderReminders(); } });

  function renderAll() { renderBudget(); renderVault(); renderReminders(); renderPlan(); renderList(); renderSettings(); applySimple(); }
  renderAll();
  showTab((location.hash || "").slice(1) || "home");
  syncNow();

  // Installable app: the service worker adds an offline page and lets Android install Bonwise.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
})();
