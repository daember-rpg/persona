/**
 * Builds dev/panel-preview.html: the real Persona templates (panel, director, gallery, card)
 * rendered with mock data and persona.css, shown docked in a Triad-like tray and as a
 * standalone window — to check the look without opening Foundry.
 * Run: npm i --no-save handlebars && node dev/build-panel-preview.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");
const require = createRequire(process.env.HANDLEBARS_FROM ?? import.meta.url);
const Handlebars = require("handlebars");

/* ---------- localize ---------- */
const lang = JSON.parse(read("lang/en.json"));
const t = key => key.split(".").reduce((o, k) => o?.[k], lang) ?? key;
Handlebars.registerHelper("localize", key => t(key));
for (const [name, file] of Object.entries({ "persona-director": "director", "persona-gallery": "gallery", "persona-row": "row", "persona-tile": "tile" })) {
    Handlebars.registerPartial(name, read(`templates/partials/${file}.hbs`));
}
const panel = Handlebars.compile(read("templates/panel.hbs"));
const card = Handlebars.compile(read("templates/card.hbs"));

/* ---------- mock data ---------- */
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (name, { dark = false, wide = false } = {}) => {
    const h = hue(name);
    const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const [w, hh] = wide ? [320, 180] : [120, 160];
    const svg = wide
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},35%,38%)"/><stop offset="1" stop-color="hsl(${(h + 30) % 360},30%,10%)"/></linearGradient></defs><rect width="${w}" height="${hh}" fill="url(#s)"/><path d="M0 130 L60 90 L110 120 L170 70 L230 110 L320 80 L320 180 L0 180z" fill="hsla(${h},25%,8%,.75)"/><circle cx="250" cy="45" r="16" fill="hsla(45,70%,80%,.5)"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}"><defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="hsl(${h},45%,${dark ? 30 : 48}%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},40%,12%)"/></radialGradient></defs><rect width="${w}" height="${hh}" fill="url(#g)"/><circle cx="60" cy="58" r="26" fill="hsla(${h},30%,85%,.22)"/><path d="M14 160c4-38 22-58 46-58s42 20 46 58z" fill="hsla(${h},30%,85%,.18)"/><text x="60" y="68" font-family="Cinzel,serif" font-size="26" font-weight="700" text-anchor="middle" fill="hsla(40,60%,92%,.92)">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const players = [
    { id: "p1", name: "Ana", color: "#d4b25a" },
    { id: "p2", name: "Bruno", color: "#8fb0c9" },
    { id: "p3", name: "Caio", color: "#8a9a5b" },
    { id: "p4", name: "Duda", color: "#d0708f" }
];
const LAYERS = ["face", "name", "summary", "secret"];
const layerRow = states => LAYERS.map((k, i) => {
    const state = states[i];
    const count = state === "some" ? 2 : 0;
    return { key: k, label: t(`PERSONA.Layer.${k}`), state, count, icon: state === "none" ? "fa-solid fa-eye-slash" : "fa-solid fa-eye", tooltip: t(`PERSONA.Layer.${k}`) };
});
const row = (id, name, title, states, extra = {}) => ({
    id, name, title, img: avatar(name, extra), frame: "", layers: layerRow(states), hasJournal: true, ...extra,
    status: extra.status, statusLabel: extra.status ? t(`PERSONA.Status.${extra.status}`) : ""
});

const grid = {
    players: players.map(p => ({ ...p, initial: p.name[0] })),
    rows: LAYERS.map((k, i) => {
        const on = [[1, 1, 1, 1], [1, 1, 0, 1], [1, 0, 0, 0], [0, 0, 0, 0]][i];
        return { key: k, label: t(`PERSONA.Layer.${k}`), all: on.every(Boolean), some: on.some(Boolean) && !on.every(Boolean), disabled: false, cells: players.map((p, j) => ({ userId: p.id, name: p.name, on: !!on[j] })) };
    })
};

const director = {
    isGM: true, search: "", hasPlayers: true, canArrange: true,
    chips: [
        { id: "all", label: t("PERSONA.Filter.All"), icon: "fa-solid fa-users", count: 14, active: true },
        { id: "g1", label: "Embermark", icon: "fa-solid fa-fort-awesome", count: 4 },
        { id: "g2", label: "Veiled Order", icon: "fa-solid fa-eye", count: 3 },
        { id: "places", label: t("PERSONA.Filter.Places"), icon: "fa-solid fa-map-location-dot", count: 3 }
    ],
    sections: [
        {
            id: "g1", label: "Embermark", icon: "fa-solid fa-chess-rook", count: 4, items: [
                row("e1", "Captain Ilsa Marrow", "Captain of the guard", ["all", "all", "some", "none"], { isOpen: true, grid }),
                row("e2", "Lord Aldric Venn", "Regent of Embermark", ["all", "all", "all", "some"], { hasVideo: true }),
                row("e3", "Sister Hesper", "Healer at the Ash Chapel", ["all", "some", "none", "none"], { isSharing: true }),
                row("e4", "Old Bram", "Innkeeper", ["all", "all", "all", "none"], { status: "dead" })
            ]
        },
        { id: "g2", label: "Veiled Order", icon: "fa-solid fa-eye", count: 3, collapsed: true, items: [] },
        {
            id: "g3", label: "Kurdrax", icon: "fa-solid fa-skull", count: 2, items: [
                row("e8", "The Ashen King", "Lord of Kurdrax", ["some", "none", "none", "none"], { dark: true }),
                row("e9", "Gorrik Ironjaw", "Champion of Kurdrax", ["all", "all", "some", "none"], { status: "missing" })
            ]
        }
    ]
};

const tile = (id, name, title, extra = {}) => ({ id, name, title, kind: extra.kind ?? "npc", img: avatar(name ?? id, extra), frame: "", ...extra, statusLabel: extra.status ? t(`PERSONA.Status.${extra.status}`) : "", statusIcon: extra.status === "dead" ? "fa-solid fa-skull" : "fa-solid fa-question" });
const gallery = {
    isGM: false, search: "", isEmpty: false, total: 11,
    chips: [
        { id: "all", label: t("PERSONA.Filter.All"), icon: "fa-solid fa-users", count: 11, active: true },
        ...[["Resistência de Valtoria", 2], ["Elfos de Khaledin", 2], ["Heróis de Tarlan", 2], ["Figuras Históricas", 3], ["Os senhores dos Dragões", 3], ["Aliados", 2], ["Campeões de Kurdrax", 4]]
            .map(([label, count], i) => ({ id: `x${i}`, label, icon: "fa-solid fa-city", count })),
        { id: "places", label: t("PERSONA.Filter.Places"), icon: "fa-solid fa-map-location-dot", count: 2 }
    ],
    sections: [
        {
            id: "g1", label: "Embermark", icon: "fa-solid fa-chess-rook", count: 4,
            people: [tile("e1", "Captain Ilsa Marrow", "Captain", { isNew: true }), tile("e2", "Lord Aldric Venn", "Regent"), tile("e3", "Sister Hesper", "Healer", { isPrivate: true }), tile("e4", "Old Bram", "Innkeeper", { status: "dead" })],
            places: [tile("p1", "The Copper Kettle", "Inn", { kind: "place", wide: true }), tile("p2", "Ash Chapel", "Temple", { kind: "place", wide: true })]
        },
        {
            id: "g3", label: "Kurdrax", icon: "fa-solid fa-skull", count: 3,
            people: [tile("e8", "The Ashen King", "Lord of Kurdrax", { dark: true }), tile("e10", "Nyx", "Knife-for-hire"), tile("e13", null, "", { dark: true })], places: []
        },
        { id: "g2", label: "Veiled Order", icon: "fa-solid fa-eye", count: 3, collapsed: true, people: [], places: [] }
    ]
};

const cardData = {
    kind: "npc", kindLabel: t("PERSONA.Kind.npc"), named: true, name: "Captain Ilsa Marrow", title: "Captain of the Embermark guard",
    img: avatar("Captain Ilsa Marrow"), frame: "", isGM: false, showPrivate: false, canWriteShared: true,
    groups: [{ icon: "fa-solid fa-chess-rook", label: "Embermark" }, { icon: "fa-solid fa-shield-halved", label: "City Watch" }],
    summary: "<p>Twenty years on the walls and never once late to a watch. Ilsa keeps the gate ledger herself and trusts no clerk with it.</p><p>She owes Lord Venn her post, and everyone at the Copper Kettle knows she hates it.</p>",
    secret: "<p>She lets one cart through the north gate every new moon, unchecked.</p>",
    people: [], places: [{ id: "p1", name: "The Copper Kettle" }, { id: "p2", name: "North Gate" }],
    notes: [
        { id: "n1", initial: "A", color: "#d4b25a", text: "She recognised Kaelen's crest. Ask about the old war.", author: "Ana", canDelete: true },
        { id: "n2", initial: "B", color: "#8fb0c9", text: "Don't mention the cart. She noticed us watching.", author: "Bruno" }
    ]
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persona Panel Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
${read("styles/persona.css").replace(/^@import[^\n]*\n/, "")}
/* ---------- Preview chrome (not part of the module) ---------- */
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; }
body {
    font-family: var(--dp-body); color: var(--dp-parchment);
    background:
        radial-gradient(60% 50% at 70% 40%, rgba(120, 140, 90, 0.18), transparent 70%),
        radial-gradient(40% 40% at 30% 75%, rgba(150, 110, 70, 0.16), transparent 70%),
        repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 100px),
        repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 1px, transparent 1px 100px),
        #23261f;
}
.pv-tabs { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2000; display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(20,17,15,.86); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1), 0 8px 24px rgba(0,0,0,.4); backdrop-filter: blur(10px); }
.pv-tabs button { all: unset; cursor: pointer; padding: 7px 14px; border-radius: 999px; font: 600 10.5px/1 Cinzel, serif; letter-spacing: .12em; text-transform: uppercase; color: rgba(239,227,200,.62); white-space: nowrap; }
.pv-tabs button[aria-pressed="true"] { background: rgba(212,178,90,.15); box-shadow: inset 0 0 0 1px rgba(212,178,90,.45); color: #ecd28a; }
.pv-view { position: fixed; inset: 0; }
.pv-view[hidden] { display: none; }
/* A Triad-like tray: rail of tabs + 320px glass panel with the gold thread. */
.pv-tray { position: absolute; top: 0; bottom: 0; left: 0; display: flex; }
.pv-rail { width: 48px; display: flex; flex-direction: column; padding: 16px 0 16px 6px; }
.pv-pill { display: flex; flex-direction: column; border-radius: 18px; background: rgba(20,17,15,.86); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 10px 22px rgba(0,0,0,.35); padding: 4px 0; }
.pv-pill i { width: 36px; height: 38px; display: grid; place-items: center; font-size: 13px; color: rgba(239,227,200,.62); position: relative; }
.pv-pill i.on { color: #ecd28a; }
.pv-pill i.on::before { content: ""; position: absolute; inset: 5px 4px; border-radius: 50%; background: rgba(212,178,90,.15); box-shadow: inset 0 0 0 1px rgba(212,178,90,.45), 0 0 12px rgba(212,178,90,.25); z-index: -1; }
.pv-panel { position: relative; width: 320px; height: 100%; order: -1; background: radial-gradient(120% 220px at 0 0, rgba(212,178,90,.07), transparent 70%), rgba(20,17,15,.86); border-right: 1px solid rgba(255,255,255,.08); box-shadow: 8px 0 32px rgba(0,0,0,.42); backdrop-filter: blur(12px) saturate(120%); }
.pv-panel::after { content: ""; position: absolute; top: 0; right: -1px; bottom: 0; width: 1px; background: linear-gradient(180deg, transparent 4%, rgba(212,178,90,.45) 30%, rgba(212,178,90,.2) 70%, transparent 96%); }
.pv-panel .triad-dock { position: absolute; inset: 0; overflow: hidden; }
/* A Foundry V13 window for the standalone panel. */
.pv-window { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); width: 380px; height: min(720px, calc(100% - 88px)); display: grid; grid-template-rows: 36px minmax(0,1fr); grid-template-columns: minmax(0,1fr); border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.1), 0 24px 60px rgba(0,0,0,.55); }
.pv-window > header { display: flex; align-items: center; gap: 10px; padding: 0 12px; background: #15120f; border-bottom: 1px solid rgba(255,255,255,.08); font: 600 13px Cinzel, serif; letter-spacing: .06em; color: rgba(239,227,200,.8); }
.pv-window > header span { flex: 1; }
.pv-window > header i { color: rgba(239,227,200,.5); font-size: 12px; }
.pv-window .window-content { min-height: 0; }
.pv-view--card .persona-card-layer { position: absolute; }
@media (max-width: 700px) {
    .pv-tabs { top: auto; bottom: 12px; }
    .pv-rail { display: none; }
    .pv-panel { width: 100vw; }
    .pv-window { inset: 0; transform: none; width: auto; height: auto; border-radius: 0; }
}
</style></head>
<body>
<nav class="pv-tabs">
    <button type="button" data-view="docked" aria-pressed="true">Director · in Triad</button>
    <button type="button" data-view="window" aria-pressed="false">Player · window</button>
    <button type="button" data-view="card" aria-pressed="false">Card</button>
</nav>

<section class="pv-view" data-view="docked">
    <div class="pv-tray">
        <div class="pv-rail"><div class="pv-pill"><i class="fa-solid fa-user"></i><i class="fa-solid fa-scroll"></i><i class="fa-solid fa-masks-theater on"></i><i class="fa-solid fa-hourglass-half"></i></div></div>
        <div class="pv-panel"><div class="triad-dock" data-dock="persona"><div class="persona persona-host">${panel(director)}</div></div></div>
    </div>
</section>

<section class="pv-view" data-view="window" hidden>
    <div class="pv-window persona-window">
        <header><i class="fa-solid fa-masks-theater"></i><span>Persona</span><i class="fa-solid fa-xmark"></i></header>
        <div class="window-content"><div class="persona persona-host">${panel(gallery)}</div></div>
    </div>
</section>

<section class="pv-view pv-view--card" data-view="card" hidden>
    <div class="persona persona-card-layer">${card(cardData)}</div>
</section>

<script>
// The chip row's edge fades (the module does this in panel.js).
document.querySelectorAll(".persona-head .persona-chips").forEach(row => {
    const edges = () => {
        row.classList.toggle("has-more-left", row.scrollLeft > 2);
        row.classList.toggle("has-more-right", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
    };
    row.addEventListener("scroll", edges, { passive: true });
    row.addEventListener("wheel", e => { if (row.scrollWidth > row.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); row.scrollLeft += e.deltaY; } }, { passive: false });
    row.addEventListener("click", e => {
        const chip = e.target.closest(".persona-chip"); if (!chip) return;
        row.querySelectorAll(".persona-chip").forEach(c => c.classList.toggle("is-active", c === chip));
        chip.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    });
    new ResizeObserver(edges).observe(row);
    edges();
});
const tabs = document.querySelectorAll(".pv-tabs button");
const show = view => {
    tabs.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    document.querySelectorAll(".pv-view").forEach(v => v.hidden = v.dataset.view !== view);
    try { localStorage.setItem("pv-view", view); } catch {}
};
tabs.forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
const start = new URLSearchParams(location.search).get("view");
let saved = null; try { saved = localStorage.getItem("pv-view"); } catch {}
show(start ?? saved ?? "docked");
</script>
</body></html>`;

writeFileSync(join(root, "dev/panel-preview.html"), html);
console.log("Wrote dev/panel-preview.html");
