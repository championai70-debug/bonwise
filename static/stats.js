/* Private usage page: daily totals from /api/stats (needs the STATS_KEY). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var COLS = [["open", "App opens"], ["welcome", "Landing page"], ["trip", "List searches"], ["shops", "Shop searches"], ["scan.photo", "Photo scans"],
    ["scan.text", "Text scans"], ["reader.ai", "Read by AI"], ["scan.fail", "Failed scans"], ["list.prices", "List price checks"],
    ["prices.report", "Receipts shared"], ["household.new", "New households"], ["limit.429", "Hit a limit"], ["error.5xx", "Server errors"]];
  function load(key) {
    $("msg").hidden = true;
    fetch("/api/stats", { method: "POST", headers: { "content-type": "application/json", "X-Stats-Key": key }, body: "{}" })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); })
      .then(function (j) { try { sessionStorage.setItem("bw.stats", key); } catch (e) {} show(j.days || {}); })
      .catch(function (e) { $("msg").hidden = false; $("msg").textContent = (e && e.message) || "Couldn’t load the numbers."; });
  }
  function show(days) {
    var list = Object.keys(days).sort().reverse(), sum = {}, langs = {};
    var rows = list.map(function (d) {
      Object.keys(days[d]).forEach(function (k) {
        if (k.indexOf("lang.") === 0) langs[k.slice(5)] = (langs[k.slice(5)] || 0) + days[d][k];
      });
      return "<tr><td>" + d + "</td>" + COLS.map(function (c) {
        var n = days[d][c[0]] || 0; sum[c[0]] = (sum[c[0]] || 0) + n; return "<td>" + n + "</td>";
      }).join("") + "</tr>";
    });
    $("out").hidden = false;
    $("out").innerHTML = list.length ? "<table><thead><tr><th>Day</th>" + COLS.map(function (c) { return "<th>" + c[1] + "</th>"; }).join("") + "</tr></thead><tbody>" +
      '<tr class="sum"><td>Last ' + list.length + " days</td>" + COLS.map(function (c) { return "<td>" + (sum[c[0]] || 0) + "</td>"; }).join("") + "</tr>" +
      rows.join("") + "</tbody></table>" : "<p>No numbers yet.</p>";
    var l = Object.keys(langs).sort(function (a, b) { return langs[b] - langs[a]; });
    $("langs").textContent = l.length ? "App language (opens): " + l.map(function (k) { return k + " " + langs[k]; }).join(" · ") : "";
  }
  $("f").addEventListener("submit", function (e) { e.preventDefault(); load($("key").value.trim()); });
  try { var k = sessionStorage.getItem("bw.stats"); if (k) { $("key").value = k; load(k); } } catch (e) {}
})();
