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
  /* Neutral, deliberately not warn: a posting outside the date window is still open, so
     colouring it like a problem would misreport it. Same light-background/dark-text shape
     as the others, which reads on both colour schemes. */
  .info { background: #dbeafe; color: #1d4f8a; }
  .err { color: #b3261e; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; margin: 10px 0; }
  footer { padding: 0 18px 30px; }
  .hint { font-size: 12px; color: #66798c; margin: 8px 0; }
  #active-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; }
  button.afchip { border: 1px solid #1f6feb; background: #eaf1fd; color: #14539a; border-radius: 999px;
                  padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
  button.afchip b { font-weight: 650; }
  button.afchip:hover { background: #d8e6fb; }
  button.afclear { border: none; background: none; color: #66798c; cursor: pointer; font: inherit;
                   font-size: 12px; text-decoration: underline; }
  @media (prefers-color-scheme: dark) { button.afchip { background: #16243a; border-color: #2b5ea8; color: #9cc4ff; } }
  #sort-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 8px; }
  #sort-bar .facet-name { margin-right: 2px; }
  button.sortbtn { border: 1px solid #c6ceda; background: #fff; color: inherit; border-radius: 999px;
                   padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
  button.sortbtn:hover { border-color: #1f6feb; color: #1f6feb; }
  button.sortbtn.on { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  @media (prefers-color-scheme: dark) { button.sortbtn { background: #18202a; border-color: #2d3947; }
                                        button.sortbtn.on { background: #1f6feb; border-color: #1f6feb; } }
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
  /* The always-visible controls. State first and widest-of-the-narrow, because it is the
     filter that gets set before anything else on nearly every search. */
  .quickbar { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 8px; }
  .quickbar label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #52606d; }
  @media (prefers-color-scheme: dark) { .quickbar label { color: #9fb0c4; } }
  .quickbar input, .quickbar select { font: inherit; padding: 8px 10px; border: 1px solid #c6ceda;
    border-radius: 8px; background: #fff; color: inherit; }
  @media (prefers-color-scheme: dark) { .quickbar input, .quickbar select { background: #18202a; border-color: #2d3947; } }
  .quickbar .qb-grow { flex: 1 1 240px; }
  .quickbar .qb-grow input { width: 100%; }
  .quickbar .qb-state select { min-width: 120px; }
  .quickbar button.go { padding: 9px 20px; }
  .quickflags { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 10px;
                font-size: 12px; color: #52606d; }
  @media (prefers-color-scheme: dark) { .quickflags { color: #9fb0c4; } }
  .quickflags label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
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
  button.saved, button.saved-x, #posting-clear, #posting-save, #posting-share, #posting-export, #posting-sql {
    border: 1px solid #c6ceda; background: #fff; color: inherit; border-radius: 8px;
    padding: 7px 12px; cursor: pointer; font: inherit; font-size: 13px; }
  @media (prefers-color-scheme: dark) { button.saved, button.saved-x, #posting-clear, #posting-save, #posting-share, #posting-export, #posting-sql { background: #18202a; border-color: #2d3947; } }
  button:disabled { cursor: wait; opacity: .65; }
  .empty { padding: 28px 16px; text-align: center; }
  .empty b { display: block; margin-bottom: 4px; }
  a { color: #1f6feb; }
  button.linkbtn { border: 0; padding: 0; background: none; color: #1f6feb; cursor: pointer;
                   font: inherit; text-align: left; }
  button.linkbtn:hover { text-decoration: underline; }
  .examples button { background: none; border: none; color: #1f6feb; cursor: pointer; font: inherit;
                     padding: 0; text-decoration: underline; font-size: 12px; }
  .schema { margin-bottom: 12px; border: 1px solid #d3dae2; border-radius: 10px; padding: 8px 10px; }
  @media (prefers-color-scheme: dark) { .schema { border-color: #26313d; } }
  .schema summary { cursor: pointer; font-weight: 600; }
  .schema-tools { margin: 9px 0; }
  .schema-tools input { width: min(100%, 360px); }
  .schema-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
  .schema-table { border: 1px solid #e1e7ee; border-radius: 8px; padding: 8px; min-width: 0; }
  @media (prefers-color-scheme: dark) { .schema-table { border-color: #26313d; } }
  .schema-cols { color: #66798c; font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
                 overflow-wrap: anywhere; }
  /* A warmer shell around the utilitarian controls: the data stays dense, but the page
     should feel like a place to explore rather than a maintenance console. */
  :root { --ink: #24302c; --muted-ink: #6d7b75; --accent: #176b5b; --accent-soft: #e7f3ef;
          --paper: #fffdf9; --canvas: #f4f1e9; --line: #ddd8cc; --warm: #d48745; }
  body { background:
    radial-gradient(circle at 8% 0%, rgba(212,135,69,.12), transparent 28rem),
    var(--canvas); color: var(--ink); }
  .hero { background: linear-gradient(120deg, #183e38 0%, #176b5b 62%, #307c6c 100%);
          color: #fff; padding: 30px max(22px, calc((100vw - 1180px) / 2)); border: 0;
          display: block; }
  .hero-inner { display: flex; justify-content: space-between; gap: 24px; align-items: end; }
  .eyebrow { margin: 0 0 5px; color: #b9ded5; font-size: 11px; font-weight: 750;
             letter-spacing: .12em; text-transform: uppercase; }
  .hero h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(26px, 4vw, 38px);
             font-weight: 500; line-height: 1.12; letter-spacing: -.02em; }
  .hero-copy { margin: 7px 0 0; max-width: 620px; color: #d8eee8; font-size: 14px; }
  .read-only { flex: 0 0 auto; color: #e7f5f1; border: 1px solid rgba(255,255,255,.3);
               border-radius: 999px; padding: 5px 10px; font-size: 11px; }
  nav { max-width: 1180px; margin: 0 auto; padding: 16px 18px 0; }
  nav button { background: transparent; border-color: transparent; font-weight: 650; padding: 7px 14px; }
  nav button[aria-selected="true"] { background: var(--paper); color: var(--accent);
    border-color: var(--line); box-shadow: 0 4px 14px rgba(37,48,44,.07); }
  main { max-width: 1180px; margin: 0 auto; padding: 18px 18px 54px; }
  footer { max-width: 1180px; margin: 0 auto; }
  .panel-intro { margin-bottom: 14px; }
  .panel-intro h2 { margin: 0 0 3px; font: 500 21px/1.25 Georgia, "Times New Roman", serif; }
  .panel-intro p { margin: 0; color: var(--muted-ink); font-size: 13px; }
  .search-card { padding: 16px; margin-bottom: 14px; background: rgba(255,253,249,.86);
                 border: 1px solid var(--line); border-radius: 14px;
                 box-shadow: 0 8px 25px rgba(47,55,48,.06); }
  input[type=search], textarea, select, .quickbar input, .quickbar select {
    background: var(--paper); border-color: #cfc9bc; }
  input:focus, textarea:focus, select:focus { outline: 3px solid rgba(23,107,91,.16);
                                             border-color: var(--accent); }
  button.go { background: var(--accent); border-color: var(--accent); font-weight: 650;
              box-shadow: 0 3px 9px rgba(23,107,91,.18); }
  button.go:hover { background: #115a4c; }
  .starter-row { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; margin-bottom: 13px; }
  .starter-label { color: var(--muted-ink); font-size: 12px; font-weight: 650; }
  button.starter { border: 1px solid #d7cbbd; background: #fff8ef; color: #70451f;
                   border-radius: 999px; padding: 5px 10px; cursor: pointer; font: inherit;
                   font-size: 12px; }
  button.starter:hover { border-color: var(--warm); background: #fff2e2; }
  .filter-help { margin: 0 0 13px; color: var(--muted-ink); }
  .filter-help summary { cursor: pointer; font-size: 12px; }
  .filter-help .hint { max-width: 950px; line-height: 1.65; }
  .plist, .scroller { border-color: var(--line); border-radius: 14px; box-shadow: 0 7px 22px rgba(47,55,48,.05); }
  .pitem { padding: 13px 15px; }
  .pitem:hover { background: #fbf7ef; }
  a, button.linkbtn, .examples button { color: var(--accent); }
  button.sortbtn.on, nav button[aria-selected="true"] { border-color: var(--accent); }
  button.sortbtn.on { background: var(--accent); }
  button.afchip { border-color: #80aa9f; background: var(--accent-soft); color: #155c4f; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e5e9e4; --muted-ink: #a7b3ad; --accent: #71c7b3; --accent-soft: #173d35;
            --paper: #17201d; --canvas: #101613; --line: #33413c; --warm: #e0a268; }
    body { background: radial-gradient(circle at 8% 0%, rgba(212,135,69,.09), transparent 28rem), var(--canvas); }
    .hero { background: linear-gradient(120deg, #142f2b, #164d43); }
    nav button[aria-selected="true"], .search-card { background: var(--paper); }
    input[type=search], textarea, select, .quickbar input, .quickbar select { background: #121a17; border-color: #3b4a44; }
    button.starter { background: #2d241b; border-color: #5c4937; color: #f0bf8e; }
    .pitem:hover { background: #1b2723; }
  }
  @media (max-width: 640px) {
    .hero { padding-top: 23px; padding-bottom: 23px; }
    .hero-inner { align-items: start; flex-direction: column; gap: 12px; }
    .pitem { grid-template-columns: 1fr; grid-template-areas: "title" "meta" "side"; }
    .pside { align-items: flex-start; margin-top: 5px; }
  }
</style>
</head>
<body>
<header class="hero">
  <div class="hero-inner">
    <div>
      <p class="eyebrow">OpenPostings</p>
      <h1>Find the signal in your job data.</h1>
      <p class="hero-copy">Explore what is open, what changed, and which employers are worth a closer look.</p>
    </div>
    <span class="read-only" id="dbmeta">Read-only workspace</span>
  </div>
</header>
<nav>
  <button id="tab-postings" aria-selected="true">Postings</button>
  <button id="tab-companies" aria-selected="false">Companies</button>
  <button id="tab-sql" aria-selected="false">SQL</button>
</nav>
<main>
  <section id="panel-companies" hidden>
    <div class="panel-intro"><h2>Employer coverage</h2><p>See who is tracked, even when their current board is quiet.</p></div>
    <div class="row">
      <input type="search" id="company-q" placeholder="Company name or URL, e.g. booking">
      <button class="go" id="company-go">Search</button>
    </div>
    <p class="hint">Shows tracked employers whether or not they have anything visible &mdash; the listing can only show the ones that do.</p>
    <div id="company-out"></div>
  </section>

  <section id="panel-postings">
    <div class="panel-intro"><h2>Explore postings</h2><p>Start broad, then follow the details that look promising.</p></div>
    <!-- The controls that get touched on almost every search, kept out of the collapsed
         panel. State in particular was previously only reachable through a facet dropdown
         that reset after each run, so narrowing to one state meant re-picking it every
         time. -->
    <div class="starter-row">
      <span class="starter-label">A few good starting points</span>
      <button class="starter" data-preset="fresh-remote">Fresh + remote</button>
      <button class="starter" data-preset="new-week">New this week</button>
      <button class="starter" data-preset="pay">Pay disclosed</button>
    </div>
    <div class="search-card">
    <div class="quickbar">
      <label class="qb-state">State
        <select id="f-states-pick"><option value="">— any —</option></select>
      </label>
      <label class="qb-grow">Title has any of
        <input id="f-title-any" placeholder="manager, director, head of">
      </label>
      <label>Pay at least
        <input id="f-pay-min" type="number" placeholder="140000">
      </label>
      <label>Show
        <select id="f-vis">
          <option value="open">Still applyable</option>
          <option value="visible">Visible in app</option>
          <option value="all">All rows</option>
          <option value="stale_dated">Still listed, past date window</option>
          <option value="delisted">Delisted by the employer</option>
          <option value="hidden">Hidden from app (either reason)</option>
        </select>
      </label>
      <button class="go" id="posting-go">Search</button>
    </div>
    <div class="quickflags">
      <label><input type="checkbox" id="f-remote"> Remote only</label>
      <label><input type="checkbox" id="f-haspay"> Has a pay figure</label>
      <label><input type="checkbox" id="f-nopay"> Hide unknown pay</label>
      <span class="hint" id="quick-hint"></span>
    </div>

    <details class="adv">
      <summary>More filters</summary>
    <div class="grid">
      <label>Title has <b>all</b> of<input id="f-title-all" placeholder="operations"></label>
      <label>Title has <b>none</b> of<input id="f-title-none" placeholder="assistant, shift, intern"></label>
      <label>Description has <b>any</b><input id="f-desc-any" placeholder="p&amp;l, multi-site"></label>
      <label>Description has <b>none</b><input id="f-desc-none" placeholder="commission only"></label>
      <label>Company <b>any</b><input id="f-company-any" placeholder="hilton, marriott"></label>
      <label>Company <b>none</b><input id="f-company-none" placeholder="staffing, temp"></label>
      <label>State <b>(exact, comma-separated)</b><input id="f-states" placeholder="WA, OR"></label>
      <label>Country <b>(exact)</b><input id="f-countries" placeholder="US, Canada"></label>
      <label>Region <b>(exact)</b><input id="f-regions" placeholder="AMER, EMEA, APAC"></label>
      <label>City <b>(City|ST, comma-separated)</b><input id="f-cities" placeholder="Seattle|WA, Kent|WA"></label>
      <label>Location text <b>any</b><input id="f-loc-any" placeholder="downtown, campus"></label>
      <label>Location <b>none</b><input id="f-loc-none" placeholder="DC, remote"></label>
      <label>Pay at most<input id="f-pay-max" type="number" placeholder=""></label>
      <label>Still listed within (days)<input id="f-seen" type="number" placeholder="5"></label>
      <label>First found within (days)<input id="f-found" type="number" placeholder=""></label>
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
    </div>
    <details class="filter-help">
      <summary>How the filters work</summary>
      <p class="hint">Terms are comma-separated. Within a box they are OR-ed; each box is AND-ed with the others &mdash; so <em>any</em>=manager,director with <em>none</em>=assistant gives (manager OR director) AND NOT assistant. <b>Still applyable</b> covers postings the app shows plus ones it hides only for being past the date window; those are still on the employer&rsquo;s board. <b>State</b>, <b>Country</b>, <b>Region</b> and <b>City</b> match parsed locations, not raw text. <b>Description</b> boxes scan stored job text and are slower than title filters.</p>
    </details>
    <div class="row">
      <button id="posting-clear">Clear</button>
      <button id="posting-save">Save this query</button>
      <button id="posting-share">Copy link</button>
      <button id="posting-export" disabled>Export CSV</button>
      <button id="posting-sql">Show SQL</button>
      <span id="posting-count" class="hint"></span>
      <span id="posting-notice" class="hint" role="status" aria-live="polite"></span>
    </div>
    <div class="row" id="saved-row"></div>
    <pre id="posting-sqlout" hidden></pre>
    <div id="active-filters"></div>
    <div id="facet-out"></div>
    <div id="sort-bar"></div>
    <div id="posting-out"></div>
  </section>

  <section id="panel-sql" hidden>
    <div class="panel-intro"><h2>Ask the database directly</h2><p>For the questions the guided search cannot quite express.</p></div>
    <details class="schema" open>
      <summary>Schema reference</summary>
      <div class="schema-tools"><input type="search" id="schema-q" placeholder="Filter tables or columns"></div>
      <div id="schema-out"><span class="hint">Open the SQL tab to load the schema.</span></div>
    </details>
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
  var TAB_KEY_LOCAL = "openpostings.db.tab";
  function show(name) {
    TABS.forEach(function (t) {
      document.getElementById("tab-" + t).setAttribute("aria-selected", String(t === name));
      document.getElementById("panel-" + t).hidden = t !== name;
    });
    try { localStorage.setItem(TAB_KEY_LOCAL, name); } catch (e) {}
  }
  // Postings is the tab this page is actually used for, so it opens there and its results
  // are already on screen. Companies used to be the default, which meant a click before
  // every session, and the postings form only populated after a Run -- an empty form reads
  // as a missing feature.
  var ranPostings = false;
  var loadedCompanies = false;
  var loadedSchema = false;
  TABS.forEach(function (t) {
    document.getElementById("tab-" + t).addEventListener("click", function () {
      show(t);
      if (t === "postings" && !ranPostings) { ranPostings = true; run(); }
      // Companies is no longer loaded on boot; fetch it the first time it is opened.
      if (t === "companies" && !loadedCompanies) { loadedCompanies = true; loadCompanies(); }
      if (t === "sql" && !loadedSchema) { loadedSchema = true; loadSchema(); }
    });
  });

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function externalUrl(v) {
    var value = String(v || "").trim();
    return /^https?:\\/\\//i.test(value) ? value : "";
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

  var schemaCache = [];
  function renderSchema() {
    var term = document.getElementById("schema-q").value.trim().toLowerCase();
    var tables = schemaCache.filter(function (table) {
      if (!term) return true;
      return table.name.toLowerCase().indexOf(term) !== -1 ||
        table.columns.some(function (column) { return column.name.toLowerCase().indexOf(term) !== -1; });
    });
    var out = document.getElementById("schema-out");
    if (!tables.length) {
      out.innerHTML = '<p class="hint">No readable tables or columns match.</p>';
      return;
    }
    out.innerHTML = '<div class="schema-list">' + tables.map(function (table) {
      return '<div class="schema-table"><button class="linkbtn schema-pick" data-table="' +
        esc(table.name) + '"><b>' + esc(table.name) + '</b></button><div class="schema-cols">' +
        table.columns.map(function (column) {
          return esc(column.name) + (column.type ? " <span>" + esc(column.type) + "</span>" : "") +
            (column.primary_key ? " · PK" : "");
        }).join("<br>") + "</div></div>";
    }).join("") + "</div>";
    Array.prototype.forEach.call(out.querySelectorAll(".schema-pick"), function (button) {
      button.addEventListener("click", function () {
        var name = button.getAttribute("data-table").replace(/"/g, '""');
        document.getElementById("sql").value = 'SELECT * FROM "' + name + '" LIMIT 100';
        document.getElementById("sql").focus();
      });
    });
  }
  function loadSchema() {
    document.getElementById("schema-out").innerHTML = '<p class="hint">Loading schema&hellip;</p>';
    get("/db/schema").then(function (data) {
      schemaCache = data.tables || [];
      renderSchema();
    }).catch(function (e) { fail("schema-out", e.message); });
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
          var board = externalUrl(r.url_string)
            ? '<a href="' + esc(r.url_string) + '" target="_blank" rel="noopener">open board</a>'
            : esc(r.url_string);
          return '<td><button class="linkbtn company-drill" data-company="' + esc(r.company_name) + '">' +
            esc(r.company_name) + "</button></td><td>" + esc(r.ATS_name) + "</td><td>" + r.total +
            "</td><td>" + pill + "</td><td>" + when(r.last_seen_epoch) +
            '</td><td class="wrap">' + board + "</td>";
        }
      });
      Array.prototype.forEach.call(document.querySelectorAll("#company-out .company-drill"), function (b) {
        b.addEventListener("click", function () { drillToCompany(b.getAttribute("data-company"), false); });
      });
    }).catch(function (e) { fail("company-out", e.message); });
  }

  var FIELDS = {
    "f-title-any": "title_any", "f-title-all": "title_all", "f-title-none": "title_none",
    "f-desc-any": "description_any", "f-desc-none": "description_none",
    "f-company-any": "company_any", "f-company-none": "company_none",
    "f-states": "states", "f-countries": "countries", "f-regions": "regions",
    "f-loc-any": "location_any", "f-loc-none": "location_none", "f-cities": "cities",
    "f-pay-min": "pay_min", "f-pay-max": "pay_max",
    "f-seen": "seen_days", "f-found": "found_days",
    "f-ats": "ats", "f-vis": "visibility", "f-sort": "sort", "f-dir": "dir", "f-limit": "limit"
  };
  var DEFAULT_FILTERS = { visibility: "open", sort: "last_seen", dir: "desc", limit: "200" };

  // Checkboxes send "1" when ticked and nothing at all when not, because the query layer
  // treats an absent parameter as "no opinion" and an empty string as a value.
  var FLAGS = { "f-remote": "remote_only", "f-haspay": "has_pay" };

  function readFilters() {
    var out = {};
    Object.keys(FIELDS).forEach(function (id) {
      var v = document.getElementById(id).value;
      if (v !== "" && v !== null) out[FIELDS[id]] = v;
    });
    Object.keys(FLAGS).forEach(function (id) {
      if (document.getElementById(id).checked) out[FLAGS[id]] = "1";
    });
    // Inverted on purpose: unknown-pay rows are kept by default (most postings publish no
    // figure), so the box the user ticks is the one that removes them.
    if (document.getElementById("f-nopay").checked) out.include_unknown_pay = "0";
    return out;
  }
  function writeFilters(state) {
    state = Object.assign({}, DEFAULT_FILTERS, state || {});
    Object.keys(FIELDS).forEach(function (id) {
      document.getElementById(id).value = state[FIELDS[id]] === undefined ? "" : state[FIELDS[id]];
    });
    Object.keys(FLAGS).forEach(function (id) {
      document.getElementById(id).checked = String(state[FLAGS[id]] || "") === "1";
    });
    document.getElementById("f-nopay").checked = String(state.include_unknown_pay || "") === "0";
    // The quick-bar state picker and the comma-separated advanced box are two views of the
    // same filter; keep the picker showing the value only when it can represent it.
    var states = String(state.states || "");
    var pick = document.getElementById("f-states-pick");
    if (pick) pick.value = states.indexOf(",") === -1 ? states.trim() : "";
  }

  function drillToCompany(name, preserveFilters) {
    var state = preserveFilters ? readFilters() : DEFAULT_FILTERS;
    writeFilters(Object.assign({}, state, { company_any: name }));
    show("postings");
    ranPostings = true;
    run();
  }

  // Filters survive a reload. Without this every visit started blank, so narrowing to a
  // state meant re-picking it before every single search -- which is most of what made the
  // page tedious. The URL carries the same state so a query can be bookmarked or sent to
  // someone, and the browser back button steps through searches.
  var STORE_KEY = "openpostings.db.filters";

  function persist() {
    var state = readFilters();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    try {
      var qs = new URLSearchParams(state).toString();
      var next = qs ? "?" + qs : location.pathname;
      var current = location.search || location.pathname;
      if (current !== next) history.pushState(null, "", next);
    } catch (e) {}
  }

  function restore(fromHistory) {
    // The URL wins: a link someone opened is a deliberate request for that exact query,
    // while localStorage is only what this browser happened to do last.
    var fromUrl = {};
    var hasUrl = false;
    try {
      new URLSearchParams(location.search).forEach(function (v, k) { fromUrl[k] = v; hasUrl = true; });
    } catch (e) {}
    if (hasUrl) { writeFilters(fromUrl); return; }
    // A bare /db reached with Back means the URL itself is the requested state. Do not
    // immediately replace it with whatever localStorage remembers and push a new entry.
    if (fromHistory) { writeFilters(DEFAULT_FILTERS); return; }
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && typeof saved === "object") { writeFilters(saved); return; }
    } catch (e) {}
    writeFilters(DEFAULT_FILTERS);
  }
  // Mirrors SORTABLE in server/services/db-query.js. Clicking the active field flips the
  // direction, which is the behaviour a column header would have had before the table was
  // replaced by a list -- the sort control was otherwise only reachable inside the
  // collapsed filter form.
  var SORTS = [
    { value: "last_seen", label: "Last seen" },
    { value: "first_seen", label: "First found" },
    { value: "pay", label: "Pay" },
    { value: "posted", label: "Posted" },
    { value: "company", label: "Company" },
    { value: "position", label: "Position" },
    { value: "location", label: "Location" }
  ];

  function renderSortBar() {
    var current = document.getElementById("f-sort").value || "last_seen";
    var dir = document.getElementById("f-dir").value || "desc";
    var bar = document.getElementById("sort-bar");
    bar.innerHTML = '<span class="facet-name">Sort</span>' + SORTS.map(function (o) {
      var active = o.value === current;
      return '<button class="sortbtn' + (active ? " on" : "") + '" data-sort="' + o.value + '">' +
        o.label + (active ? (dir === "asc" ? " \u25b2" : " \u25bc") : "") + "</button>";
    }).join("");
    Array.prototype.forEach.call(bar.querySelectorAll("button.sortbtn"), function (b) {
      b.addEventListener("click", function () {
        var picked = b.getAttribute("data-sort");
        var sortEl = document.getElementById("f-sort");
        var dirEl = document.getElementById("f-dir");
        if (sortEl.value === picked) {
          dirEl.value = dirEl.value === "asc" ? "desc" : "asc";
        } else {
          sortEl.value = picked;
          // Text reads naturally A-Z; recency and pay are wanted highest-first.
          dirEl.value = (picked === "company" || picked === "position" || picked === "location") ? "asc" : "desc";
        }
        run(true);
      });
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

  // How old the posting itself is, which is what a job seeker judges -- distinct from
  // last_seen_epoch, which only says when the sync last looked at it.
  function postedAgo(value) {
    if (!value) return "";
    var t = Date.parse(value);
    if (!t) return "";
    var days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return "today";
    if (days < 30) return days + "d";
    return Math.floor(days / 30) + "mo";
  }

  // A list rather than a table: nine nowrap columns guaranteed horizontal scrolling, and
  // two of them were full ISO timestamps. Each posting is one block that reflows, so the
  // same markup reads on a phone and on a desktop.
  function postingList(rows) {
    if (!rows.length) return '<div class="empty"><b>No postings match these filters.</b>' +
      '<span class="hint">Remove an applied filter or broaden the title and location terms.</span></div>';
    return '<ul class="plist">' + rows.map(function (r) {
      var pay = money(r);
      return '<li class="pitem">' +
        '<a class="ptitle" href="' + esc(externalUrl(r.job_posting_url) || "#") + '" target="_blank" rel="noopener">' +
          esc(r.position_name || "Untitled") + "</a>" +
        '<div class="pmeta">' +
          hiddenPill(r) +
          '<button class="linkbtn pco company-drill" data-company="' + esc(r.company_name) + '">' +
            esc(r.company_name) + "</button>" +
          (r.location ? ' <span class="psep">\u00b7</span> ' + esc(r.location) : "") +
        "</div>" +
        '<div class="pside">' +
          (pay ? '<span class="ppay">' + esc(pay) + "</span>" : "") +
          '<span class="page" title="posted / last seen by sync">' +
            (postedAgo(r.posting_date) || "\u2014") + " posted \u00b7 seen " + ago(r.last_seen_epoch) + "</span>" +
        "</div>" +
      "</li>";
    }).join("") + "</ul>";
  }

  // A bare "hidden" pill said nothing about whether the job is gone or merely old, which
  // are wildly different things to a job seeker: a delisted posting cannot be applied to,
  // while one outside the date window is still on the employer's board. Two reasons, two
  // labels, two colours -- and the neutral one is not styled as a warning, because there
  // is nothing wrong with it.
  function hiddenPill(r) {
    if (!r.hidden) return "";
    if (r.hidden_reason === "outside_date_window") {
      // No apostrophes in this string. The page is emitted from a template literal, so a
      // backslash-escaped quote here becomes a raw apostrophe inside a single-quoted
      // string in the browser, which is a syntax error that takes down the whole page
      // script -- not just this pill.
      return '<span class="pill info" title="Still listed by the employer, but the posting date is older than the freshness window. Still applyable.">still listed &middot; past date window</span> ';
    }
    if (r.hidden_reason === "delisted") {
      return '<span class="pill warn" title="The ATS stopped listing this posting, so it is almost certainly gone.">delisted</span> ';
    }
    // Rows hidden before hidden_reason existed, if any survived the migration.
    return '<span class="pill warn">hidden</span> ';
  }

  function money(r) {
    var lo = r.pay_min, hi = r.pay_max;
    if (!lo && !hi) return "";
    var k = function (n) { return n >= 1000 ? Math.round(n / 1000) + "k" : String(n); };
    return (lo && hi && lo !== hi) ? k(lo) + "-" + k(hi) : k(hi || lo);
  }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? "" : value);
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportPostings() {
    if (!lastPostingRows.length) return;
    var columns = ["company_name", "position_name", "location", "posting_date", "pay_min",
      "pay_max", "pay_currency", "hidden", "hidden_reason", "first_seen_epoch",
      "last_seen_epoch", "job_posting_url"];
    var csv = [columns.map(csvCell).join(",")].concat(lastPostingRows.map(function (row) {
      return columns.map(function (key) { return csvCell(row[key]); }).join(",");
    })).join("\\r\\n");
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = "openpostings-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  var postingRequest = 0;
  var lastPostingRows = [];
  function loadPostings() {
    var request = ++postingRequest;
    var params = new URLSearchParams(readFilters()).toString();
    var go = document.getElementById("posting-go");
    go.disabled = true;
    go.textContent = "Searching…";
    document.getElementById("posting-count").textContent = "";
    document.getElementById("posting-out").innerHTML = '<p class="hint">Running&hellip;</p>';
    get("/db/search?" + params).then(function (data) {
      if (request !== postingRequest) return;
      // Break the hidden count down the same way the pills do, so the summary and the rows
      // tell the same story rather than one saying "hidden" and the other "still listed".
      var staleDated = 0, delisted = 0;
      (data.rows || []).forEach(function (r) {
        if (!r.hidden) return;
        if (r.hidden_reason === "outside_date_window") staleDated += 1;
        else delisted += 1;
      });
      var breakdown = "";
      if ((staleDated || delisted)) {
        // Derived from the returned page, not the whole match set, so say so rather than
        // implying these are totals.
        breakdown = " (of those shown: " + staleDated + " still listed, " + delisted + " delisted)";
      }
      // data.total is null when the filter had nothing narrow enough to count exactly
      // without a full-table scan (see db-query.js's hasIndexedSearchTerm) -- add a title
      // or company term to see exact totals.
      document.getElementById("posting-count").textContent = data.total === null
        ? "showing " + data.shown + " (add a title or company term for an exact match count)" + breakdown
        : (data.approximate ? "at least " : "") + data.total + " matched \u00b7 " + data.visible +
          " visible, " + (data.total - data.visible) + " hidden" + breakdown + " \u00b7 showing " + data.shown;
      document.getElementById("posting-sqlout").textContent = data.sql;
      renderSortBar();
      document.getElementById("posting-out").innerHTML = postingList(data.rows);
      lastPostingRows = data.rows || [];
      document.getElementById("posting-export").disabled = !lastPostingRows.length;
      Array.prototype.forEach.call(document.querySelectorAll("#posting-out .company-drill"), function (b) {
        b.addEventListener("click", function () { drillToCompany(b.getAttribute("data-company"), true); });
      });
    }).catch(function (e) {
      if (request === postingRequest) fail("posting-out", e.message);
    }).finally(function () {
      if (request === postingRequest) {
        go.disabled = false;
        go.textContent = "Search";
      }
    });
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
    cities: { id: "f-cities", replace: false },
    title_words: { id: "f-title-all", replace: false },
    companies: { id: "f-company-any", replace: true },
    ats: { id: "f-ats", replace: true }
  };
  var FACET_LABEL = { states: "State", cities: "City", title_words: "Title contains", companies: "Company", ats: "ATS" };

  var FILTER_LABEL = {
    title_any: "Title any", title_all: "Title has", title_none: "Title not",
    description_any: "Description", description_none: "Description not",
    company_any: "Company", company_none: "Company not",
    states: "State", cities: "City", countries: "Country", regions: "Region",
    location_any: "Location", location_none: "Location not",
    ats: "ATS", pay_min: "Pay \u2265", pay_max: "Pay \u2264",
    seen_days: "Seen \u2264 d", found_days: "Found \u2264 d", visibility: "Show",
    remote_only: "Remote", has_pay: "Pay", include_unknown_pay: "Pay"
  };

  // The dropdowns are add-a-filter controls and reset to "any" after each run, which read
  // as the selection being lost. This shows what is actually applied, and is the place to
  // remove one -- it also handles fields holding several values, which a single select
  // cannot represent.
  var VIS_LABEL = {
    open: "still applyable", visible: "visible in app", all: "all rows",
    stale_dated: "still listed, past date window", delisted: "delisted",
    hidden: "hidden from app"
  };

  function renderActiveFilters() {
    var state = readFilters();
    var bar = document.getElementById("active-filters");
    var parts = [];
    Object.keys(FILTER_LABEL).forEach(function (key) {
      var raw = state[key];
      if (!raw || key === "visibility" && raw === "all") return;
      String(raw).split(",").map(function (t) { return t.trim(); }).filter(Boolean).forEach(function (term) {
        var shown = key === "visibility" ? (VIS_LABEL[term] || term) :
          (key === "remote_only" ? "only" : key === "has_pay" ? "known only" :
          key === "include_unknown_pay" ? "hide unknown" : term);
        parts.push('<button class="afchip" data-key="' + key + '" data-term="' + esc(term) + '">' +
          FILTER_LABEL[key] + ": <b>" + esc(shown) + "</b> &times;</button>");
      });
    });
    bar.innerHTML = parts.length
      ? '<span class="facet-name">Applied</span>' + parts.join("") +
        '<button class="afclear">clear all</button>'
      : "";
    Array.prototype.forEach.call(bar.querySelectorAll("button.afchip"), function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-key"), term = b.getAttribute("data-term");
        var id = Object.keys(FIELDS).filter(function (k) { return FIELDS[k] === key; })[0];
        if (id) {
          var el = document.getElementById(id);
          var kept = el.value.split(",").map(function (t) { return t.trim(); })
            .filter(function (t) { return t && t !== term; });
          el.value = key === "visibility" && !kept.length ? "all" : kept.join(", ");
        } else {
          var flagId = Object.keys(FLAGS).filter(function (k) { return FLAGS[k] === key; })[0];
          if (flagId) document.getElementById(flagId).checked = false;
          if (key === "include_unknown_pay") document.getElementById("f-nopay").checked = false;
        }
        run();
      });
    });
    var clear = bar.querySelector("button.afclear");
    if (clear) clear.addEventListener("click", function () {
      writeFilters(DEFAULT_FILTERS); run();
    });
  }

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

  var facetRequest = 0;
  function loadFacets() {
    var request = ++facetRequest;
    var params = new URLSearchParams(readFilters()).toString();
    get("/db/facets?" + params).then(function (data) {
      if (request !== facetRequest) return;
      var out = document.getElementById("facet-out");

      // State is always offered, from the fixed list of 51 rather than from counts: it is
      // the primary axis, and it has to be selectable before anything has been narrowed.
      var stateOptions = '<label class="facet-pick"><span class="facet-name">State</span>' +
        '<select data-facet="states"><option value="">\u2014 any \u2014</option>' +
        (data.all_states || []).map(function (st) {
          // The count is exact when present (it comes from posting_location_states, not from
          // a sample), so it is safe to show even in the narrowing branch. Picking a state
          // blind was the whole problem: 51 identical-looking codes, one of which has 75,000
          // postings behind it and another 300.
          var n = typeof st.count === "number" ? st.count : null;
          return '<option value="' + esc(st.value) + '">' + esc(st.value) +
            (n === null ? "" : " (" + n.toLocaleString() + ")") + "</option>";
        }).join("") + "</select></label>";

      if (data.needs_narrowing) {
        // Companies are counted exactly here too when nothing is narrowed yet -- same
        // reasoning as the state counts above. City and title breakdowns still need the
        // scan, so they remain the thing narrowing buys you.
        var wideCompanies = (data.facets && data.facets.companies) || [];
        var companyOptions = wideCompanies.length
          ? '<label class="facet-pick"><span class="facet-name">' +
            (data.companies_are_state_floor ? "Company in state" : "Company") + " " +
            '<span class="n">' + wideCompanies.length + "</span></span>" +
            '<select data-facet="companies"><option value="">\u2014 any \u2014</option>' +
            wideCompanies.map(function (it) {
              return '<option value="' + esc(it.value) + '">' + esc(it.value) +
                " (" + it.count.toLocaleString() + ")</option>";
            }).join("") + "</select></label>"
          : "";
        // Two different provenances for the company counts, and the difference matters
        // enough to say out loud: unscoped they are exact for the whole database, scoped to
        // a state they cover only the postings whose state is resolved in the projection,
        // which makes them a floor. Saying "at least" is the honest form of that.
        var companyNote = data.companies_are_state_floor
          ? "Company counts are for postings whose location resolves to the selected state, so they are a " +
            "floor rather than a total \u2014 postings whose state is only inferable from their URL are counted " +
            "by the filter but not here."
          : "State and company counts below are exact for the whole database.";
        // data.total is null when the predicate was broad enough that counting it exactly
        // would itself have needed the scan this branch exists to avoid (see db-facets.js's
        // hasIndexedSearchTerm check) -- add a title or company term to see it.
        var totalLabel = data.total === null ? "Many" : data.total.toLocaleString();
        out.innerHTML =
          '<p class="hint"><b>' + totalLabel + " rows.</b> " + companyNote +
          " City and title breakdowns need a scan of the matching rows, so they " +
          "appear once that set is small enough to count exactly \u2014 over a set this size they would describe a " +
          "fraction of it and read as if they described all of it. Picking a company from the list below is " +
          "usually the fastest way there.</p>" +
          '<div class="facet-row">' + stateOptions + companyOptions + "</div>";
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
    }).catch(function (e) {
      if (request === facetRequest) {
        document.getElementById("facet-out").innerHTML = '<p class="err">' + esc(e.message) + "</p>";
      }
    });
  }

  // Facets describe the matching set, which sorting cannot change -- verified identical
  // across sort orders. Re-fetching them on a sort click cost a multi-second recompute for
  // a guaranteed-identical answer, and re-rendering the dropdowns made it look as though
  // the selection had been wiped.
  function run(resultsOnly, fromHistory) {
    if (!fromHistory) persist();
    loadPostings();
    renderActiveFilters();
    if (!resultsOnly) loadFacets();
  }

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
  Array.prototype.forEach.call(document.querySelectorAll("button.starter"), function (button) {
    button.addEventListener("click", function () {
      var preset = button.getAttribute("data-preset");
      var state = Object.assign({}, DEFAULT_FILTERS);
      if (preset === "fresh-remote") {
        state.remote_only = "1";
        state.seen_days = "7";
      } else if (preset === "new-week") {
        state.found_days = "7";
        state.sort = "first_seen";
      } else if (preset === "pay") {
        state.has_pay = "1";
        state.sort = "pay";
      }
      writeFilters(state);
      run();
    });
  });
  document.getElementById("posting-clear").addEventListener("click", function () {
    writeFilters(DEFAULT_FILTERS); run();
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
  document.getElementById("posting-share").addEventListener("click", function () {
    persist();
    var notice = document.getElementById("posting-notice");
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        notice.textContent = "Link copied";
        setTimeout(function () { notice.textContent = ""; }, 2000);
      }).catch(function () { prompt("Copy this query link:", url); });
    } else {
      prompt("Copy this query link:", url);
    }
  });
  document.getElementById("posting-export").addEventListener("click", exportPostings);
  Object.keys(FIELDS).forEach(function (id) {
    document.getElementById(id).addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
  });
  document.getElementById("sql-go").addEventListener("click", runSql);
  document.getElementById("schema-q").addEventListener("input", renderSchema);
  Array.prototype.forEach.call(document.querySelectorAll(".examples button"), function (b) {
    b.addEventListener("click", function () { document.getElementById("sql").value = b.getAttribute("data-sql"); runSql(); });
  });

  // The quick-bar state picker writes through to the same field the advanced box uses, so
  // the two never disagree. Populated from the fixed state list rather than from counts,
  // because it has to be usable before anything has been narrowed.
  function populateStatePicker() {
    get("/db/facets?limit=1").then(function (data) {
      var pick = document.getElementById("f-states-pick");
      var current = String(document.getElementById("f-states").value || "").trim();
      pick.innerHTML = '<option value="">— any —</option>' +
        (data.all_states || []).map(function (st) {
          return '<option value="' + esc(st.value) + '">' + esc(st.value) + "</option>";
        }).join("");
      if (current.indexOf(",") === -1) pick.value = current;
    }).catch(function () {});
  }
  document.getElementById("f-states-pick").addEventListener("change", function () {
    document.getElementById("f-states").value = this.value;
    run();
  });
  // Ticking a box is an explicit request; no reason to make it also require a Run click.
  ["f-remote", "f-haspay", "f-nopay"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () { run(); });
  });
  document.getElementById("f-vis").addEventListener("change", function () { run(); });

  // Back/forward should replay searches rather than leaving the form and the results
  // describing different queries.
  window.addEventListener("popstate", function () { restore(true); run(false, true); });

  restore();
  populateStatePicker();
  loadSaved();

  var startTab = "postings";
  try {
    var remembered = localStorage.getItem(TAB_KEY_LOCAL);
    if (TABS.indexOf(remembered) !== -1) startTab = remembered;
  } catch (e) {}
  show(startTab);
  if (startTab === "postings") { ranPostings = true; run(); }
  else if (startTab === "companies") { loadedCompanies = true; loadCompanies(); }
  else if (startTab === "sql") { loadedSchema = true; loadSchema(); }
})();
</script>
</body>
</html>`;

module.exports = { DB_BROWSER_PAGE };
