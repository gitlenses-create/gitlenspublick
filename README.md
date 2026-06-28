<p align="center">
  <img src="assets/logo.png" alt="GitLens logo" width="160" height="160">
</p>

<h1 align="center">GitLens</h1>

<p align="center">
  Visualize any public GitHub profile as a beautiful, interactive dashboard.<br>
  <a href="https://gitlens.info">gitlens.info</a> · <a href="https://x.com/gitlensinfo">@gitlensinfo</a>
</p>

---

## Overview

GitLens turns any GitHub username into an interactive summary of their activity:

- **Repos per Language** — how the user's repositories break down by language
- **Stars per Language** — where their stars come from
- **Commits per Language** — language activity by commit volume
- **Commits per Repo** & **Stars per Repo** — their most active and most popular projects
- **Commits per quarter** — a timeline of recent activity
- **Profile card** — avatar, public repo count, and join date

It is a **fully static site** with **no backend**. All data is fetched directly
in the browser from the public GitHub REST API.

## Features

- ⚡️ Zero backend — deploys anywhere static
- 📊 Interactive Chart.js donut & line charts
- 🔍 Click any chart slice to open the related repo or language search on GitHub
- 🔗 Share any profile via Twitter or a copy-link button
- 🔑 Optional GitHub token (stored only in your browser) lifts the API limit from
  60 to 5000 requests/hour

## Project structure

```
index.html              # markup, Vue templates, styles, light theme
assets/js/app.js        # Vue components + client-side routing (?user=X)
assets/js/github.js     # GitHub API aggregation layer
assets/js/charts.js     # Chart.js donut + line charts
assets/vendor/          # Vue, Chart.js, axios, moment, js-cookie (bundled locally)
assets/logo.png         # brand logo
favicon.png
vercel.json             # caching + security headers
robots.txt / sitemap.xml
```

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works (e.g. `npx serve`).

## Usage

1. Open the site and type a GitHub username (e.g. `tipsy`).
2. GitLens loads the profile and renders the charts.
3. Share the result, or click chart segments to jump to GitHub.

> Hitting the rate limit? Click **“Rate limited? Add a GitHub token”** on the
> search screen and paste a personal access token (no scopes required). It is
> stored only in your browser.

## Deploy

GitLens is a zero-config static deployment (Vercel, Netlify, Cloudflare Pages,
GitHub Pages, or any static host).

**Vercel CLI:**
```bash
npm i -g vercel
vercel --prod
```

`vercel.json` sets long-lived caching for vendored assets and basic security
headers. Canonical, Open Graph, sitemap and Twitter card metadata point to
`https://gitlens.info`.

## Tech

[Vue 2](https://vuejs.org) · [Chart.js](https://www.chartjs.org) ·
[axios](https://github.com/axios/axios) · [moment](https://momentjs.com) ·
the [GitHub REST API](https://docs.github.com/rest).

## License

MIT
