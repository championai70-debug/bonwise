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
  var mem = { budget: store.get("bonwise.budget", 300), receipts: store.get("bonwise.receipts", []), plan: store.get("bonwise.plan", []) };

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
    mem.budget = v; store.set("bonwise.budget", v); renderBudget(); if (cur) renderRecs();
  });

  /* ---------- history ---------- */
  function renderHistory() {
    var list = monthReceipts().slice().sort(function (a, b) { return b.at - a.at; });
    $("histEmpty").hidden = list.length > 0;
    $("hist").innerHTML = list.map(function (r) {
      return '<li><span class="d">' + esc(r.date || "") + '</span><span class="s">' + esc(r.store || "Receipt") + '</span><span class="num">' + eur(r.total) + '</span><button class="del" type="button" data-id="' + esc(r.id) + '" aria-label="Remove receipt">×</button></li>';
    }).join("");
  }
  $("hist").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-id]"); if (!b) return;
    mem.receipts = mem.receipts.filter(function (r) { return r.id !== b.dataset.id; });
    store.set("bonwise.receipts", mem.receipts); renderHistory(); renderBudget(); if (cur) renderRecs();
  });
  var wipeArmed = false;
  $("wipeBtn").addEventListener("click", function () {
    if (!wipeArmed) { wipeArmed = true; $("wipeBtn").textContent = "Tap again: delete all receipts and the savings plan"; setTimeout(function () { wipeArmed = false; $("wipeBtn").textContent = "Start fresh"; }, 4000); return; }
    wipeArmed = false; $("wipeBtn").textContent = "Start fresh";
    mem.receipts = []; mem.plan = []; store.set("bonwise.receipts", []); store.set("bonwise.plan", []);
    closeReceipt(); showErr(""); aiState(""); $("thumb").removeAttribute("src");
    renderHistory(); renderPlan(); renderBudget();
  });
  var resetArmed = false;
  $("resetBtn").addEventListener("click", function () {
    if (!resetArmed) { resetArmed = true; $("resetBtn").textContent = "Tap again to clear"; setTimeout(function () { resetArmed = false; $("resetBtn").textContent = "Clear month"; }, 3000); return; }
    mem.receipts = mem.receipts.filter(function (r) { return r.month !== monthKey; });
    store.set("bonwise.receipts", mem.receipts); resetArmed = false; $("resetBtn").textContent = "Clear month";
    renderHistory(); renderBudget(); if (cur) renderRecs();
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
    mem.receipts.push({ id: String(Date.now()), at: Date.now(), month: monthKey, date: cur.date || now.toLocaleDateString("de-DE"), store: cur.store || "Receipt", total: itemTotal(), save: itemSave() });
    store.set("bonwise.receipts", mem.receipts);
    closeReceipt(); aiState(""); $("thumb").removeAttribute("src");
  });
  $("discardBtn").addEventListener("click", function () { closeReceipt(); aiState(""); });
  $("clearBtn").addEventListener("click", function () { closeReceipt(); aiState(""); showErr(""); $("thumb").removeAttribute("src"); window.scrollTo({ top: 0, behavior: "smooth" }); });
  function closeReceipt() {
    cur = null;
    if (ctl) { ctl.abort(); ctl = null; }
    stopTimer(); setBusy(false);
    ["receiptCard", "saveCard", "swapCard", "recCard", "progress", "pcCard"].forEach(function (id) { $(id).hidden = true; });
    $("pcList").innerHTML = "";
    renderHistory(); renderBudget();
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
    if (cb.checked) mem.plan.push({ key: k, name: it.en || it.raw, from: it.price, altPrice: it.altPrice, alt: it.alt || "cheaper option", save: it.save });
    store.set("bonwise.plan", mem.plan);
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
    mem.plan.splice(Number(b.dataset.plan), 1); store.set("bonwise.plan", mem.plan);
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
  fetch("/api/health").then(function (r) { return r.json(); }).then(function (h) { health = h; showReader(); })
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

  renderBudget(); renderHistory(); renderPlan();

  // Installable app: the service worker adds an offline page and lets Android install Bonwise.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
})();
