# Folklore Hunter News

This repository fetches the latest news from the Steam community hub for **Folklore Hunter** (app ID `696220`) and publishes it to a GitHub Pages site and API.  A GitHub Action runs every hour to pull the RSS feed, sanitize the contents, and produce three artifacts in the `docs` directory:

- **docs/news.json** – a simple JSON array of articles with `title`, `url`, `date`, and sanitized `html` body
- **docs/embed.html** – a static, JavaScript‑free HTML page ideal for embedding in the Unreal Engine WebBrowser widget; it uses a CSS‑only accordion and Folklore Hunter's dark/red aesthetic
- **docs/index.html** – a public web page that loads `news.json` in the browser and displays the same accordion layout

Once this repository is pushed to GitHub and GitHub Pages is enabled (pointing to the `/docs` folder), your game can load `https://<user>.github.io/<repo>/embed.html` in its WebView, and anyone can browse the news at `https://<user>.github.io/<repo>/`.

### Usage

1. Fork or clone this repository.
2. Ensure GitHub Pages is enabled on your fork (`Settings → Pages → Source: deploy from `/docs`).
3. GitHub Actions will run automatically and populate the `docs` folder with the latest news every hour.  You can also trigger it manually by clicking **Run workflow** in the Actions tab.
4. Point your Unreal WebBrowser widget at `https://<your-user>.github.io/<repo>/embed.html` to display the news in‑game.

If you wish to tweak the layout, accent colours, number of articles, or sanitisation rules, edit `scripts/fetch-news.mjs`.  The GitHub Action will pick up your changes on the next run.
