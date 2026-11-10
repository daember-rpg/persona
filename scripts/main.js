/**
 * Persona — the people and places of your story, revealed when you choose,
 * shown to players like handouts.
 */
import { MODULE_ID, TEMPLATE_ROOT, LAYERS } from "./constants.js";
import { registerSettings, getSetting } from "./settings.js";
import { getEntries, getEntry, canSee, newlyVisible, seenIds } from "./store.js";
import { ensureSocket } from "./relay.js";
import { PanelView, PersonaWindow } from "./panel.js";
import { CardOverlay } from "./card.js";
import { EntryEditor } from "./editor.js";
import { VideoPlayer } from "./video.js";
import { Toasts } from "./toasts.js";
import { syncFromJournal } from "./entries.js";
import { imageOf } from "./view-data.js";
import { BondsWindow, autoMomentOnLogin, autoMomentAfterCombat } from "./bonds/app.js";

const PARTIALS = {
    "persona-director": `${TEMPLATE_ROOT}/partials/director.hbs`,
    "persona-gallery": `${TEMPLATE_ROOT}/partials/gallery.hbs`,
    "persona-tile": `${TEMPLATE_ROOT}/partials/tile.hbs`,
    "persona-row": `${TEMPLATE_ROOT}/partials/row.hbs`
};

let view, windowApp, card, video, toasts, bonds;
let triad = null;            // Triad's API when docked
let lastReveals = new Map(); // entry id -> reveal, to spot what's new for this user

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
    registerSettings();
    game.keybindings.register(MODULE_ID, "bonds", {
        name: "PERSONA.Keybindings.Bonds",
        editable: [],
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
        onDown: () => { openBonds(); return true; }
    });
    game.keybindings.register(MODULE_ID, "toggle", {
        name: "PERSONA.Keybindings.Toggle",
        editable: [{ key: "KeyP", modifiers: ["Alt"] }],
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
        onDown: () => { toggle(); return true; }
    });
    foundry.applications.handlebars.loadTemplates({
        ...PARTIALS,
        "persona-panel": `${TEMPLATE_ROOT}/panel.hbs`,
        "persona-card": `${TEMPLATE_ROOT}/card.hbs`,
        "persona-editor": `${TEMPLATE_ROOT}/editor.hbs`
    });
});

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", () => {
    ensureSocket();
    if (game.user.isGM && typeof socketlib === "undefined") {
        ui.notifications.warn(game.i18n.localize("PERSONA.Warn.NoSocketlib"));
    }

    video = new VideoPlayer();
    card = new CardOverlay({ replayVideo: id => replayVideo(id) });
    toasts = new Toasts({ openCard: id => card.open(id) });
    view = new PanelView({
        openCard: id => card.open(id),
        openEditor: id => openEditor(id),
        playEntryVideo: id => playEntryVideo(id),
        playFile: () => pickAndPlay(),
        openBonds: () => openBonds()
    });
    bonds = new BondsWindow({ openCard: id => card.open(id) });
    windowApp = new PersonaWindow(view);

    video.sync();
    lastReveals = snapshotReveals();
    lastHandout = getSetting("handout")?.nonce ?? null; // don't replay an old handout on login

    if (getSetting("dockInTriad") && game.triad?.api?.registerDock) dockIntoTriad(game.triad.api);
    updateBadge();
    autoMomentOnLogin();

    const api = {
        open, close, toggle,
        openCard: id => card.open(id),
        openBonds: key => openBonds(key),
        playVideo: (path, title, subtitle) => VideoPlayer.playForAll({ path, title, subtitle }),
        stopVideo: () => VideoPlayer.stopForAll()
    };
    game.persona = { api, view, card, video, toasts, bonds };
    game.modules.get(MODULE_ID).api = api;
    Hooks.callAll(`${MODULE_ID}.ready`, api);
});

Hooks.on("triad.ready", api => {
    if (view && getSetting("dockInTriad")) dockIntoTriad(api);
});

function dockIntoTriad(api) {
    if (triad) return;
    const host = api.registerDock({
        id: MODULE_ID,
        label: "PERSONA.Title",
        icon: "fa-solid fa-masks-theater",
        order: 40
    });
    triad = api;
    view.mount(host);
    updateBadge();
}

/* -------------------------------------------- */
/*  Opening                                     */
/* -------------------------------------------- */

function open() {
    if (triad) return triad.focusTab(MODULE_ID);
    return windowApp.render({ force: true });
}

function close() {
    if (triad) return game.triad?.tray?.setOpen?.(false, { byUser: true });
    return windowApp.close();
}

function toggle() {
    if (triad) {
        const tray = game.triad?.tray;
        if (tray?.showTab) return tray.showTab(MODULE_ID);
        return triad.focusTab(MODULE_ID);
    }
    return windowApp.rendered ? windowApp.close() : windowApp.render({ force: true });
}

Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools[MODULE_ID] = {
        name: MODULE_ID,
        title: "PERSONA.Controls.Toggle",
        icon: "fa-solid fa-masks-theater",
        order: Object.keys(tokens.tools).length + 1,
        button: true,
        visible: true,
        onChange: () => toggle()
    };
});

/** The Bonds wheel: opens on a character (key = its primary sheet's actor id), or the one in use. */
function openBonds(key = null) {
    return bonds?.show(key);
}

function openEditor(id) {
    const existing = foundry.applications.instances?.get(`persona-editor-${id ?? "new"}`);
    if (existing) return existing.bringToFront?.() ?? existing.render({ force: true });
    return new EntryEditor(id).render({ force: true });
}

/* -------------------------------------------- */
/*  Video helpers                               */
/* -------------------------------------------- */

function playEntryVideo(id) {
    const entry = getEntry(id);
    if (!entry?.video) return;
    return VideoPlayer.playForAll({ path: entry.video, title: entry.name, subtitle: entry.title });
}

function replayVideo(id) {
    const entry = getEntry(id);
    if (!entry?.video || !canSee(entry, "face")) return;
    const named = canSee(entry, "name");
    video.playLocal({ path: entry.video, title: named ? entry.name : "", subtitle: named ? entry.title : "" });
}

function pickAndPlay() {
    const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new Picker({
        type: "video",
        callback: path => {
            const title = decodeURIComponent(path.split("/").pop() ?? "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
            VideoPlayer.playForAll({ path, title });
        }
    }).browse();
}

/* -------------------------------------------- */
/*  Live updates                                */
/* -------------------------------------------- */

function snapshotReveals() {
    return new Map(getEntries().map(entry => [entry.id, foundry.utils.deepClone(entry.reveal)]));
}

const TOAST_LABEL = {
    face: "PERSONA.Toast.Face",
    name: "PERSONA.Toast.Name",
    summary: "PERSONA.Toast.Summary",
    secret: "PERSONA.Toast.Secret"
};

/** Players: a notice for each thing the GM just revealed to them. */
function announceReveals() {
    const before = lastReveals;
    lastReveals = snapshotReveals();
    lastHandout = getSetting("handout")?.nonce ?? null; // don't replay an old handout on login
    if (game.user.isGM || !getSetting("revealToasts")) return;
    for (const entry of getEntries()) {
        const gained = newlyVisible(before.get(entry.id) ?? {}, entry.reveal, game.user.id);
        if (!gained.length) continue;
        // Report the deepest layer gained.
        const layer = [...LAYERS].reverse().find(l => gained.includes(l));
        toasts.show({
            id: entry.id,
            img: imageOf(entry),
            label: game.i18n.localize(TOAST_LABEL[layer]),
            name: canSee(entry, "name") ? entry.name : "???"
        });
    }
}

/** Players: the GM showed a card to this user (or everyone) — open it, like a handout. */
let lastHandout = null;
function receiveHandout() {
    const handout = getSetting("handout") ?? {};
    if (!handout.nonce || handout.nonce === lastHandout) return;
    lastHandout = handout.nonce;
    if (game.user.isGM) return;
    if (handout.who !== "all" && handout.who !== game.user.id) return;
    const entry = getEntry(handout.entryId);
    if (entry && canSee(entry, "face")) card.open(entry.id);
}

/** Triad tab dot: something new this player hasn't opened yet. */
function updateBadge() {
    if (!triad?.setDockBadge || game.user.isGM) return;
    const seen = seenIds();
    const fresh = getEntries().some(e => canSee(e, "face") && !seen.has(e.id));
    triad.setDockBadge(MODULE_ID, fresh);
}

Hooks.on(`${MODULE_ID}.changed`, key => {
    if (!view) return;
    switch (key) {
        case "entries":
            announceReveals();
            view.requestRender();
            card.refresh();
            updateBadge();
            bonds?.refresh();
            break;
        case "groups":
            view.requestRender();
            card.refresh();
            bonds?.refresh();
            break;
        case "moments":
        case "officialLinks":
        case "characters":
            bonds?.refresh();
            break;
        case "video":
        case "videoVolume":
            video.sync();
            break;
        case "sharedNotes":
            card.refresh();
            break;
        case "handout":
            receiveHandout();
            break;
    }
});

Hooks.on("updateUser", (user, changes) => {
    if (!view) return;
    if (user.isSelf && changes.flags?.[MODULE_ID]) {
        view.requestRender();
        updateBadge();
    }
    if (game.user.isGM && ("name" in changes || "color" in changes || "role" in changes)) view.requestRender();
    // Bonds: someone's wheel, character or avatar changed.
    if (changes.flags?.[MODULE_ID] || "character" in changes || "avatar" in changes || "name" in changes || "role" in changes) bonds?.refresh();
});
for (const hook of ["createUser", "deleteUser"]) Hooks.on(hook, () => { view?.requestRender(); bonds?.refresh(); });
// Bonds: a moment after each combat, if the GM wants it.
Hooks.on("deleteCombat", combat => autoMomentAfterCombat(combat));
// "In scene": who has a token on the scene being viewed.
for (const hook of ["canvasReady", "createToken", "deleteToken"]) Hooks.on(hook, () => bonds?.refresh());
// A party member's portrait or name.
Hooks.on("updateActor", (actor, changes) => {
    if (!("img" in changes || "name" in changes || "ownership" in changes)) return;
    if (actor.type === "character" || game.users.some(u => u.character?.id === actor.id)) bonds?.refresh();
});
for (const hook of ["createActor", "deleteActor"]) Hooks.on(hook, actor => { if (actor.type === "character") bonds?.refresh(); });
// Selecting a player character's token opens that character's wheel (players: their own characters).
Hooks.on("controlToken", (token, controlled) => { if (controlled) bonds?.followToken(token.actor); });

Hooks.on("updateJournalEntryPage", page => syncFromJournal(page));
