// The browser page for /db. Inlined rather than served from a file so the endpoint has no
// static-asset dependency and cannot drift from the routes it calls.
const DB_BROWSER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenPostings DB</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #f6f8fa; color: #1f2933; }
  @media (prefers-color-scheme: dark) { body { background: #10151b; color: #dbe2ea; } }
  header { padding: 14px 18px; border-bottom: 1px solid #d3dae2; display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  @media (prefers-color-scheme: dark) { header { border-color: #26313d; } }
  h1 { font-size: 15px; margin: 0; font-weight: 650; }
  .muted { color: #66798c; font-size: 12px; }
  @media (prefers-color-scheme: dark) { .muted { color: #8b9cb0; } }
  nav { display: flex; gap: 6px; padding: 12px 18px 0; flex-wrap: wrap; }
  nav button { border: 1px solid #c6ceda; background: #fff; color: inherit; border-radius: 999px;
               padding: 6px 14px; cursor: pointer; font: inherit; }
  nav button[aria-selected="true"] { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  @media (prefers-color-scheme: dark) { nav button { background: #18202a; border-color: #2d3947; } }
  main { padding: 14px 18px 40px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  input[type=search], textarea, select {
    font: inherit; padding: 8px 10px; border: 1px solid #c6ceda; border-radius: 8px;
    background: #fff; color: inherit; }
  @media (prefers-color-scheme: dark) { input[type=search], textarea, select { background: #18202a; border-color: #2d3947; } }
  input[type=search] { min-width: 260px; flex: 1; }
  textarea { width: 100%; min-height: 110px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  button.go { border: 1px solid #1f6feb; background: #1f6feb; color: #fff; border-radius: 8px;
              padding: 8px 16px; cursor: pointer; font: inherit; }
  .scroller { overflow-x: auto; border: 1px solid #d3dae2; border-radius: 10px; background: #fff; }
  @media (prefers-color-scheme: dark) { .scroller { background: #141c24; border-color: #26313d; } }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e6ebf1; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { th, td { border-color: #222c37; } }
  th { position: sticky; top: 0; background: #eef2f6; font-weight: 600; }
  @media (prefers-color-scheme: dark) { th { background: #1b242e; } }
  td.wrap { white-space: normal; max-width: 460px; }
  tr:hover td { background: #f2f6fa; }
  @media (prefers-color-scheme: dark) { tr:hover td { background: #1a232d; } }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .ok { background: #d7f5dd; color: #10683a; }
  .none { background: #ffe0e0; color: #93202a; }
  .warn { background: #ffeccc; color: #8a5300; }
  .err { color: #b3261e; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; margin: 10px 0; }
  footer { padding: 0 18px 30px; }
  .hint { font-size: 12px; color: #66798c; margin: 8px 0; }
  .examples button { background: none; border: none; color: #1f6feb; cursor: pointer; font: inherit;
                     padding: 0; text-decoration: underline; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>OpenPostings DB</h1>
  <span class="muted" id="dbmeta">read-only</span>
</header>
<nav>
  <button id="tab-companies" aria-selected="true">Companies</button>
  <button id="tab-postings" aria-selected="false">Postings</button>
  <button id="tab-sql" aria-selected="false">SQL</button>
</nav>
<main>
  <section id="panel-companies">
    <div class="row">
      <input type="search" id="company-q" placeholder="Company name or URL, e.g. booking">
      <button class="go" id="company-go">Search</button>
    </div>
    <p class="hint">Shows tracked employers whether or not they have anything visible &mdash; the listing can only show the ones that do.</p>
    <div id="company-out"></div>
  </section>

  <section id="panel-postings" hidden>
    <div class="row">
      <input type="search" id="posting-q" placeholder="Company, title or location">
      <select id="posting-state">
        <option value="visible">Visible only</option>
        <option value="hidden">Hidden only</option>
        <option value="all">All</option>
      </select>
      <button class="go" id="posting-go">Search</button>
    </div>
    <div id="posting-out"></div>
  </section>

  <section id="panel-sql" hidden>
    <textarea id="sql" spellcheck="false">SELECT company_name, COUNT(*) AS n
FROM Postings
WHERE hidden = 0 AND location LIKE '%Seattle%'
GROUP BY company_name
ORDER BY n DESC</textarea>
    <div class="row" style="margin-top:8px">
      <button class="go" id="sql-go">Run</button>
      <span class="hint examples">
        try:
        <button data-sql="SELECT hidden, COUNT(*) AS n FROM Postings GROUP BY hidden">visible vs hidden</button> &middot;
        <button data-sql="SELECT ATS_name, COUNT(*) AS companies FROM companies GROUP BY ATS_name ORDER BY companies DESC">companies per ATS</button> &middot;
        <button data-sql="SELECT location, COUNT(*) AS n FROM Postings WHERE hidden = 0 AND location IS NOT NULL AND TRIM(location) <> '' GROUP BY location ORDER BY n DESC">top locations</button>
      </span>
    </div>
    <div id="sql-out"></div>
  </section>
</main>
<footer>
  <p class="hint">
    SELECT only, on a read-only connection, capped at <span id="maxrows">500</span> rows and 15s.
    Settings tables holding credentials are not readable here. This page is served by the API,
    which listens on every interface &mdash; anyone who can reach this host can read it.
  </p>
</footer>
<script>
(function () {
  var TABS = ["companies", "postings", "sql"];
  function show(name) {
    TABS.forEach(function (t) {
      document.getElementById("tab-" + t).setAttribute("aria-selected", String(t === name));
      document.getElementById("panel-" + t).hidden = t !== name;
    });
  }
  TABS.forEach(function (t) {
    document.getElementById("tab-" + t).addEventListener("click", function () { show(t); });
  });

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function when(epoch) {
    var n = Number(epoch);
    if (!n) return "never";
    return new Date(n * 1000).toISOString().replace("T", " ").slice(0, 16);
  }
  function table(rows, render) {
    if (!rows.length) return '<p class="hint">No rows.</p>';
    var cols = render ? null : Object.keys(rows[0]);
    var head = render ? render.head : cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
    var body = rows.map(function (r) {
      return "<tr>" + (render ? render.row(r) : cols.map(function (c) {
        return '<td class="wrap">' + esc(r[c]) + "</td>";
      }).join("")) + "</tr>";
    }).join("");
    return '<div class="scroller"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  function fail(el, message) {
    document.getElementById(el).innerHTML = '<p class="err">' + esc(message) + "</p>";
  }
  function get(url) {
    return fetch(url).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body && body.error ? body.error : "HTTP " + r.status);
        return body;
      });
    });
  }

  function loadCompanies() {
    var q = document.getElementById("company-q").value;
    document.getElementById("company-out").innerHTML = '<p class="hint">Loading&hellip;</p>';
    get("/db/companies?q=" + encodeURIComponent(q)).then(function (data) {
      document.getElementById("company-out").innerHTML = table(data.items, {
        head: "<th>company</th><th>ATS</th><th>postings</th><th>visible</th><th>last synced</th><th>url</th>",
        row: function (r) {
          var pill = r.total === 0
            ? '<span class="pill none">none stored</span>'
            : (r.visible === 0 ? '<span class="pill warn">all hidden</span>' : '<span class="pill ok">' + r.visible + " visible</span>");
          return "<td>" + esc(r.company_name) + "</td><td>" + esc(r.ATS_name) + "</td><td>" + r.total +
            "</td><td>" + pill + "</td><td>" + when(r.last_seen_epoch) + '</td><td class="wrap">' + esc(r.url_string) + "</td>";
        }
      });
    }).catch(function (e) { fail("company-out", e.message); });
  }

  function loadPostings() {
    var q = document.getElementById("posting-q").value;
    var state = document.getElementById("posting-state").value;
    document.getElementById("posting-out").innerHTML = '<p class="hint">Loading&hellip;</p>';
    get("/db/postings?q=" + encodeURIComponent(q) + "&state=" + encodeURIComponent(state)).then(function (data) {
      document.getElementById("posting-out").innerHTML = table(data.items, {
        head: "<th>company</th><th>position</th><th>location</th><th>posted</th><th>state</th><th>first seen</th><th>last seen</th>",
        row: function (r) {
          return "<td>" + esc(r.company_name) + '</td><td class="wrap">' + esc(r.position_name) +
            "</td><td>" + esc(r.location) + "</td><td>" + esc(r.posting_date) + "</td><td>" +
            (r.hidden ? '<span class="pill warn">hidden</span>' : '<span class="pill ok">visible</span>') +
            "</td><td>" + when(r.first_seen_epoch) + "</td><td>" + when(r.last_seen_epoch) + "</td>";
        }
      });
    }).catch(function (e) { fail("posting-out", e.message); });
  }

  function runSql() {
    var sql = document.getElementById("sql").value;
    document.getElementById("sql-out").innerHTML = '<p class="hint">Running&hellip;</p>';
    fetch("/db/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: sql })
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body && body.error ? body.error : "HTTP " + r.status);
        return body;
      });
    }).then(function (data) {
      var note = data.truncated ? '<p class="hint">Showing the first ' + data.rows.length + " rows.</p>" : "";
      document.getElementById("sql-out").innerHTML = note + table(data.rows);
    }).catch(function (e) { fail("sql-out", e.message); });
  }

  document.getElementById("company-go").addEventListener("click", loadCompanies);
  document.getElementById("company-q").addEventListener("keydown", function (e) { if (e.key === "Enter") loadCompanies(); });
  document.getElementById("posting-go").addEventListener("click", loadPostings);
  document.getElementById("posting-q").addEventListener("keydown", function (e) { if (e.key === "Enter") loadPostings(); });
  document.getElementById("sql-go").addEventListener("click", runSql);
  Array.prototype.forEach.call(document.querySelectorAll(".examples button"), function (b) {
    b.addEventListener("click", function () { document.getElementById("sql").value = b.getAttribute("data-sql"); runSql(); });
  });

  loadCompanies();
})();
</script>
</body>
</html>`;

module.exports = { DB_BROWSER_PAGE };
