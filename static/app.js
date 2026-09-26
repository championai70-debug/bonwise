/* Bonwise browser app. The Python server reads the receipt (AI model on
   Hugging Face, Tesseract as backup) and works out the savings; this file
   shows the results and keeps the budget, receipts and plan in this browser. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

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

  /* ---------- helpers ---------- */
  function eur(n, dec) { n = Number(n) || 0; return (n < 0 ? "−" : "") + "€" + Math.abs(n).toFixed(dec === 0 ? 0 : 2); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function norm(s) {
    return String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9.,\- ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  var now = new Date();
  var monthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var day = now.getDate();
  var monthName = now.toLocaleDateString("en-GB", { month: "long" });
  $("monthLabel").textContent = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  $("addBtn").textContent = "Add to " + monthName;

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
    $("leftBig").innerHTML = (left < 0 ? eur(-left, 0) + " <small>over budget</small>" : eur(left, 0) + " <small>left this month</small>");
    $("leftBig").className = "left-big num" + (left < 0 ? " over" : "");
    var pct = function (v) { return budget > 0 ? Math.max(0, Math.min(100, v / budget * 100)) : 0; };
    $("mSpent").style.width = pct(spent) + "%";
    $("mPending").style.width = Math.max(0, Math.min(100 - pct(spent), pct(pending))) + "%";
    $("mToday").style.left = "calc(" + (day / daysInMonth * 100) + "% - 1px)";
    $("lgPending").hidden = !cur;
    $("stSpent").textContent = eur(after, 0);
    var daysLeft = daysInMonth - day + 1;
    $("stDaily").textContent = left > 0 ? eur(left / daysLeft) : "€0";
    var couldSave = r2(monthReceipts().reduce(function (a, r) { return a + (r.save || 0); }, 0) + (cur ? itemSave() : 0));
    $("stSaved").textContent = eur(couldSave);
    var ws = $("withSwaps"), s = cur ? itemSave() : 0;
    if (cur && s > 0) { ws.hidden = false; ws.innerHTML = "With the swaps on this receipt you’d have <b>" + eur(left + s, 0) + " left</b> instead of " + eur(left, 0) + "."; }
    else if (!cur && mem.plan.length) { var pm = r2(planPerShop() * 4.3); ws.hidden = false; ws.innerHTML = "Your savings plan puts about <b>" + eur(pm, 0) + " a month</b> back into this budget."; }
    else ws.hidden = true;
    var pace = pacing(after, budget);
    var chip = $("paceChip"); chip.textContent = pace.label; chip.className = "status " + pace.cls;
    $("resetBtn").hidden = monthReceipts().length === 0;
  }
  function pacing(spent, budget) {
    if (budget <= 0) return { label: "Set a budget", cls: "warn" };
    if (spent > budget) return { label: "Over budget", cls: "bad" };
    if (spent / budget > day / daysInMonth + 0.1) return { label: "Spending fast", cls: "warn" };
    return { label: "On track", cls: "good" };
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
    if (!wipeArmed) { wipeArmed = true; $("wipeBtn").textContent = "Tap again: delete all receipts, the plan and the list"; setTimeout(function () { wipeArmed = false; $("wipeBtn").textContent = "Start fresh"; }, 4000); return; }
    wipeArmed = false; $("wipeBtn").textContent = "Start fresh";
    dropReceipts(function () { return true; });
    mem.plan.forEach(function (x) { mem.tomb.plan[x.key] = Date.now(); }); mem.plan = [];
    mem.list.forEach(function (x) { mem.tomb.list[x.id] = Date.now(); }); mem.list = [];
    persist();
    closeReceipt(); showErr(""); aiState(""); $("thumb").removeAttribute("src");
    renderAll();
  });
  var resetArmed = false;
  $("resetBtn").addEventListener("click", function () {
    if (!resetArmed) { resetArmed = true; $("resetBtn").textContent = "Tap again to clear " + monthName; setTimeout(function () { resetArmed = false; $("resetBtn").textContent = "Clear this month"; }, 3000); return; }
    dropReceipts(function (r) { return r.month === monthKey; });
    persist(); resetArmed = false; $("resetBtn").textContent = "Clear this month";
    renderAll(); if (cur) renderRecs();
  });

  /* ---------- receipt card ---------- */
  function flagChip(it) {
    if (it.flag === "corrected") return '<span class="chip flag">OCR read ' + eur(it.ocrPrice) + ' — check</span>';
    if (it.flag === "from-discount") return '<span class="chip flag">worked out: ' + eur(it.original) + ' − discount</span>';
    if (it.flag === "from-total") return '<span class="chip flag">price worked out from total — check</span>';
    if (it.flag === "unreadable" || it.price == null) return '<span class="chip bad">enter price</span>';
    return "";
  }
  var READER = { ai: "Read by AI", "ai-text": "Checked by AI", ocr: "Read by backup OCR", text: "Read from your text" };
  function renderReceipt() {
    $("receiptCard").hidden = false;
    $("rStore").textContent = cur.store || "Receipt";
    $("rDate").textContent = cur.date || "";
    var isAi = cur.reader === "ai" || cur.reader === "ai-text";
    $("srcChip").textContent = (READER[cur.reader] || "Read") + (isAi && cur.model ? " · " + cur.model.split("/").pop() : "");
    $("srcChip").className = "src" + (isAi ? " ai" : "");
    $("items").innerHTML = cur.items.map(function (it, i) {
      var tip = it.tip ? '<div class="tip"><span class="arrow">↘</span><span>' + esc(it.tip) + (it.save > 0 ? ' · <b>save ~' + eur(it.save) + '</b>' : '') + '</span></div>' : "";
      if (!it.save && it.market && it.price != null) tip = '<div class="pricecheck">✓ <span>Good price. ' + (it.market.sport ? 'Cheapest online is from ' + eur(it.market.forYours) + ' at ' + esc(it.market.store) : esc(it.market.store) + ' charges ' + eur(it.market.forYours) + ' for ' + esc(it.market.yourSize)) + '</span></div>';
      return '<li class="item' + (it.save > 0 ? " has-save" : "") + '" data-i="' + i + '">' +
        '<div class="nm">' + esc(it.en || it.raw) + '<span class="chip' + (it.pfand ? " pfand" : "") + '">' + esc(it.cat || "Other") + '</span>' + flagChip(it) + '</div>' +
        '<input class="price num' + (it.price == null ? " need" : "") + '" id="price-' + i + '" type="text" inputmode="decimal" aria-label="Price of ' + esc(it.en || it.raw) + '" value="' + (it.price == null ? "" : Number(it.price).toFixed(2)) + '" placeholder="0.00">' +
        '<button class="del" type="button" data-del="' + i + '" aria-label="Remove item">×</button>' +
        (it.en && it.raw && norm(it.en) !== norm(it.raw) ? '<div class="raw">' + esc(it.raw) + '</div>' : "") +
        (it.original != null && it.price != null && it.original > it.price ? '<div class="pricecheck">✓ <span>Discount applied: <s>' + eur(it.original) + '</s> → ' + eur(it.price) + ' (you saved ' + eur(it.original - it.price) + ')</span></div>' : "") +
        tip + '</li>';
    }).join("");
    renderTotals();
  }
  function renderTotals() {
    var t = itemTotal();
    $("rTotal").textContent = eur(t);
    $("rSave").textContent = eur(itemSave());
    var disc = r2(cur.items.reduce(function (a, it) { return a + (it.original != null && it.price != null && it.original > it.price ? it.original - it.price : 0); }, 0));
    $("rDiscRow").hidden = !(disc > 0); $("rDisc").textContent = eur(disc);
    var w = $("sumWarn"), missing = cur.items.filter(function (it) { return it.price == null; }).length;
    if (cur.foreign) { w.hidden = false; w.textContent = "This receipt is in " + cur.currency + ". Price checks and swaps only cover German shops in euros, so they’re off for this one."; }
    else if (missing) { w.hidden = false; w.textContent = missing + " price" + (missing > 1 ? "s" : "") + " couldn’t be read — type " + (missing > 1 ? "them" : "it") + " in from your receipt."; }
    else if (cur.printedTotal != null && Math.abs(cur.printedTotal - t) >= 0.01) { w.hidden = false; w.textContent = "The items add up to " + eur(t) + " but the receipt total says " + eur(cur.printedTotal) + ". Check the prices above, or remove lines that aren’t products."; }
    else w.hidden = true;
    renderBudget(); renderSavings(); renderRecs(); renderPC();
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
    if (tipEl) tipEl.textContent = "save ~" + eur(it.save);
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
      date: cur.date || now.toLocaleDateString("de-DE"), store: cur.store || "Receipt", total: itemTotal(), save: itemSave(),
      items: cur.items.map(function (it) { return { n: String(it.en || it.raw).slice(0, 60), p: it.price, c: it.cat || "Other", d: !!it.pfand }; }).slice(0, 150),
      returnDays: needsReturn({ items: cur.items.map(function (it) { return { c: it.cat }; }) }) ? mem.settings.returnDays : null
    });
    mem.receipts.push(rec);
    persist();
    reportPrices(cur);
    closeReceipt(); aiState("✓ Saved to " + monthName + ". Find it under Receipts.", "ok"); $("thumb").removeAttribute("src");
    renderAll();
  });
  $("discardBtn").addEventListener("click", function () { closeReceipt(); aiState(""); });
  $("clearBtn").addEventListener("click", function () { closeReceipt(); aiState(""); showErr(""); $("thumb").removeAttribute("src"); window.scrollTo({ top: 0, behavior: "smooth" }); });
  function closeReceipt() {
    cur = null;
    if (ctl) { ctl.abort(); ctl = null; }
    stopTimer(); setBusy(false);
    ["receiptCard", "saveCard", "swapCard", "recCard", "progress", "pcCard"].forEach(function (id) { $(id).hidden = true; });
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
    var t = itemTotal(), s = itemSave(), budget = Number(mem.budget) || 0, wk = budget * 7 / daysInMonth, list = swapItems();
    var hero = $("saveCard"); hero.hidden = false; hero.classList.toggle("none", !(s > 0));
    if (s > 0) {
      $("svLabel").textContent = "You could save on this shop";
      $("svBig").innerHTML = eur(s) + "<small>by making " + list.length + " swap" + (list.length > 1 ? "s" : "") + " next time</small>";
      $("svPct").hidden = false; $("svPct").textContent = Math.round(s / Math.max(t, 0.01) * 100) + "% less";
    } else {
      $("svLabel").textContent = "Nice shop";
      var dsc = r2(cur.items.reduce(function (a, it) { return a + (it.original != null && it.price != null && it.original > it.price ? it.original - it.price : 0); }, 0));
      $("svBig").innerHTML = "No cheaper swaps found<small>" + (dsc > 0 ? "You already saved " + eur(dsc) + " with the discounts on this receipt." : "These prices already look like discounter prices.") + "</small>";
      $("svPct").hidden = true;
    }
    $("cvPaid").textContent = eur(t); $("cvSwap").textContent = eur(t - s);
    $("cbPaid").style.width = "100%"; $("cbSwap").style.width = (t > 0 ? Math.max(0, (t - s) / t * 100) : 0) + "%";
    $("cmpAfter").hidden = !(s > 0);
    $("fMonth").textContent = eur(s * 4.3, 0); $("fYear").textContent = eur(s * 52, 0);
    if (wk > 0) {
      var used = Math.round(t / wk * 100);
      $("fWeek").textContent = used + "%";
      $("fWeekTxt").textContent = "of your " + eur(wk, 0) + " weekly allowance" + (s > 0 ? " (" + Math.round((t - s) / wk * 100) + "% with swaps)" : "");
      $("fWeekBox").classList.toggle("warn", used > 100);
    }
    var food = cur.items.filter(function (it) { return !it.pfand && it.price != null && it.price > 0; });
    var checked = food.filter(function (it) { return it.market; }).length;
    $("coverage").innerHTML = cur.foreign ? "" : "<b>" + checked + " of " + food.length + "</b> items checked against real shop prices (ALDI SÜD and online shops, " + esc(marketInfo.checked) + ")." + (checked < food.length ? " The rest use typical-price estimates." : "");
    $("swapCard").hidden = !list.length;
    $("swCount").textContent = list.length + " found";
    $("swaps").innerHTML = list.map(function (o) {
      var it = o.it, on = inPlan(it);
      return '<li class="swap' + (on ? " on" : "") + '"><input type="checkbox" id="sw-' + o.i + '" data-sw="' + o.i + '"' + (on ? " checked" : "") + '>' +
        '<label class="what" for="sw-' + o.i + '">' + esc(it.en || it.raw) + '</label><span class="amt num">−' + eur(it.save) + '</span>' +
        '<span class="how"><s>' + eur(it.price) + '</s> → <span class="to">' + (it.market && it.save ? "" : "~") + eur(it.altPrice) + '</span> · ' + esc(it.alt || "cheaper option") +
        (it.market && it.save ? '<span class="src-tag real">Real price</span>' : '<span class="src-tag est">Estimate</span>') + '</span></li>';
    }).join("");
    renderPickTotal();
  }
  function renderPickTotal() {
    var picked = swapItems().filter(function (o) { return inPlan(o.it); });
    var sum = r2(picked.reduce(function (a, o) { return a + o.it.save; }, 0));
    $("planHint").textContent = picked.length ? picked.length + " swap" + (picked.length > 1 ? "s" : "") + " added to your plan" : "Tick the swaps you’ll make next time";
    $("planPick").textContent = eur(sum * 4.3, 0) + " / month";
  }
  $("swaps").addEventListener("click", function (e) {
    var li = e.target.closest(".swap"); if (!li || e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
    var cb = li.querySelector("input"); cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
  $("swaps").addEventListener("change", function (e) {
    var cb = e.target; if (!cb.dataset || cb.dataset.sw == null) return;
    var it = cur.items[Number(cb.dataset.sw)], k = planKey(it);
    mem.plan = mem.plan.filter(function (x) { return x.key !== k; });
    if (cb.checked) { mem.plan.push(stamp({ key: k, name: it.en || it.raw, from: it.price, altPrice: it.altPrice, alt: it.alt || "cheaper option", save: it.save })); delete mem.tomb.plan[k]; }
    else mem.tomb.plan[k] = Date.now();
    persist();
    cb.closest(".swap").classList.toggle("on", cb.checked);
    renderPickTotal(); renderPlan(); renderBudget();
  });
  function renderPlan() {
    $("planCard").hidden = !mem.plan.length;
    $("planList").innerHTML = mem.plan.map(function (x, i) {
      return '<li><span>' + esc(x.name) + '<span class="sub">' + esc(x.alt) + ' · ~' + eur(x.altPrice) + ' instead of ' + eur(x.from) + '</span></span><span class="amt">−' + eur(x.save) + '</span><button class="del" type="button" data-plan="' + i + '" aria-label="Remove from plan">×</button></li>';
    }).join("");
    var per = planPerShop();
    $("planSum").textContent = "Saves about " + eur(per) + " per shop";
    $("planMonth").textContent = eur(per * 4.3, 0) + " / month";
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
    var budget = Number(mem.budget) || 0, spent = spentSaved(), t = itemTotal(), s = itemSave(), after = r2(spent + t);
    var out = [], pace = pacing(after, budget);
    var usedPct = budget ? Math.round(after / budget * 100) : 0, timePct = Math.round(day / daysInMonth * 100);
    out.push({ cls: pace.cls, ic: pace.cls === "good" ? "✓" : "!", html: "With this receipt you’ve used <strong>" + eur(after) + "</strong> of your " + eur(budget, 0) + " budget (" + usedPct + "%), and " + timePct + "% of " + monthName + " has passed." });
    var weekly = r2(t * 4.3), wgap = r2(weekly - budget);
    out.push({ cls: wgap > 0 ? "bad" : "good", ic: "→", html: "If you shop like this every week, that’s about <strong>" + eur(weekly, 0) + " a month</strong> — " + (wgap > 0 ? "<strong>" + eur(wgap, 0) + " over</strong> your budget." : eur(-wgap, 0) + " under your budget.") });
    var first = monthReceipts().reduce(function (m, r) { return Math.min(m, new Date(r.at).getDate()); }, day);
    if (first <= 5 && day >= 7 && after > 0) {
      var proj = r2(after / day * daysInMonth), gap = r2(proj - budget);
      out.push({ cls: gap > 0 ? "bad" : "good", ic: "≈", html: "At your pace so far you’ll spend about <strong>" + eur(proj, 0) + "</strong> by the end of " + monthName + " — " + (gap > 0 ? "<strong>" + eur(gap, 0) + " over</strong> budget." : eur(-gap, 0) + " under budget.") });
    }
    var wk = r2(budget * 7 / daysInMonth);
    if (budget > 0) out.push({ cls: t > wk ? "bad" : (t > wk * 0.8 ? "warn" : "good"), ic: "7", html: "Your weekly allowance is about <strong>" + eur(wk, 0) + "</strong>. This shop used <strong>" + Math.round(t / wk * 100) + "%</strong> of it" + (s > 0 ? " — " + Math.round((t - s) / wk * 100) + "% with the swaps." : ".") });
    var left = r2(budget - after), daysLeft = daysInMonth - day + 1;
    if (left > 0) out.push({ cls: "", ic: "÷", html: "To stay within budget you can spend about <strong>" + eur(left / daysLeft) + " a day</strong> (" + eur(left / daysLeft * 7, 0) + " a week) for the rest of " + monthName + "." });
    else out.push({ cls: "bad", ic: "!", html: "You’re " + eur(-left) + " over this month’s budget. Swapping to store brands and shopping at Aldi or Lidl for staples is the quickest way to cut back." });
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
      $("stageSub").textContent = (useAi ? "The AI model is reading every line… " : "Reading the text… ") + s + " s" + (useAi && s >= 15 ? " · the first scan can take up to a minute" : "");
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
        return r.json().catch(function () { return { error: "server", message: "The server sent an answer that couldn’t be read (HTTP " + r.status + ")." }; })
          .then(function (j) { if (!r.ok || j.error) throw { code: j.error || "server", message: j.message || ("HTTP " + r.status) }; return j; });
      }, function (e) {
        if (e && e.name === "AbortError" && !late) throw e;
        throw { code: late ? "timeout" : "network", message: late ? "The server took too long. Try again, or use the quick reader." : "The Bonwise server couldn’t be reached. Check your connection and try again." };
      })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  function run(path, payload, label) {
    pendingPayload = { path: path, payload: payload };
    setBusy(true);
    setStage(label, "", 0.2);
    startTimer(payload.useAi !== false && health && health.aiReader);
    return post(path, payload).then(function (res) {
      stopTimer(); setBusy(false);
      buildReceipt(res.receipt);
      var gap = cur.printedTotal != null ? r2(itemTotal() - cur.printedTotal) : 0;
      if (Math.abs(gap) >= 0.01) aiState("Check this receipt: the prices read add up to " + eur(itemTotal()) + ", but the receipt total is " + eur(cur.printedTotal) + ". Compare the prices below with your receipt and correct the wrong line (tap a price to edit it)." + (res.notice ? " " + res.notice : ""), "fail");
      else if (res.notice) aiState(res.notice, "fail");
      else if (res.receipt.reader === "ai" || res.receipt.reader === "ai-text") aiState("✓ Read by " + String(res.receipt.model).split("/").pop() + " in " + res.receipt.seconds + " s.", "ok");
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      stopTimer(); setBusy(false);
      $("progress").hidden = true;
      showErr((e && e.message) || "Something went wrong. Try again.");
      if (e && (e.code === "ocr_failed" || e.code === "no_items")) $("pasteBox").hidden = false;
    });
  }

  function buildReceipt(r) {
    showErr("");
    cur = { store: r.store, date: r.date, printedTotal: r.total, reader: r.reader, model: r.model || "", foreign: !!r.foreign, currency: r.currency, items: r.items };
    $("progress").hidden = true;
    renderReceipt();
    var tips = (r.tips || []).filter(Boolean).slice(0, 3);
    $("aiLabel").textContent = "AI tips for this shop";
    $("aiTips").innerHTML = tips.map(function (t) { return "<li>" + esc(String(t).slice(0, 300)) + "</li>"; }).join("");
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
    if (!/^image\//.test(file.type)) { showErr("That isn’t an image. Choose a JPEG or PNG photo of the receipt."); return; }
    // A new receipt replaces the last one: clear results, messages and the price search.
    closeReceipt(); showErr(""); aiState("");
    $("thumb").src = URL.createObjectURL(file);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setBusy(true);
    toJpeg(file).then(function (b64) {
      return run("/api/scan", { image: b64, mediaType: "image/jpeg", context: context() }, "Reading your receipt…");
    }).catch(function () { setBusy(false); showErr("That photo couldn’t be opened. Try a JPEG or PNG."); });
  }

  $("skipAi").addEventListener("click", function () {
    if (!pendingPayload) return;
    if (ctl) ctl.abort();
    var p = Object.assign({}, pendingPayload.payload, { useAi: false });
    run(pendingPayload.path, p, "Reading with the quick reader…");
  });
  $("pickBtn").addEventListener("click", function () { $("file").click(); });
  $("file").addEventListener("change", function () { scanImage($("file").files[0]); $("file").value = ""; });
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("drag"); }); });
  drop.addEventListener("drop", function (e) { scanImage(e.dataTransfer.files && e.dataTransfer.files[0]); });
  $("sampleBtn").addEventListener("click", function () {
    fetch("/static/sample-receipt.jpg").then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) { scanImage(new File([b], "sample-receipt.jpg", { type: "image/jpeg" })); })
      .catch(function () { showErr("The sample receipt couldn’t be loaded."); });
  });
  $("pasteToggle").addEventListener("click", function () { $("pasteBox").hidden = !$("pasteBox").hidden; if (!$("pasteBox").hidden) $("pasteText").focus(); });
  $("pasteGo").addEventListener("click", function () {
    var t = $("pasteText").value.trim();
    if (!t) { showErr("Paste or type a few lines from the receipt first, e.g. “Butter 250g 2,29”."); return; }
    closeReceipt(); showErr(""); aiState(""); $("thumb").removeAttribute("src");
    run("/api/scan-text", { text: t, context: context() }, "Reading your lines…");
  });

  /* ---------- reader status ---------- */
  function showReader() {
    var pill = $("readerPill"), note = $("readerNote");
    if (!health) { pill.textContent = "Server offline"; pill.className = "pill"; note.textContent = "The Bonwise server isn’t answering. Reload the page in a moment."; return; }
    if (health.aiReader) {
      pill.textContent = "AI reader"; pill.className = "pill ai";
      note.textContent = "Open-source model " + health.models[0].split("/").pop() + " on Hugging Face reads any language.";
    } else {
      pill.textContent = "Backup reader"; pill.className = "pill";
      note.textContent = "The AI isn’t switched on for this server yet, so receipts are read with Tesseract OCR.";
    }
  }
  fetch("/api/health").then(function (r) { return r.json(); }).then(function (h) {
    health = h; showReader();
    if (h.contact) $("feedbackLink").href = "mailto:" + h.contact + "?subject=" + encodeURIComponent("Bonwise feedback");
    else $("feedbackLink").hidden = true;
  })
    .catch(function () { health = null; showReader(); });

  /* ---------- price check: the items on the current receipt ---------- */
  function renderPC() {
    var card = $("pcCard");
    if (!cur) { card.hidden = true; $("pcList").innerHTML = ""; return; }
    var list = cur.items.filter(function (it) { return !it.pfand && it.price != null && it.price > 0; });
    card.hidden = !list.length;
    // Biggest savings first, then items with a known good price, then the rest.
    var rank = function (it) { return it.save > 0 ? 3 : it.market ? 2 : (it.original != null && it.original > it.price) ? 1 : 0; };
    list = list.slice().sort(function (a, b) { return rank(b) - rank(a) || (b.save || 0) - (a.save || 0); });
    $("pcCount").textContent = list.length + " item" + (list.length === 1 ? "" : "s");
    $("pcList").innerHTML = list.map(function (it) {
      var name = esc(it.en || it.raw), amt = "", how;
      if (it.save > 0 && it.altPrice != null) {
        var real = !!(it.market && it.save);
        amt = '−' + eur(it.save) + ' <small style="font-size:13px">(' + Math.round(it.save / it.price * 100) + '%)</small>';
        how = '<s>' + eur(it.price) + '</s> → <span class="to">' + (real ? "" : "~") + eur(it.altPrice) + '</span> · ' + esc(it.alt || "cheaper option") +
          '<span class="src-tag ' + (real ? 'real">Real price' : 'est">Estimate') + '</span>';
      } else if (it.market) {
        how = '✓ Good price: ' + eur(it.price) + '. ' + (it.market.sport ? 'Cheapest online is from ' + eur(it.market.forYours) + ' at ' + esc(it.market.store)
          : esc(it.market.store) + ' charges ' + eur(it.market.forYours) + ' for ' + esc(it.market.yourSize)) + '<span class="src-tag real">Real price</span>';
      } else if (it.original != null && it.original > it.price) {
        how = '✓ Already discounted: <s>' + eur(it.original) + '</s> → ' + eur(it.price) + ' (' + Math.round((1 - it.price / it.original) * 100) + '% off)';
      } else {
        how = 'Paid ' + eur(it.price) + '. No comparison price for this item yet.';
      }
      return '<li class="pc"><span class="nm">' + name + '</span><span class="amt num">' + amt + '</span><span class="how">' + how + '</span></li>';
    }).join("");
    $("pcNote").textContent = "Real prices: ALDI SÜD shelf prices and sneaker offers on günstiger.de / billiger.de, checked " + (marketInfo.checked || "23 Sep 2026") + ". Estimates are typical discounter prices.";
  }
  fetch("/api/prices").then(function (r) { return r.json(); }).then(function (p) { marketInfo = p.market; }).catch(function () {});


  /* =====================================================================
     Phase 1: tabs, receipt vault, reminders, shopping list, shops, household
     ===================================================================== */
  function api(path, body) {
    return fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.error) throw { status: r.status, code: j.error || "server", message: j.message || "The server didn’t answer. Try again." };
          return j;
        });
      }, function () { throw { code: "network", message: "No connection to the Bonwise server. Check your internet and try again." }; });
  }

  /* ---------- tabs ---------- */
  var TABS = ["home", "receipts", "list", "shops", "more"];
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = "home";
    TABS.forEach(function (t) { $("view-" + t).hidden = t !== name; });
    document.querySelectorAll(".tabbar button").forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (name === "list") refreshListPrices();
    window.scrollTo(0, 0);
    try { history.replaceState(null, "", name === "home" ? location.pathname + location.search : "#" + name); } catch (e) {}
  }
  document.querySelector(".tabbar").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab);
  });

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
  function fmtDay(d) { var o = { day: "numeric", month: "short" }; if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return d.toLocaleDateString("en-GB", o); }
  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
  function isoDay(dateStr) { var d = purchaseDate({ date: dateStr, at: Date.now() }); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function inDays(n) { return n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"; }

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
      var what = x.kind === "return" ? "Return window ends " + inDays(x.n) : "Warranty ends " + inDays(x.n);
      var title = (x.kind === "return" ? "Last day to return: " : "Warranty ends: ") + (x.r.store || "receipt");
      return '<li class="' + (x.kind === "return" ? "" : "soft") + '"><span class="ic">' + (x.kind === "return" ? "↩" : "🛡") + '</span>' +
        '<b>' + esc(what) + '</b><span>' + esc(x.r.store || "Receipt") + ' · bought ' + esc(fmtDay(purchaseDate(x.r))) + ' · ' + eur(x.r.total) +
        ' · <a href="' + calLink(title, x.d, "Bonwise reminder for your receipt from " + (x.r.store || "") + " (" + (x.r.date || "") + ").") + '" target="_blank" rel="noopener">Add to calendar</a></span></li>';
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
        var label = mk ? new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "Earlier";
        html += '<li class="mhead"><span>' + esc(label) + '</span><span>' + eur(tot) + '</span></li>';
      }
      var rb = returnBy(r), wu = warrantyUntil(r), tags = [];
      if (r.save > 0) tags.push('<span class="pill2">Could have saved ' + eur(r.save) + '</span>');
      if (rb) {
        var n = daysUntil(rb);
        tags.push(n < 0 ? '<span class="pill2 grey">Return window ended ' + esc(fmtDay(rb)) + '</span>'
          : '<span class="pill2 warn">Return by ' + esc(fmtDay(rb)) + ' (' + inDays(n) + ')</span> <a class="muted" href="' + calLink("Last day to return: " + (r.store || "receipt"), rb, "Bonwise reminder") + '" target="_blank" rel="noopener">Add to calendar</a>');
      }
      if (wu) tags.push('<span class="pill2 grey">Warranty until ' + esc(fmtDay(wu)) + '</span>');
      var lines = (r.items && r.items.length) ? '<ul class="lines">' + r.items.map(function (it) {
        return '<li><span>' + esc(it.n) + '</span><span class="num">' + (it.p == null ? "–" : eur(it.p)) + '</span></li>';
      }).join("") + '</ul>' : '<p class="muted">Items weren’t saved for this receipt (it was added before this update).</p>';
      var retEdit = needsReturn(r) ? '<label class="row2 muted">Return window <input class="field" type="number" min="0" max="365" data-ret="' + esc(r.id) + '" value="' + (r.returnDays == null ? "" : r.returnDays) + '" style="max-width:90px;padding:6px 8px"> days</label>' : "";
      html += '<li><details data-id="' + esc(r.id) + '"' + (openReceipt === r.id ? " open" : "") + '><summary><span class="d">' + esc(r.date || "") + '</span><span class="s">' + esc(r.store || "Receipt") + '</span><span class="num">' + eur(r.total) + '</span></summary>' +
        '<div class="body">' + lines + (tags.length ? '<div class="tags">' + tags.join(" ") + '</div>' : "") + retEdit +
        '<div><button class="linkbtn" type="button" data-del-r="' + esc(r.id) + '" style="color:var(--bad)">' + (delArmed === r.id ? "Tap again to delete" : "Delete receipt") + '</button></div></div></details></li>';
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
      if (best) bp = '<span class="bp">Best: <b>' + eur(best.price) + '</b> at ' + esc(best.where) + (best.note ? ' · ' + esc(best.note) : "") + '</span>';
      else if (p) bp = '<span class="bp">No price yet</span>';
      return '<li class="' + (x.done ? "done" : "") + '"><input type="checkbox" data-li="' + esc(x.id) + '"' + (x.done ? " checked" : "") + ' aria-label="Bought ' + esc(x.name) + '">' +
        '<span><span class="nm">' + esc(x.name) + '</span>' + bp + '</span><button class="del" type="button" data-rm="' + esc(x.id) + '" aria-label="Remove ' + esc(x.name) + '">×</button></li>';
    }).join("");
    $("listTripRow").hidden = !open;
    $("listTotal").textContent = open ? (priced ? "Cheapest known prices: " + eur(r2(total)) + " for " + priced + " of " + open + " item" + (open > 1 ? "s" : "") : open + " item" + (open > 1 ? "s" : "") + " to buy") : "";
    renderAgain(); renderTripChips();
  }
  function bestOf(p) {
    if (!p) return null;
    var c = [];
    if (p.aldi) c.push({ price: p.aldi.price, where: p.aldi.store, note: p.aldi.product });
    if (p.community) c.push({ price: p.community.price, where: p.community.chain, note: "paid by Bonwise users" });
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
    var text = "Shopping list (Bonwise)\n" + open.map(function (x) {
      var b = bestOf(priceCache[listKey(x.name)]);
      return "• " + x.name + (b ? " (" + eur(b.price) + " at " + b.where + ")" : "");
    }).join("\n");
    shareText(text, $("shareList"));
  });
  function shareText(text, btn) {
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    var done = function () { var t = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = t; }, 1500); };
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

  /* ---------- nearby shops ---------- */
  var shopsData = [], shopFilter = "all";
  function renderShops() {
    var list = shopsData.filter(function (x) {
      return shopFilter === "all" || (shopFilter === "disc" && x.discounter) || (shopFilter === "open" && x.open === true) || (shopFilter === "drug" && x.kind === "Drugstore");
    });
    $("shopCount").textContent = shopsData.length ? list.length + " shown" : "";
    $("shops").innerHTML = list.length ? list.map(function (x) {
      var dist = x.distance < 1000 ? x.distance + " m" : (x.distance / 1000).toFixed(1) + " km";
      var open = x.open === true ? '<span class="pill2">Open now</span>' : x.open === false ? '<span class="pill2 grey">Closed now</span>' : "";
      return '<li><span class="nm">' + esc(x.name) + '</span><span class="dist">' + dist + '</span>' +
        '<span class="meta">' + esc(x.kind) + (x.discounter ? ' <span class="pill2 warn">Discounter</span>' : "") + ' ' + open + (x.address ? ' · ' + esc(x.address) : "") + '</span>' +
        (x.hours ? '<span class="meta">' + esc(x.hours) + '</span>' : "") +
        '<a class="go" href="https://www.google.com/maps/dir/?api=1&destination=' + x.lat + "," + x.lon + '" target="_blank" rel="noopener">Directions →</a></li>';
    }).join("") : (shopsData.length ? '<li class="muted">No shops match this filter.</li>' : "");
  }
  $("findShops").addEventListener("click", function () {
    var btn = $("findShops"), err = $("shopErr");
    err.hidden = true;
    if (!navigator.geolocation) { err.hidden = false; err.textContent = "This phone doesn’t share its location with apps."; return; }
    btn.disabled = true; btn.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      var d = new Date(), q = "lat=" + pos.coords.latitude.toFixed(4) + "&lon=" + pos.coords.longitude.toFixed(4) + "&dow=" + ((d.getDay() + 6) % 7) + "&min=" + (d.getHours() * 60 + d.getMinutes());
      btn.textContent = "Looking for shops…";
      api("/api/shops?" + q).then(function (j) {
        shopsData = j.shops || []; $("shopFilter").hidden = !shopsData.length;
        if (!shopsData.length) { err.hidden = false; err.className = "notice warn"; err.textContent = "No shops found within 1.5 km."; }
        renderShops();
      }).catch(function (e) { err.hidden = false; err.className = "notice bad"; err.textContent = e.message; })
        .then(function () { btn.disabled = false; btn.textContent = "Search again"; });
    }, function (e) {
      btn.disabled = false; btn.textContent = "Find shops near me";
      err.hidden = false; err.className = "notice bad";
      err.textContent = e.code === 1 ? "Bonwise isn’t allowed to use your location. Allow location for Bonwise in your phone’s settings, then try again." : "Your location couldn’t be found. Check that location is switched on, then try again.";
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
  function distTxt(m) { return m < 1000 ? m + " m" : (m / 1000).toFixed(1) + " km"; }
  function mapsLink(x) { return "https://www.google.com/maps/dir/?api=1&destination=" + x.lat + "," + x.lon; }
  function openTxt(x) { return x.open === true ? "Open now" : x.open === false ? "Closed now" : ""; }
  function shopName(x) { return x.name || x.brand || "Shop"; }
  function listText(a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  // Where the user's own location comes from: asked for only when they press the button.
  function locate() {
    return new Promise(function (res) {
      if (!navigator.geolocation) return res({ pos: null, why: "This phone doesn’t share its location with apps." });
      navigator.geolocation.getCurrentPosition(function (p) { res({ pos: p }); }, function (e) {
        res({ pos: null, why: e.code === 1 ? "Location is off for Bonwise, so shops near you aren’t compared. Allow location in your phone’s settings to see them." : "Your location couldn’t be found, so shops near you aren’t compared." });
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    });
  }
  function tripLoading(text) { $("tripBody").innerHTML = '<div class="trip-load"><span class="spin" aria-hidden="true"></span><span>' + esc(text) + '</span></div>'; }
  function runTrip(payload, slot) {
    if (tripBusy) return;
    lastTrip = { payload: payload, slot: slot };
    tripBusy = true; $("tripGo").disabled = $("listTrip").disabled = true;
    $(slot).appendChild($("tripCard")); $("tripCard").hidden = false;
    tripLoading("Finding your location…");
    $("tripCard").scrollIntoView({ behavior: "smooth", block: "start" });
    locate().then(function (loc) {
      tripLoading(loc.pos ? "Comparing the shops near you…" : "Looking up prices…");
      var d = new Date(), body = Object.assign({}, payload);
      if (loc.pos) Object.assign(body, { lat: Number(loc.pos.coords.latitude.toFixed(4)), lon: Number(loc.pos.coords.longitude.toFixed(4)), dow: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes() });
      return api("/api/trip", body).then(function (j) { renderTrip(j, loc.why || ""); });
    }).catch(function (e) {
      $("tripBody").innerHTML = '<div class="notice bad" style="margin-top:0">' + esc((e && e.message) || "Something went wrong. Try again.") + '</div>';
    }).then(function () { tripBusy = false; $("tripGo").disabled = $("listTrip").disabled = false; });
  }
  function srcTag(p) { return p.real ? '<span class="src-tag real">Real price</span>' : '<span class="src-tag est">Estimate</span>'; }
  function renderTrip(j, locWhy) {
    tripItems = j.items || [];
    var shops = j.shops || [], best = j.best != null ? shops[j.best] : null, going = j.going != null ? shops[j.going] : null, html = "";
    var n = tripItems.filter(function (it) { return !it.online; }).length;
    if (locWhy) html += '<div class="notice warn" style="margin-top:0;margin-bottom:12px">' + esc(locWhy) + ' Below are the best prices we know.</div>';
    else if (j.notice) html += '<div class="notice warn" style="margin-top:0;margin-bottom:12px">' + esc(j.notice) + (j.retry ? ' <button class="linkbtn" type="button" id="tripRetry">Try again</button>' : "") + '</div>';
    else if (j.located && !best && n) html += '<div class="notice warn" style="margin-top:0;margin-bottom:12px">No shop within 2 km sells everything on this list. See each item below.</div>';
    if (best) {
      var meta = [distTxt(best.distance), openTxt(best), best.address].filter(Boolean).join(" · ");
      var note = "";
      if (j.goingTo && going && going !== best) {
        var diff = r2(going.total - best.total);
        note = diff > 0.05 ? '<p class="bs-note warn">You’re going to ' + esc(j.goingTo) + ': about <b>' + eur(going.total) + '</b> there (' + distTxt(going.distance) + '). ' + esc(shopName(best)) + ' saves you about <b>' + eur(diff) + '</b>.</p>'
          : '<p class="bs-note">' + esc(j.goingTo) + ' costs about the same (' + eur(going.total) + '), so either shop is fine.</p>';
      } else if (j.goingTo && going === best) note = '<p class="bs-note">Good choice: <b>' + esc(j.goingTo) + '</b> is the cheapest shop near you for this list.</p>';
      else if (j.goingTo) note = '<p class="bs-note">There’s no ' + esc(j.goingTo) + ' within 2 km of you.</p>';
      html += '<div class="best-stop"><span class="label">Best stop for your list</span><div class="bs-top"><div><div class="bs-name">' + esc(shopName(best)) + '</div><div class="bs-meta">' + esc(meta) + '</div></div>' +
        '<div class="bs-total num">~' + eur(best.total) + '<small>for ' + (best.priced < n ? best.priced + " of " : "") + n + ' item' + (n === 1 ? "" : "s") + '</small></div></div>' + note +
        '<div class="bs-actions"><a class="btn small" href="' + mapsLink(best) + '" target="_blank" rel="noopener">Directions</a><button class="btn small line" type="button" id="tripSave">Save to my list</button></div></div>';
    } else html += '<div class="bs-actions" style="margin-top:0"><button class="btn small line" type="button" id="tripSave">Save to my list</button></div>';
    if (j.split) {
      var parts = j.split.stops.map(function (st) { return esc(shopName(shops[st.shop])) + " (" + esc(listText(st.items.map(function (i) { return tripItems[i].name; }))) + ")"; });
      html += '<div class="notice ok">Two stops save more: ' + parts.join(" + ") + ' comes to about <b>' + eur(j.split.total) + '</b>, ' + eur(j.split.save) + ' less than one stop.</div>';
    }
    html += '<ul class="titems">' + tripItems.map(function (it) {
      var tq = norm(it.query), tn = norm(it.name);
      var typed = tq.indexOf(tn) < 0 && tn.indexOf(tq) < 0 ? '<span class="typed">“' + esc(it.query) + '”</span>' : "";
      var size = (it.count > 1 ? it.count + " × " : "") + (it.size || "");
      var amt = "", where;
      if (it.online) {
        amt = eur(it.online.price) + '<span class="src-tag real">Real price</span>';
        where = "Cheapest online at <b>" + esc(it.online.shop) + "</b> (" + esc(it.online.src) + "), brand shop " + eur(it.online.list);
      } else if (it.best) {
        var sh = shops[it.best.shop];
        if (it.best.price != null) {
          amt = eur(it.best.price) + srcTag(it.best);
          where = "Cheapest at <b>" + esc(shopName(sh)) + "</b> · " + distTxt(sh.distance) + (it.best.src === "users" ? " · paid by Bonwise users" : it.best.src === "aldi" ? " · ALDI SÜD shelf price" : "");
        } else where = "No price yet · sold at <b>" + esc(shopName(sh)) + "</b> · " + distTxt(sh.distance);
      } else if (it.known) {
        amt = eur(it.known.price) + '<span class="src-tag real">Real price</span>';
        where = "Best known: <b>" + esc(it.known.chain) + "</b>" + (it.known.src === "users" ? " (paid by Bonwise users)" : " (ALDI SÜD shelf price)");
      } else if (it.typical != null) {
        amt = "~" + eur(it.typical) + '<span class="src-tag est">Estimate</span>';
        where = "Usually cheapest at " + esc(it.hint);
      } else where = "No price yet · usually cheapest at " + esc(it.hint);
      return '<li><span class="nm">' + esc(it.name) + (size ? '<small>' + esc(size) + '</small>' : "") + typed + '</span><span class="amt num">' + amt + '</span><span class="where">' + where + '</span></li>';
    }).join("") + '</ul>';
    var others = shops.filter(function (x) { return x.covers > 0; });
    if (others.length > 1) {
      html += '<details class="cmpshops"><summary>Compare ' + others.length + ' shops</summary><ul class="shops">' + others.map(function (x) {
        return '<li><span class="nm">' + esc(shopName(x)) + '</span><span class="tot num">~' + eur(x.total) + '</span>' +
          '<span class="meta">' + distTxt(x.distance) + ' · ' + esc(x.kind) + (openTxt(x) ? ' · ' + openTxt(x) : "") + (x.missing.length ? ' · no ' + esc(listText(x.missing)) : " · has everything") + '</span>' +
          '<a class="go" href="' + mapsLink(x) + '" target="_blank" rel="noopener">Directions →</a></li>';
      }).join("") + '</ul></details>';
    }
    html += '<p class="pc-note">Real price: ALDI SÜD shelf prices (' + esc(j.checked || "") + ') and what Bonwise users paid in the last 90 days. Estimate: the typical price level of that kind of shop. Prices vary by region and change often. Shop data © OpenStreetMap contributors.</p>';
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
    e.target.textContent = "✓ Saved to your list"; e.target.disabled = true;
  });
  $("tripClose").addEventListener("click", function () { $("tripCard").hidden = true; });
  $("tripText").value = store.get("bonwise.tripText", "");
  $("tripForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = $("tripText").value.trim();
    if (!t) { $("tripText").focus(); $("tripText").placeholder = "Type a few things first, e.g. milk, bread"; return; }
    store.set("bonwise.tripText", t);
    $("tripText").blur();
    runTrip({ text: t }, "tripSlotHome");
  });
  $("listTrip").addEventListener("click", function () {
    var open = mem.list.filter(function (x) { return !x.done; }).map(function (x) { return x.name; });
    if (open.length) runTrip({ items: open }, "tripSlotList");
  });
  // Quick picks under the box: the shopping list, and things you buy often.
  function renderTripChips() {
    var open = mem.list.filter(function (x) { return !x.done; }), top = againTop(5), html = "";
    if (open.length) html += '<button type="button" class="use" data-use-list="1">Use my list (' + open.length + ')</button>';
    html += top.map(function (c) { return '<button type="button" data-add="' + esc(c.name) + '">+ ' + esc(c.name) + '</button>'; }).join("");
    $("tripChips").innerHTML = html; $("tripChips").hidden = !html;
  }
  $("tripChips").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.useList) {
      var open = mem.list.filter(function (x) { return !x.done; }).map(function (x) { return x.name; });
      $("tripText").value = open.join(", "); store.set("bonwise.tripText", $("tripText").value);
      runTrip({ items: open }, "tripSlotHome"); return;
    }
    var t = $("tripText").value.trim();
    $("tripText").value = (t ? t.replace(/[,\s]+$/, "") + ", " : "") + b.dataset.add;
    b.remove(); if (!$("tripChips").children.length) $("tripChips").hidden = true;
  });

  /* ---------- simple view ---------- */
  function applySimple() {
    var on = !!mem.settings.simple;
    document.body.classList.toggle("simple", on);
    $("setSimple").checked = on;
    $("simpleToggle").textContent = on ? "Show all details" : "Switch to simple view";
  }
  $("setSimple").addEventListener("change", function () { mem.settings.simple = $("setSimple").checked; persist(); applySimple(); });
  $("simpleToggle").addEventListener("click", function () { mem.settings.simple = !mem.settings.simple; persist(); applySimple(); });

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
    syncing = true; syncLabel("Syncing…");
    return api("/api/household/sync", { code: mem.household.code, state: buildState(), recreate: true }).then(function (j) {
      applyState(j.state);
      syncLabel("Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      if (manual) hhMsg("Everything is up to date.", "ok");
    }).catch(function (e) {
      syncLabel("Not synced"); if (manual) hhMsg(e.message, "bad");
    }).then(function () { syncing = false; if (syncAgain) { syncAgain = false; scheduleSync(); } });
  }
  function joinHousehold(code, isNew) {
    return api("/api/household/sync", { code: code, state: buildState() }).then(function (j) {
      mem.household = { code: code }; store.set("bonwise.household", mem.household);
      applyState(j.state); renderSettings();
      syncLabel("Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      hhMsg(isNew ? "Household created. Share the code with the people you shop with." : "You joined the household. Receipts, list and budget are now shared.", "ok");
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
    if (raw.length !== 12) { hhMsg("A household code looks like BW-XXXX-XXXX-XXXX.", "warn"); return; }
    var code = "BW-" + raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8);
    joinHousehold(code, false).then(function () { $("hhJoinCode").value = ""; }).catch(function (e) { hhMsg(e.message, "bad"); });
  });
  $("hhShare").addEventListener("click", function () {
    shareText("Join my Bonwise household with this code: " + mem.household.code + "\nOpen Bonwise → More → Household sharing → Join.", $("hhShare"));
  });
  $("hhSync").addEventListener("click", function () { syncNow(true); });
  $("hhLeave").addEventListener("click", function () {
    mem.household = null; try { localStorage.removeItem("bonwise.household"); } catch (e) {}
    renderSettings(); syncLabel(""); hhMsg("This phone left the household. Its own copy of your data stays here.", "ok");
  });
  var hhDelArmed = false;
  $("hhDelete").addEventListener("click", function () {
    if (!hhDelArmed) { hhDelArmed = true; $("hhDelete").textContent = "Tap again to delete it from the server"; setTimeout(function () { hhDelArmed = false; $("hhDelete").textContent = "Delete household data"; }, 4000); return; }
    hhDelArmed = false; $("hhDelete").textContent = "Delete household data";
    api("/api/household/delete", { code: mem.household.code }).then(function () {
      mem.household = null; try { localStorage.removeItem("bonwise.household"); } catch (e) {}
      renderSettings(); syncLabel(""); hhMsg("The household’s data was deleted from the server. This phone keeps its own copy.", "ok");
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
