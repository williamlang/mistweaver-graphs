export function htmlLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/vega@5/build/vega.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-lite@5/build/vega-lite.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-embed@6/build/vega-embed.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1e1e2e;
      color: #cdd6f4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      min-height: 100vh;
    }
    a { color: #89dceb; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Header */
    header {
      background: #181825;
      border-bottom: 1px solid #313244;
      padding: 0.875rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }
    header h1 { font-size: 1.125rem; color: #89dceb; font-weight: 600; }
    nav { display: flex; gap: 1rem; align-items: center; color: #a6adc8; font-size: 0.8125rem; }
    nav span { color: #585b70; }
    .rate-badge {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 6px;
      padding: 0.25rem 0.625rem;
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      cursor: default;
    }
    .rate-label { color: #585b70; }

    /* Layout */
    .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }

    /* Forms */
    .form-row {
      display: flex;
      gap: 0.75rem;
      align-items: flex-end;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    label { font-size: 0.75rem; color: #a6adc8; text-transform: uppercase; letter-spacing: 0.06em; }
    .player-select,
    input, select {
      background: #313244;
      border: 1px solid #45475a;
      color: #cdd6f4;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.9375rem;
      min-width: 220px;
      outline: none;
    }
    input:focus, select:focus { border-color: #89dceb; }
    button[type="submit"] {
      background: #89dceb;
      color: #1e1e2e;
      border: none;
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
    }
    button[type="submit"]:hover { background: #74c7ec; }

    /* Stat pills */
    .stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.5rem; }
    .stat {
      background: #181825;
      border: 1px solid #313244;
      border-radius: 8px;
      padding: 0.75rem 1.25rem;
    }
    .stat-label { font-size: 0.6875rem; color: #a6adc8; text-transform: uppercase; letter-spacing: 0.06em; }
    .stat-value { font-size: 1.375rem; font-weight: 700; color: #4ade80; margin-top: 0.125rem; }

    /* Fight list */
    .fight-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
    .fight-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 6px;
      border: 1px solid #45475a;
      color: #cdd6f4;
      font-size: 0.8125rem;
      transition: border-color 0.15s;
    }
    .fight-pill:hover { border-color: #89dceb; color: #89dceb; text-decoration: none; }
    .fight-pill.kill { border-color: #a6e3a1; color: #a6e3a1; }
    .fight-pill.wipe { border-color: #f38ba8; color: #f38ba8; }
    .fight-pill .dur { opacity: 0.65; }

    /* Dashboard grid */
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(560px, 100%), 1fr));
      gap: 1.25rem;
    }
    .card {
      background: #181825;
      border: 1px solid #313244;
      border-radius: 8px;
      padding: 1.25rem;
      overflow: hidden;
    }
    .card.wide { grid-column: 1 / -1; }
    .card-title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: #a6adc8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.875rem;
    }
    .vega-embed { width: 100% !important; }

    /* Auth page */
    .auth-center {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 80vh; gap: 1rem; text-align: center;
    }
    .auth-center h2 { font-size: 1.5rem; color: #89dceb; }
    .auth-center p { color: #a6adc8; max-width: 380px; line-height: 1.6; }
    .btn-primary {
      display: inline-block;
      background: #89dceb;
      color: #1e1e2e;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1rem;
      margin-top: 0.5rem;
    }
    .btn-primary:hover { background: #74c7ec; text-decoration: none; }

    /* Error */
    .error-box {
      background: #2d1b1b; border: 1px solid #f38ba8; color: #f38ba8;
      padding: 1rem 1.25rem; border-radius: 8px; margin: 1rem 0;
    }

    /* Section heading */
    .section-label {
      font-size: 0.75rem;
      color: #a6adc8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.5rem;
    }
    header h1 a { color: inherit; }
    .hint { color: #7f849c; font-size: 0.8125rem; line-height: 1.6; margin: 0.5rem 0 1rem; }
    .hint code { color: #a6adc8; }
    .muted { color: #7f849c; }
    .field.grow { flex: 1; min-width: 280px; }
    .field.grow input { width: 100%; }
    .monk-name { color: #4ade80; font-size: 0.875rem; }
    .wcl-link { margin-left: auto; font-size: 0.8125rem; align-self: center; }

    .stat.headline { border-color: #45475a; padding: 1rem 1.5rem; min-width: 220px; }
    .stat.headline .stat-value { font-size: 2rem; color: #cdd6f4; }
    .stat .stat-value { color: #cdd6f4; }
    .stat-sub { font-size: 0.75rem; color: #7f849c; margin-top: 0.25rem; line-height: 1.5; }
    .card-title { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    .card-badge {
      background: #313244; border: 1px solid #45475a; border-radius: 6px;
      padding: 0.125rem 0.5rem; font-size: 0.75rem; color: #cdd6f4;
      text-transform: none; letter-spacing: 0; font-variant-numeric: tabular-nums;
    }

    .grade { white-space: nowrap; }
    .grade-icon { margin-right: 0.3em; font-size: 0.8em; }
    .stat.headline .grade-icon { font-size: 0.5em; vertical-align: middle; }
    .g-good .grade-icon { color: #0ca30c; }
    .g-ok .grade-icon { color: #fab219; }
    .g-bad .grade-icon { color: #d03b3b; }
    .g-bad { color: #f38ba8; }

    .result { font-weight: 600; }
    .result.kill { color: #3987e5; }
    .result.wipe { color: #d95926; }
    .you-died { color: #f38ba8; }

    .table-wrap { overflow-x: auto; border: 1px solid #313244; border-radius: 8px; }
    table.pulls { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 0.8125rem; }
    table.pulls th {
      text-align: left; font-size: 0.6875rem; color: #a6adc8; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 0.5rem 0.625rem; background: #181825; position: sticky; top: 0;
      border-bottom: 1px solid #313244; white-space: nowrap;
    }
    table.pulls td { padding: 0.375rem 0.625rem; border-bottom: 1px solid #262637; white-space: nowrap; }
    table.pulls .num, table.mini .num { text-align: right; }
    table.pulls th.hl, table.pulls td.hl { background: #1f2233; }
    table.pulls th.hl { color: #cdd6f4; }
    .boss-row td { background: #11111b; padding-top: 0.625rem; border-bottom: 1px solid #313244; }
    .boss-row td.hl { background: #161827; }
    .pull-row { cursor: pointer; }
    .pull-row:hover td { background: #262637; }
    .pull-row.short td { opacity: 0.5; }
    .delta { color: #7f849c; font-size: 0.6875rem; margin-left: 0.25rem; }

    table.mini { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    table.mini th { text-align: left; font-size: 0.6875rem; color: #a6adc8; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.25rem 0.5rem; border-bottom: 1px solid #313244; }
    table.mini td { padding: 0.3rem 0.5rem; border-bottom: 1px solid #262637; }
    table.mini tr.you td { color: #f38ba8; }

    .pager { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; font-size: 0.8125rem; }
    .dashboard-grid.trends { grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); }

    @media (max-width: 640px) {
      .container { padding: 1rem; }
      header { flex-wrap: wrap; gap: 0.5rem 1rem; padding: 0.75rem 1rem; }
      .stat.headline { min-width: 0; flex: 1 1 100%; }
      .card { padding: 1rem; }
    }

    .stack-part { margin-top: 0.75rem; }
    .stack-part:first-of-type { margin-top: 0; }
    .stack-title { font-size: 0.75rem; color: #a6adc8; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem; }
    table.context { max-width: 900px; }
    table.context td, table.context th { white-space: nowrap; }
    table.context tr.base-row td { color: #cdd6f4; font-weight: 600; border-bottom: 1px solid #45475a; }
    .dir { font-size: 0.6875rem; margin-left: 0.25rem; }
    .dir.worse { color: #fab219; }
    .dir.better { color: #0ca30c; }
    ul.dips { list-style: none; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.8125rem; }
    ul.dips li { line-height: 1.5; padding-bottom: 0.5rem; border-bottom: 1px solid #262637; }
    .dip-time { font-variant-numeric: tabular-nums; color: #cdd6f4; margin-right: 0.375rem; }
    .dip-ctx { display: block; color: #a6adc8; font-size: 0.75rem; }
    .cutoff-select { min-width: 140px; }
    textarea {
      background: #313244; border: 1px solid #45475a; color: #cdd6f4; padding: 0.5rem 0.75rem;
      border-radius: 6px; font-size: 0.875rem; font-family: inherit; width: 100%; resize: vertical; outline: none;
    }
    textarea:focus { border-color: #89dceb; }
    .boss-section { margin-bottom: 2.5rem; }
    .boss-section > .card { margin-bottom: 1rem; overflow-x: auto; }
    .boss-head { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .boss-head h2 { font-size: 1.125rem; color: #cdd6f4; }
    .boss-head a { margin-left: auto; font-size: 0.8125rem; }
    .cut { color: #a6adc8; cursor: help; }
    .boss-link { color: inherit; }
    .boss-link:hover { color: #89dceb; }

    .divider {
      border: none;
      border-top: 1px solid #313244;
      margin: 1.5rem 0;
    }
  </style>
</head>
<body>
${body}
<script>
  document.querySelectorAll('[data-spec]').forEach(el => {
    const spec = JSON.parse(el.dataset.spec);
    vegaEmbed(el, spec, { actions: false, renderer: 'svg' }).catch(console.error);
  });
</script>
</body>
</html>`
}
