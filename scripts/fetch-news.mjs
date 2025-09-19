import { writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { parseStringPromise } from "xml2js";

/*
 * Fetch Folklore Hunter news from Steam's RSS feed, sanitize the content and
 * generate three artifacts in the docs folder:
 *
 *  docs/news.json  - structured array of articles (title, url, date, html)
 *  docs/embed.html - static HTML ready for UE4/UE5 WebView
 *  docs/index.html - a simple web page that fetches news.json and renders
 *                    the same accordion layout client‑side
 *
 * This script is intended to be run via GitHub Actions on a schedule. It
 * performs all parsing on the server side to avoid CORS issues in the
 * browser and produces files that can be served directly by GitHub Pages.
 */

// URL of the Steam RSS feed for Folklore Hunter
const FEED_URL = "https://steamcommunity.com/games/696220/rss/";

// Maximum number of news items to keep
const MAX_ITEMS = 10;

// Global styles shared by both the embed and web versions. The embed
// version uses CSS only (no JavaScript) and is suitable for the UE web
// browser. The web version adds a small script to fetch news.json.
const GLOBAL_CSS = String.raw` 
:root{
  --bg: transparent;
  --panel: rgba(10,10,12,0);
  --panel-strong: rgba(10,10,12,.75);
  --text:#f2f5f6;
  --muted:#a9b1b7;
  --accent:#e02121;
  --accent-2:#e02121;
  --border: rgba(225,53,53,0);
  --shadow: 0 12px 40px rgba(0,0,0,.55);
  --radius: 0px;
  --font: system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";
}
html,body{ margin:0; padding:0; background:var(--bg); color:var(--text); font:16px/1.6 var(--font); }
html::-webkit-scrollbar{ width:0; height:0; }
.wrap{ max-width:560px; margin:8px 0 24px; padding:0 8px; }
.list{ display:flex; flex-direction:column; gap:12px; }
.card{ background:var(--panel); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden;
       backdrop-filter: blur(6px) saturate(115%); -webkit-backdrop-filter: blur(6px) saturate(115%); position:relative; isolation:isolate; }
.card::after{ content:""; position:absolute; inset:0; pointer-events:none;
  background:
    radial-gradient(1200px 1200px at 10% 0%, rgba(225,53,53,.10), transparent 60%),
    radial-gradient(1000px 800px at 100% 100%, rgba(255,140,0,.06), transparent 55%);
  mix-blend-mode: screen; opacity:.9; z-index:0; }
.card-toggle{ position:absolute; opacity:0; pointer-events:none; }
.content{ display:none; padding:12px; position:relative; z-index:1; }
.card-toggle:checked ~ .content{ display:block; }
.chev{ width:10px; height:10px; margin-right:6px; transform: rotate(0); transition: transform .15s ease; border:2px solid #ffd3d3; border-left:0; border-top:0; display:inline-block; }
.card-toggle:checked ~ .header .chev{ transform: rotate(45deg); }
.header{ display:flex; align-items:center; gap:10px; padding:10px 12px;
  background: linear-gradient(to bottom, var(--panel-strong) 65%, transparent);
  border-bottom:1px solid rgba(225,53,53,.25); position:relative; z-index:2; }
.header-main{ display:flex; align-items:center; gap:10px; flex:1; cursor:pointer; user-select:none; }
.title{ font-weight:800; letter-spacing:.3px; text-shadow:0 1px 0 rgba(0,0,0,.5); flex:1; font-size:16px; }
.meta{ color:var(--muted); font-size:12px; margin-right:8px; white-space:nowrap; }
.btn{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:10px; text-decoration:none; font-weight:700; color:#fff;
  background: linear-gradient(180deg,#e83a3a,#9e1818); border:1px solid rgba(0,0,0,.4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 6px 16px rgba(232,58,58,.25); }
.content p{ margin:0 0 .9rem; }
.content .bb_paragraph{ margin:0 0 .9rem; }
.content .bb_h2, .content h2{
  margin:1rem 0 .55rem; font-size:1.12rem; line-height:1.2; font-weight:900; letter-spacing:.3px;
  border-left:4px solid var(--accent); padding-left:.55rem; text-shadow:0 1px 0 rgba(0,0,0,.55); }
.content .bb_h3, .content h3{
  margin:.85rem 0 .4rem; font-size:.95rem; line-height:1.2; font-weight:900; color:#e02121; text-transform:uppercase; }
.content ul{ margin:.1rem 0 .9rem 1.15rem; padding:0; }
.content ul li{ margin:.28rem 0; }
.content a{ color:#e02121; text-decoration:none; border-bottom:1px dashed rgba(225,53,53,.55); }
.content a:hover{ color:#fff; border-bottom-color:#fff; }
.content .bb_link_host{ display:none; }
.content img{ display:block; width:100%; height:auto; border-radius:0; border:1px solid rgba(225,53,53,0); margin:.6rem 0; box-shadow:0 12px 40px rgba(0,0,0,.6); }
.content img:hover{ transform:translateY(-1px); transition: transform .15s ease; }
.content hr{ border:0; height:1px; background:rgba(225,53,53,.28); margin:1rem 0; }
.content p:empty{ display:none; }
`;

// Compose the static embed HTML. The embed uses the accordion layout with
// checkboxes. The first article can be optionally expanded by passing
// open=true.
function buildEmbedHTML(items) {
  let html = `<!DOCTYPE html>\n`;
  html += `<html lang="en" data-theme="dark">\n<head>\n`;
  html += `<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>\n`;
  html += `<title>Folklore Hunter — News</title>\n`;
  // Use <base target> so that all links trigger the UE popup handler
  html += `<base target="_blank">\n`;
  html += `<style>${GLOBAL_CSS}</style>\n`;
  html += `</head>\n<body>\n`;
  html += `<div class="wrap"><div class="list">\n`;
  items.forEach((item, idx) => {
    const checked = idx === 0 ? "checked" : "";
    const safeTitle = escapeHtml(item.title);
    const safeDate  = escapeHtml(item.date || "");
    const safeUrl   = attr(item.url);
    html += `  <div class="card">\n`;
    html += `    <input id="card-${idx}" class="card-toggle" type="checkbox" ${checked}>\n`;
    html += `    <div class="header">\n`;
    html += `      <label class="header-main" for="card-${idx}">\n`;
    html += `        <i class="chev"></i>\n`;
    html += `        <div class="title">${safeTitle}</div>\n`;
    html += `        <div class="meta">${safeDate}</div>\n`;
    html += `      </label>\n`;
    html += `      <a class="btn" href="${safeUrl}" rel="noopener">View on Steam</a>\n`;
    html += `    </div>\n`;
    html += `    <section class="content">\n${item.html}\n    </section>\n`;
    html += `  </div>\n`;
  });
  html += `</div></div>\n`;
  html += `</body>\n</html>\n`;
  return html;
}

// Compose a client-side index.html. This page fetches news.json via fetch()
// and builds the same accordion layout in the browser. The CSS is shared.
function buildIndexHTML() {
  return `<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head>\n` +
         `<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>\n` +
         `<title>Folklore Hunter — News</title>\n` +
         `<base target="_blank">\n` +
         `<style>${GLOBAL_CSS}</style>\n</head>\n<body>\n` +
         `<div class="wrap"><div class="list"></div></div>\n` +
         `<script type="module">\n` +
         `const list = document.querySelector('.list');\n` +
         `const resp = await fetch('news.json', {cache: 'no-store'});\n` +
         `const items = await resp.json();\n` +
         `let html = '';\n` +
         `items.forEach((item, idx) => {\n` +
         `  const checked = idx === 0 ? 'checked' : '';\n` +
         `  const safeTitle = (item.title || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));\n` +
         `  const safeDate  = (item.date || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));\n` +
         `  const safeUrl   = (item.url || '').replace(/"/g, '&quot;');\n` +
         `  html += '<div class="card">';\n` +
         `  html += '<input id="card-' + idx + '" class="card-toggle" type="checkbox" ' + checked + '>' ;\n` +
         `  html += '<div class="header">';\n` +
         `  html += '<label class="header-main" for="card-' + idx + '">';\n` +
         `  html += '<i class="chev"></i>';\n` +
         `  html += '<div class="title">' + safeTitle + '</div>';\n` +
         `  html += '<div class="meta">' + safeDate + '</div>';\n` +
         `  html += '</label>';\n` +
         `  html += '<a class="btn" href="' + safeUrl + '" rel="noopener">View on Steam</a>';\n` +
         `  html += '</div>';\n` +
         `  html += '<section class="content">' + item.html + '</section>';\n` +
         `  html += '</div>';\n` +
         `});\n` +
         `list.innerHTML = html;\n` +
         `</script>\n</body>\n</html>\n`;
}

// Escape HTML special characters in strings
function escapeHtml(str = "") {
  return str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Escape double quotes for attributes
function attr(str = "") {
  return str.replace(/"/g, '&quot;');
}

// Unwrap Steam's linkfilter redirect to reveal the actual URL
function unwrapLinkfilter(html) {
  return html.replace(/https:\/\/steamcommunity\.com\/linkfilter\/\?u=([^"'&]+)/g, (_match, enc) => {
    try {
      return decodeURIComponent(enc);
    } catch (e) {
      return enc;
    }
  });
}

// Remove completely empty <p> tags (just whitespace) to reduce noise
function stripEmptyParagraphs(html) {
  return html.replace(/<p>\s*<\/p>/gi, '');
}

async function fetchAndBuild() {
  // Fetch the RSS feed
  const res = await fetch(FEED_URL, {
    headers: { 'accept': 'application/rss+xml,application/xml,text/xml' }
  });
  if (!res.ok) throw new Error(`Failed to fetch RSS: ${res.status} ${res.statusText}`);
  const rssText = await res.text();

  // Parse the RSS XML
  const parsed = await parseStringPromise(rssText);
  const items = (parsed?.rss?.channel?.[0]?.item || []);

  // Set up DOMPurify for sanitization
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);

  // Map items to our article structure
  const articles = items.map((it) => {
    const title = (it.title?.[0] || 'Untitled').toString();
    const url   = (it.link?.[0] || '#').toString();
    const date  = (it.pubDate?.[0] || '').toString();
    const raw   = (it['content:encoded']?.[0] || it.description?.[0] || '').toString();
    // Normalize content: unwrap linkfilter and remove empty paragraphs
    const normalized = stripEmptyParagraphs(unwrapLinkfilter(raw));
    // Sanitize HTML; allow only safe tags and attributes
    const cleaned = DOMPurify.sanitize(normalized, {
      ALLOWED_TAGS: ['p','b','strong','i','em','ul','ol','li','h2','h3','img','a','hr','code','blockquote','span','div','br'],
      ALLOWED_ATTR: ['src','href','target','rel','class','alt']
    });
    return { title, url, date, html: cleaned };
  }).slice(0, MAX_ITEMS);

  // Write JSON file
  await writeFile('docs/news.json', JSON.stringify(articles, null, 2), 'utf8');

  // Write embed HTML
  const embedHtml = buildEmbedHTML(articles);
  await writeFile('docs/embed.html', embedHtml, 'utf8');

  // Write index HTML
  const indexHtml = buildIndexHTML();
  await writeFile('docs/index.html', indexHtml, 'utf8');
}

fetchAndBuild().catch((err) => {
  console.error(err);
  process.exit(1);
});