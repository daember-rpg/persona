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
for (const [name, file] of Object.entries({ "persona-director": "director", "persona-gallery": "gallery", "persona-row": "row", "persona-tile": "tile", "persona-doc-mini": "doc-mini", "persona-seal": "seal", "persona-notes": "notes" })) {
    Handlebars.registerPartial(name, read(`templates/partials/${file}.hbs`));
}
const panel = Handlebars.compile(read("templates/panel.hbs"));
const card = Handlebars.compile(read("templates/card.hbs"));
const documentView = Handlebars.compile(read("templates/document.hbs"));
const { sealSvg, tornClip, tiltOf, TORN_EDGES, PAPERS } = await import(new URL("../scripts/documents.js", import.meta.url));

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

/* ---------- documents ---------- */
const mapSvg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#d9c79c"/><path d="M0 70 C60 60 90 110 150 95 S240 40 300 70 S380 120 400 100 L400 0 L0 0Z" fill="#9fb3b0" opacity=".6"/><path d="M0 70 C60 60 90 110 150 95 S240 40 300 70 S380 120 400 100" fill="none" stroke="#5b4a32" stroke-width="2"/><g fill="none" stroke="#5b4a32" stroke-width="1.6"><path d="M60 200 l18-28 18 28M90 210 l22-34 22 34M130 196 l16-24 16 24"/><path d="M250 180 c20-10 40 10 60 0 s30-20 50 -6" stroke-dasharray="5 5"/><path d="M200 120 C210 160 190 200 230 240 S300 260 330 250" stroke-width="2.4" stroke="#6d8a92"/></g><g fill="#5b4a32" font-family="serif" font-size="13" font-style="italic"><text x="40" y="240">Ashen Peaks</text><text x="230" y="150">the old road</text><text x="150" y="40">Sea of Glass</text></g><path d="M318 216 l14 14 M332 216 l-14 14" stroke="#8e1f1b" stroke-width="3.5" stroke-linecap="round"/><circle cx="350" cy="260" r="22" fill="none" stroke="#5b4a32"/><path d="M350 236 v48 M326 260 h48" stroke="#5b4a32"/><text x="346" y="232" font-size="10" fill="#5b4a32">N</text></svg>`)}`;
const docLook = (id, entry, sealed) => {
    const torn = TORN_EDGES[entry.paper];
    const mark = entry.sealMark?.startsWith("fa-") ? { icon: entry.sealMark } : { text: (entry.sealMark || entry.title || entry.name).slice(0, entry.sealMark ? 2 : 1).toUpperCase() };
    return {
        paper: entry.paper,
        paperIcon: PAPERS.find(p => p.id === entry.paper).icon,
        paperLabel: t(`PERSONA.Doc.Paper.${entry.paper}`),
        clip: torn ? `clip-path: ${tornClip(id, torn)};` : "",
        tilt: `--tilt: ${tiltOf(id, entry.paper)}deg;`,
        hasSeal: entry.sealed !== false,
        sealed: entry.sealed !== false && sealed,
        seal: entry.sealed !== false ? sealSvg(id, entry.sealColor ?? "crimson") : "",
        sealColor: entry.sealColor ?? "crimson",
        mark,
        mapImg: entry.paper === "map" ? mapSvg : ""
    };
};
const DOCS = {
    d1: { paper: "letter", name: "A letter for the Captain", title: "Aldric Venn", sealColor: "crimson", sealMark: "fa-solid fa-chess-rook",
        dateline: "Valtoria, third of Frostfall",
        body: "<p>Captain,</p><p>The cart that passes the north gate at the new moon is not to be stopped, searched or spoken of. You will find the ledger short by one line each month; let it stay short.</p><p>Burn this when you have read it. I will know if you have not.</p>",
        secret: "<p>Postscript, in lemon juice: <em>The Ashen King's envoy rides with it. Count the guards.</em></p>" },
    d2: { paper: "decree", name: "By Order of the Regent", title: "Aldric Venn, Regent of Embermark", sealColor: "gold", sealMark: "fa-solid fa-crown",
        dateline: "Given at the Ember Throne, first of Frostfall",
        body: "<p>Be it known to every soul within the walls of Valtoria that, from this day until the thaw, no blade shall be carried in the streets after the evening bell, save by the Watch.</p><p>Whoever is found in breach of this decree shall answer to the Captain of the Guard.</p>" },
    d3: { paper: "note", name: "Scrap from the Copper Kettle", title: "— N.", sealed: false,
        body: "<p>Back room. Midnight. Come alone or don't come.</p><p>Bring the coin you owe.</p>",
        secret: "<p>(scratched on the back) the bartender listens</p>" },
    d4: { paper: "map", name: "The old road to the Ashen Peaks", title: "", sealColor: "black", sealMark: "fa-solid fa-skull",
        dateline: "Copied from the chapel archive", body: "" }
};
const docContext = (id, sealed, gm = false) => {
    const e = DOCS[id];
    return {
        id, isGM: gm, isDocument: true, ...docLook(id, e, sealed),
        name: e.name, signature: e.title, dateline: e.dateline,
        body: e.body, secret: id === "d1" && !sealed ? null : null, hiddenHint: !!e.secret,
        tab: "private", showPrivate: !gm, privateNote: "", notes: [], canWriteShared: true,
        audit: null, shareTargets: null
    };
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
        { id: "g1", label: "Embermark", icon: "fa-solid fa-fort-awesome", color: "#b4643e", color: "#b4643e", count: 4 },
        { id: "g2", label: "Veiled Order", icon: "fa-solid fa-eye", color: "#8a5a8f", count: 3 },
        { id: "places", label: t("PERSONA.Filter.Places"), icon: "fa-solid fa-map-location-dot", count: 3 }
    ],
    sections: [
        {
            id: "_docs", label: t("PERSONA.Doc.Folder"), icon: "fa-solid fa-scroll", count: 2, isLoose: true, items: [
                { id: "d1", kind: "document", name: DOCS.d1.name, title: DOCS.d1.title, isDocument: true, doc: docLook("d1", DOCS.d1, true), hasJournal: false,
                  layers: [{ key: "face", label: t("PERSONA.Doc.Layer.face"), state: "some", count: "1/4", icon: "fa-solid fa-eye" }, { key: "secret", label: t("PERSONA.Doc.Layer.secret"), state: "none", icon: "fa-solid fa-eye-slash" }] },
                { id: "d4", kind: "document", name: DOCS.d4.name, title: "", isDocument: true, doc: docLook("d4", DOCS.d4, false), hasJournal: true,
                  layers: [{ key: "face", label: t("PERSONA.Doc.Layer.face"), state: "all", icon: "fa-solid fa-eye" }, { key: "secret", label: t("PERSONA.Doc.Layer.secret"), state: "none", icon: "fa-solid fa-eye-slash", disabled: true }] }
            ]
        },
        {
            id: "g1", label: "Embermark", icon: "fa-solid fa-chess-rook", color: "#b4643e", count: 4, items: [
                row("e1", "Captain Ilsa Marrow", "Captain of the guard", ["all", "all", "some", "none"], { isOpen: true, grid }),
                row("e2", "Lord Aldric Venn", "Regent of Embermark", ["all", "all", "all", "some"], { hasVideo: true }),
                row("e3", "Sister Hesper", "Healer at the Ash Chapel", ["all", "some", "none", "none"], { isSharing: true }),
                row("e4", "Old Bram", "Innkeeper", ["all", "all", "all", "none"], { status: "dead" })
            ]
        },
        { id: "g2", label: "Veiled Order", icon: "fa-solid fa-eye", color: "#8a5a8f", count: 3, collapsed: true, items: [] },
        {
            id: "g3", label: "Kurdrax", icon: "fa-solid fa-skull", color: "#c8452f", count: 2, items: [
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
            .map(([label, count], i) => ({ id: `x${i}`, label, color: ["#b4643e", "#74864a", "#4f7a8a", "#8a5a8f", "#c9a35a", "#c8452f", "#5d6b9a"][i], count })),
        { id: "places", label: t("PERSONA.Filter.Places"), icon: "fa-solid fa-map-location-dot", count: 2 }
    ],
    sections: [
        {
            id: "_docs", label: t("PERSONA.Doc.Folder"), icon: "fa-solid fa-scroll", count: 4, people: [], places: [],
            documents: [
                { id: "d1", kind: "document", isDocument: true, name: DOCS.d1.name, isNew: true, doc: docLook("d1", DOCS.d1, true) },
                { id: "d2", kind: "document", isDocument: true, name: DOCS.d2.name, doc: docLook("d2", DOCS.d2, false) },
                { id: "d3", kind: "document", isDocument: true, name: DOCS.d3.name, isPrivate: true, doc: docLook("d3", DOCS.d3, false) },
                { id: "d4", kind: "document", isDocument: true, name: DOCS.d4.name, doc: docLook("d4", DOCS.d4, true) }
            ]
        },
        {
            id: "g1", label: "Embermark", icon: "fa-solid fa-chess-rook", color: "#b4643e", count: 4,
            people: [tile("e1", "Captain Ilsa Marrow", "Captain", { isNew: true }), tile("e2", "Lord Aldric Venn", "Regent"), tile("e3", "Sister Hesper", "Healer", { isPrivate: true }), tile("e4", "Old Bram", "Innkeeper", { status: "dead" })],
            places: [tile("p1", "The Copper Kettle", "Inn", { kind: "place", wide: true }), tile("p2", "Ash Chapel", "Temple", { kind: "place", wide: true })]
        },
        {
            id: "g3", label: "Kurdrax", icon: "fa-solid fa-skull", color: "#c8452f", count: 3,
            people: [tile("e8", "The Ashen King", "Lord of Kurdrax", { dark: true }), tile("e10", "Nyx", "Knife-for-hire"), tile("e13", null, "", { dark: true })], places: []
        },
        { id: "g2", label: "Veiled Order", icon: "fa-solid fa-eye", color: "#8a5a8f", count: 3, collapsed: true, people: [], places: [] }
    ]
};

const cardData = {
    kind: "npc", kindLabel: t("PERSONA.Kind.npc"), named: true, name: "Captain Ilsa Marrow", title: "Captain of the Embermark guard",
    img: avatar("Captain Ilsa Marrow"), frame: "", isGM: false, showPrivate: false, canWriteShared: true,
    groups: [{ color: "#b4643e", label: "Embermark" }, { color: "#4f7a8a", label: "City Watch" }],
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
.pv-view--docs .persona-card-layer { top: 52px; }
.pv-view--docs .persona-card-layer > div { display: contents; }
.pv-view--docs .persona-card-layer > div[hidden] { display: none; }
.pv-papers { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); z-index: 1500; display: flex; gap: 6px; }
.pv-papers button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 999px; font: 500 12.5px/1 Spectral, serif; color: rgba(239,227,200,.7); background: rgba(20,17,15,.86); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.pv-papers button[aria-pressed="true"] { color: #ecd28a; box-shadow: inset 0 0 0 1px rgba(212,178,90,.45); background: rgba(40,33,20,.92); }
.pv-view--docs .persona-docview { margin-top: 36px; }
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
    <button type="button" data-view="docs" aria-pressed="false">Documents</button>
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

<section class="pv-view pv-view--card pv-view--docs" data-view="docs" hidden>
    <div class="pv-papers">
        ${Object.entries(DOCS).map(([id, e], i) => `<button type="button" data-doc="${id}" aria-pressed="${i === 0}">${t(`PERSONA.Doc.Paper.${e.paper}`)}</button>`).join("")}
        <button type="button" data-reseal>Seal again</button>
    </div>
    ${Object.keys(DOCS).map((id, i) => `
    <div class="persona persona-card-layer is-document" data-docview="${id}" ${i ? "hidden" : ""}>
        <div data-state="sealed" ${DOCS[id].sealed === false ? "hidden" : ""}>${documentView(docContext(id, true))}</div>
        <div data-state="open" ${DOCS[id].sealed === false ? "" : "hidden"}>${documentView(docContext(id, false))}</div>
    </div>`).join("")}
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
// Documents: switch paper, break the seal (the module does this in card.js), seal again.
const docButtons = document.querySelectorAll(".pv-papers [data-doc]");
const reset = view => {
    const sealed = view.querySelector('[data-state="sealed"]');
    if (!sealed.innerHTML.includes("persona-doc__seal")) return;
    sealed.hidden = false; view.querySelector('[data-state="open"]').hidden = true;
    sealed.querySelector(".persona-docview")?.classList.remove("is-breaking");
};
docButtons.forEach(b => b.addEventListener("click", () => {
    docButtons.forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    document.querySelectorAll("[data-docview]").forEach(v => { v.hidden = v.dataset.docview !== b.dataset.doc; });
}));
document.querySelector("[data-reseal]").addEventListener("click", () => document.querySelectorAll("[data-docview]").forEach(reset));
document.querySelectorAll("[data-docview]").forEach(view => view.addEventListener("click", e => {
    if (!e.target.closest('[data-action="breakSeal"]')) return;
    const doc = view.querySelector('[data-state="sealed"] .persona-docview');
    if (!doc || doc.classList.contains("is-breaking")) return;
    doc.classList.add("is-breaking");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => { view.querySelector('[data-state="sealed"]').hidden = true; view.querySelector('[data-state="open"]').hidden = false; }, still ? 120 : 1500);
}));
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
