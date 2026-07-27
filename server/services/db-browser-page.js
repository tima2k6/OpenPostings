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
  .plist { list-style: none; margin: 0; padding: 0; border: 1px solid #d3dae2; border-radius: 10px;
           overflow: hidden; background: #fff; }
  @media (prefers-color-scheme: dark) { .plist { background: #141c24; border-color: #26313d; } }
  .pitem { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "title side" "meta side";
           gap: 1px 12px; padding: 10px 12px; border-bottom: 1px solid #e6ebf1; }
  @media (prefers-color-scheme: dark) { .pitem { border-color: #222c37; } }
  .pitem:last-child { border-bottom: none; }
  .pitem:hover { background: #f2f6fa; }
  @media (prefers-color-scheme: dark) { .pitem:hover { background: #1a232d; } }
  .ptitle { grid-area: title; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  .ptitle:hover { text-decoration: underline; }
  .pmeta { grid-area: meta; font-size: 12px; color: #66798c; overflow-wrap: anywhere; }
  @media (prefers-color-scheme: dark) { .pmeta { color: #8b9cb0; } }
  .pco { font-weight: 500; }
  .psep { opacity: .5; }
  .pside { grid-area: side; display: flex; flex-direction: column; align-items: flex-end;
           justify-content: center; gap: 2px; white-space: nowrap; }
  .ppay { font-size: 13px; font-weight: 600; }
  .page { font-size: 11px; color: #7b8794; }
  .adv { margin-bottom: 10px; }
  .adv > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: #52606d;
                   padding: 6px 0; list-style-position: inside; }
  @media (prefers-color-scheme: dark) { .adv > summary { color: #9fb0c4; } }
  .facet-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
               gap: 10px; margin: 10px 0 14px; }
  .facet-pick { display: flex; flex-direction: column; gap: 4px; }
  .facet-name { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
                color: #7b8794; }
  .facet-name .n { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: .75; }
  .facet-pick select { width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #52606d; }
  @media (prefers-color-scheme: dark) { .grid label { color: #9fb0c4; } }
  .grid input, .grid select { width: 100%; }
  pre { overflow-x: auto; background: #eef2f6; padding: 10px; border-radius: 8px; font-size: 12px; }
  @media (prefers-color-scheme: dark) { pre { background: #1b242e; } }
  button.saved, button.saved-x, #posting-clear, #posting-save, #posting-sql {
    border: 1px solid #c6ceda; background: #fff; color: inherit; border-radius: 8px;
    padding: 7px 12px; cursor: pointer; font: inherit; font-size: 13px; }
  @media (prefers-color-scheme: dark) { button.saved, button.saved-x, #posting-clear, #posting-save, #posting-sql { background: #18202a; border-color: #2d3947; } }
  a { color: #1f6feb; }
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
    <details class="adv">
      <summary>Filters (edit by hand)</summary>
    <div class="grid">
      <label>Title has <b>any</b> of<input id="f-title-any" placeholder="manager, director, head of"></label>
      <label>Title has <b>all</b> of<input id="f-title-all" placeholder="operations"></label>
      <label>Title has <b>none</b> of<input id="f-title-none" placeholder="assistant, shift, intern"></label>
      <label>Company <b>any</b><input id="f-company-any" placeholder="hilton, marriott"></label>
      <label>Company <b>none</b><input id="f-company-none" placeholder="staffing, temp"></label>
      <label>State <b>(exact)</b><input id="f-states" placeholder="WA, OR"></label>
      <label>Location text <b>any</b><input id="f-loc-any" placeholder="Seattle, Bellevue"></label>
      <label>Location <b>none</b><input id="f-loc-none" placeholder="DC, remote"></label>
      <label>Pay at least<input id="f-pay-min" type="number" placeholder="140000"></label>
      <label>Pay at most<input id="f-pay-max" type="number" placeholder=""></label>
      <label>Still listed within (days)<input id="f-seen" type="number" placeholder="5"></label>
      <label>First found within (days)<input id="f-found" type="number" placeholder=""></label>
      <label>Show<select id="f-vis">
        <option value="all">All rows</option>
        <option value="visible">Visible in app</option>
        <option value="hidden">Hidden from app</option>
      </select></label>
      <label>Sort by<select id="f-sort">
        <option value="last_seen">Last seen</option>
        <option value="first_seen">First found</option>
        <option value="pay">Pay</option>
        <option value="company">Company</option>
        <option value="position">Position</option>
        <option value="location">Location</option>
        <option value="posted">Posted date</option>
      </select></label>
      <label>Direction<select id="f-dir"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
      <label>ATS<input id="f-ats" placeholder="workday, greenhouse"></label>
      <label>Max rows<input id="f-limit" type="number" value="200"></label>
    </div>
    </details>
    <p class="hint">Terms are comma-separated. Within a box they are OR-ed; each box is AND-ed with the others &mdash; so <em>any</em>=manager,director with <em>none</em>=assistant gives (manager OR director) AND NOT assistant. Only <b>All rows</b> shows postings the app is currently hiding. <b>State</b> uses real state matching &mdash; "WA" will not match Warwick or Sweetwater the way a location-text search does.</p>
    <div class="row">
      <button class="go" id="posting-go">Run</button>
      <button id="posting-clear">Clear</button>
      <button id="posting-save">Save this query</button>
      <button id="posting-sql">Show SQL</button>
      <span id="posting-count" class="hint"></span>
    </div>
    <div class="row" id="saved-row"></div>
    <pre id="posting-sqlout" hidden></pre>
    <div id="facet-out"></div>
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
  // Opening the Postings tab used to show an empty form: the facets that make it useful
  // only appeared after clicking Run, which reads as "the feature is not there". The first
  // visit runs the current (empty) filter set so the breakdown is on screen immediately.
  var ranPostings = false;
  TABS.forEach(function (t) {
    document.getElementById("tab-" + t).addEventListener("click", function () {
      show(t);
      if (t === "postings" && !ranPostings) { ranPostings = true; run(); }
    });
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

  var FIELDS = {
    "f-title-any": "title_any", "f-title-all": "title_all", "f-title-none": "title_none",
    "f-company-any": "company_any", "f-company-none": "company_none",
    "f-states": "states", "f-loc-any": "location_any", "f-loc-none": "location_none",
    "f-pay-min": "pay_min", "f-pay-max": "pay_max",
    "f-seen": "seen_days", "f-found": "found_days",
    "f-ats": "ats", "f-vis": "visibility", "f-sort": "sort", "f-dir": "dir", "f-limit": "limit"
  };

  function readFilters() {
    var out = {};
    Object.keys(FIELDS).forEach(function (id) {
      var v = document.getElementById(id).value;
      if (v !== "" && v !== null) out[FIELDS[id]] = v;
    });
    return out;
  }
  function writeFilters(state) {
    Object.keys(FIELDS).forEach(function (id) {
      document.getElementById(id).value = state[FIELDS[id]] === undefined ? "" : state[FIELDS[id]];
    });
  }
  // "3d" carries the same signal as a full timestamp here and costs a tenth of the width.
  function ago(epoch) {
    var n = Number(epoch);
    if (!n) return "";
    var secs = Math.max(0, Math.floor(Date.now() / 1000) - n);
    if (secs < 3600) return Math.floor(secs / 60) + "m";
    if (secs < 86400) return Math.floor(secs / 3600) + "h";
    return Math.floor(secs / 86400) + "d";
  }

  // A list rather than a table: nine nowrap columns guaranteed horizontal scrolling, and
  // two of them were full ISO timestamps. Each posting is one block that reflows, so the
  // same markup reads on a phone and on a desktop.
  function postingList(rows) {
    if (!rows.length) return '<p class="hint">No rows.</p>';
    return '<ul class="plist">' + rows.map(function (r) {
      var pay = money(r);
      return '<li class="pitem">' +
        '<a class="ptitle" href="' + esc(r.job_posting_url) + '" target="_blank" rel="noopener">' +
          esc(r.position_name || "Untitled") + "</a>" +
        '<div class="pmeta">' +
          (r.hidden ? '<span class="pill warn">hidden</span> ' : "") +
          '<span class="pco">' + esc(r.company_name) + "</span>" +
          (r.location ? ' <span class="psep">\u00b7</span> ' + esc(r.location) : "") +
        "</div>" +
        '<div class="pside">' +
          (pay ? '<span class="ppay">' + esc(pay) + "</span>" : "") +
          '<span class="page" title="last seen">' + ago(r.last_seen_epoch) + "</span>" +
        "</div>" +
      "</li>";
    }).join("") + "</ul>";
  }

  function money(r) {
    var lo = r.pay_min, hi = r.pay_max;
    if (!lo && !hi) return "";
    var k = function (n) { return n >= 1000 ? Math.round(n / 1000) + "k" : String(n); };
    return (lo && hi && lo !== hi) ? k(lo) + "-" + k(hi) : k(hi || lo);
  }

  function loadPostings() {
    var params = new URLSearchParams(readFilters()).toString();
    document.getElementById("posting-out").innerHTML = '<p class="hint">Running&hellip;</p>';
    get("/db/search?" + params).then(function (data) {
      document.getElementById("posting-count").textContent =
        (data.approximate ? "at least " : "") + data.total + " matched \u00b7 " + data.visible +
        " visible, " + (data.total - data.visible) + " hidden \u00b7 showing " + data.shown;
      document.getElementById("posting-sqlout").textContent = data.sql;
      document.getElementById("posting-out").innerHTML = postingList(data.rows);
    }).catch(function (e) { fail("posting-out", e.message); });
  }

  // Clicking a facet must NARROW the set, which is why title words go to title_all (AND)
  // rather than title_any (OR): adding a word to an OR group would widen it.
  function addTerm(id, value, replace) {
    var el = document.getElementById(id);
    var existing = el.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    if (replace) { el.value = value; return; }
    if (existing.indexOf(value) === -1) existing.push(value);
    el.value = existing.join(", ");
  }

  var FACET_TARGET = {
    states: { id: "f-states", replace: false },
    title_words: { id: "f-title-all", replace: false },
    companies: { id: "f-company-any", replace: true },
    ats: { id: "f-ats", replace: true }
  };
  var FACET_LABEL = { states: "State", title_words: "Title contains", companies: "Company", ats: "ATS" };

  function wireFacetSelects(out) {
    Array.prototype.forEach.call(out.querySelectorAll("select[data-facet]"), function (sel) {
      sel.addEventListener("change", function () {
        if (!sel.value) return;
        var t = FACET_TARGET[sel.getAttribute("data-facet")];
        addTerm(t.id, sel.value, t.replace);
        run();
      });
    });
  }

  function loadFacets() {
    var params = new URLSearchParams(readFilters()).toString();
    get("/db/facets?" + params).then(function (data) {
      var out = document.getElementById("facet-out");

      // State is always offered, from the fixed list of 51 rather than from counts: it is
      // the primary axis, and it has to be selectable before anything has been narrowed.
      var stateOptions = '<label class="facet-pick"><span class="facet-name">State</span>' +
        '<select data-facet="states"><option value="">\u2014 any \u2014</option>' +
        (data.all_states || []).map(function (st) {
          return '<option value="' + esc(st.value) + '">' + esc(st.value) + "</option>";
        }).join("") + "</select></label>";

      if (data.needs_narrowing) {
        out.innerHTML =
          '<p class="hint"><b>' + data.total.toLocaleString() + " rows.</b> Company and title breakdowns " +
          "are only shown once the set is small enough to count exactly \u2014 over a set this size they " +
          "would describe a fraction of it and read as if they described all of it. Pick a state, or add a " +
          "title or date filter, and they appear.</p>" +
          '<div class="facet-row">' + stateOptions + "</div>";
        wireFacetSelects(out);
        return;
      }

      var summary = '<p class="hint">' + data.total.toLocaleString() + " rows, counted exactly \u00b7 " +
        data.visible + " visible, " + data.hidden + " hidden \u00b7 " +
        data.with_pay + " with a pay figure</p>";
      // Every observed value, in a dropdown. A truncated chip list hid whole states from
      // anyone outside the biggest markets; a dropdown holds all of them, stays the same
      // size on screen, and the browser's type-ahead makes 8,000 title words navigable.
      var groups = '<div class="facet-row">' + stateOptions + Object.keys(FACET_TARGET).map(function (key) {
        if (key === "states") return "";
        var items = (data.facets[key] || []);
        if (!items.length) return "";
        return '<label class="facet-pick"><span class="facet-name">' + FACET_LABEL[key] +
          ' <span class="n">' + items.length + "</span></span>" +
          '<select data-facet="' + key + '">' +
          '<option value="">\u2014 any \u2014</option>' +
          items.map(function (it) {
            return '<option value="' + esc(it.value) + '">' + esc(it.value) + " (" + it.count + ")</option>";
          }).join("") + "</select></label>";
      }).join("") + "</div>";
      out.innerHTML = summary + groups;
      wireFacetSelects(out);
    }).catch(function (e) { document.getElementById("facet-out").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; });
  }

  function run() { loadPostings(); loadFacets(); }

  // Saved queries come from the server, so they survive a browser eviction, a different
  // device, and the overnight sync they are usually waiting on.
  var savedCache = [];
  function renderSaved() {
    var row = document.getElementById("saved-row");
    if (!savedCache.length) { row.innerHTML = '<span class="hint">no saved queries yet</span>'; return; }
    row.innerHTML = '<span class="hint">saved:</span> ' + savedCache.map(function (q) {
      return '<button class="saved" data-id="' + esc(q.id) + '">' + esc(q.name) + "</button>" +
             '<button class="saved-x" data-id="' + esc(q.id) + '" title="delete">&times;</button>';
    }).join(" ");
    Array.prototype.forEach.call(row.querySelectorAll("button.saved"), function (b) {
      b.addEventListener("click", function () {
        var q = savedCache.filter(function (x) { return x.id === b.getAttribute("data-id"); })[0];
        if (q) { writeFilters(q.state); run(); }
      });
    });
    Array.prototype.forEach.call(row.querySelectorAll("button.saved-x"), function (b) {
      b.addEventListener("click", function () {
        fetch("/db/saved/" + encodeURIComponent(b.getAttribute("data-id")), { method: "DELETE" })
          .then(loadSaved);
      });
    });
  }
  function loadSaved() {
    return get("/db/saved").then(function (data) {
      savedCache = data.items || [];
      renderSaved();
    }).catch(function () { renderSaved(); });
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
  document.getElementById("posting-go").addEventListener("click", run);
  document.getElementById("posting-clear").addEventListener("click", function () {
    writeFilters({}); document.getElementById("f-limit").value = "200"; run();
  });
  document.getElementById("posting-save").addEventListener("click", function () {
    var name = prompt("Name this query:");
    if (!name) return;
    fetch("/db/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, state: readFilters() })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || "Save failed"); });
      return loadSaved();
    }).catch(function (e) { alert(e.message); });
  });
  document.getElementById("posting-sql").addEventListener("click", function () {
    var el = document.getElementById("posting-sqlout");
    el.hidden = !el.hidden;
  });
  Object.keys(FIELDS).forEach(function (id) {
    document.getElementById(id).addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
  });
  document.getElementById("sql-go").addEventListener("click", runSql);
  Array.prototype.forEach.call(document.querySelectorAll(".examples button"), function (b) {
    b.addEventListener("click", function () { document.getElementById("sql").value = b.getAttribute("data-sql"); runSql(); });
  });

  loadCompanies();
  loadSaved();
})();
</script>
</body>
</html>`;

module.exports = { DB_BROWSER_PAGE };
