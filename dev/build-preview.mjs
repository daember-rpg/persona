/**
 * Builds dev/bonds-preview.html: the real Bonds code (model.js + view.js) and persona.css,
 * inlined into one standalone page with mock data — to check the wheel without opening Foundry.
 * Run: node dev/build-preview.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");
const strip = src => src.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "").replace(/^export\s+/gm, "");

const code = strip(read("scripts/bonds/model.js")) + "\n" + strip(read("scripts/bonds/view.js"));
const css = read("styles/persona.css").replace(/^@import[^\n]*\n/, "");
const lang = { en: JSON.parse(read("lang/en.json")) };
const mock = read("dev/preview-mock.js");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persona Bonds Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
${css}
/* Preview chrome (not part of the module) */
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #0b0a09; }
body { font-family: var(--dp-body); color: var(--dp-parchment); }
.pv { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; }
.pv-bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 16px; background: #151310; border-bottom: 1px solid var(--dp-line); font-size: 13px; }
.pv-bar b { font-family: var(--dp-display); letter-spacing: .08em; }
.pv-bar label { display: inline-flex; gap: 6px; align-items: center; color: var(--dp-parchment-dim); }
.pv-bar select, .pv-bar button { font: inherit; background: var(--dp-charcoal-2); color: var(--dp-parchment); border: 1px solid var(--dp-line-strong); border-radius: 4px; padding: 4px 8px; }
.pv-bar button { cursor: pointer; }
.pv-note { margin-left: auto; color: var(--dp-parchment-faint); font-size: 12px; }
.pv-stage { padding: 16px; min-height: 0; }
.pv-window { height: 100%; max-width: 1180px; margin: 0 auto; border: 1px solid var(--dp-line-strong); border-radius: 8px; overflow: hidden; display: grid; grid-template-rows: 30px minmax(0, 1fr); box-shadow: 0 20px 60px rgba(0,0,0,.6); }
.pv-titlebar { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #23201c; font-family: var(--dp-display); font-size: 13px; color: var(--dp-parchment-dim); }
.pv-card { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(10,9,8,.72); z-index: 50; }
.pv-card[hidden] { display: none; }
.pv-card article { display: grid; grid-template-columns: 220px 300px; background: var(--dp-charcoal); border: 1px solid var(--dp-line-strong); border-radius: 10px; overflow: hidden; }
.pv-card img { width: 220px; height: 290px; object-fit: cover; display: block; }
.pv-card .body { padding: 20px; }
.pv-card h3 { margin: 4px 0; font-family: var(--dp-display); font-size: 22px; border: 0; }
.pv-card p { color: var(--dp-parchment-dim); font-size: 14px; }
@media (max-width: 760px) {
  .pv-bar { gap: 6px 10px; padding: 8px 10px; font-size: 12px; }
  .pv-bar b, .pv-note, .pv-bar label:nth-of-type(2), #pv-reset { display: none; }
  .pv-stage { padding: 0; }
  .pv-window { border: 0; border-radius: 0; grid-template-rows: minmax(0, 1fr); }
  .pv-titlebar { display: none; }
  .pv-card article { grid-template-columns: 1fr; width: calc(100vw - 32px); }
  .pv-card img { width: 100%; height: 240px; }
}
</style></head>
<body>
<div class="pv">
  <div class="pv-bar">
    <b>Persona · Bonds</b>
    <label>View as <select id="pv-role"></select></label>
    <button type="button" id="pv-reveal">Reveal someone</button>
    <button type="button" id="pv-kill">Kill Captain Ilsa</button>
    <button type="button" id="pv-reality">Thorne: switch reality</button>
    <button type="button" id="pv-reset">Reset</button>
    <span class="pv-note">Preview: the module's own wheel code, with sample data.</span>
  </div>
  <div class="pv-stage"><div class="pv-window"><div class="pv-titlebar"><i class="fa-solid fa-circle-nodes"></i><span id="pv-title">Bonds</span></div><div id="bonds-root" class="persona-bonds-host"></div></div></div>
</div>
<div class="pv-card" id="pv-card" hidden><article><img id="pv-card-img" alt=""><div class="body"><span class="persona-eyebrow" id="pv-card-kind"></span><h3 id="pv-card-name"></h3><p id="pv-card-title"></p><p id="pv-card-text"></p></div></article></div>
<script>
const LANG = ${JSON.stringify(lang)};
${code}
${mock}
</script>
</body></html>`;

writeFileSync(join(root, "dev/bonds-preview.html"), html);
console.log("dev/bonds-preview.html", (html.length / 1024).toFixed(0), "KB");
