/**
 * Data access for entries (people and places), groups, reveals and notes.
 * Reveal rules are pure functions so they can be tested without Foundry.
 */
import { MODULE_ID, LAYERS, ALL } from "./constants.js";
import { getSetting, setSetting } from "./settings.js";

/* -------------------------------------------- */
/*  Serialized writes                           */
/* -------------------------------------------- */

const queues = new Map();

/**
 * Applies `mutate` to the latest value of a world setting, one write at a time per key,
 * so quick consecutive clicks never overwrite each other.
 */
export function updateSetting(key, mutate) {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
        const current = foundry.utils.deepClone(getSetting(key) ?? {});
        const updated = (await mutate(current)) ?? current;
        await setSetting(key, updated);
        return updated;
    });
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
    return next;
}

/* -------------------------------------------- */
/*  Players and reveal rules (pure)             */
/* -------------------------------------------- */

/** Every non-GM user, online or not, by name. */
export function players() {
    return game.users.filter(u => !u.isGM).sort((a, b) => a.name.localeCompare(b.name));
}

export function emptyReveal() {
    return Object.fromEntries(LAYERS.map(layer => [layer, []]));
}

/** Can this user see this layer of the entry? GMs see everything. */
export function canSee(entry, layer, user = game.user) {
    if (!entry) return false;
    if (user?.isGM) return true;
    const list = entry.reveal?.[layer] ?? [];
    return list.includes(ALL) || list.includes(user?.id);
}

/** Who sees a layer: { all, ids } — `ids` are the players who see it individually. */
export function audienceOf(entry, layer, playerIds) {
    const list = entry.reveal?.[layer] ?? [];
    const all = list.includes(ALL);
    return { all, ids: all ? [...playerIds] : playerIds.filter(id => list.includes(id)) };
}

/**
 * Sets one layer for one audience ("all" or a user id) to shown or hidden. Pure: returns a new reveal.
 * Showing a layer also shows the layers before it (no name without a face);
 * hiding a layer also hides the layers after it.
 */
export function setLayer(reveal, layer, who, on, playerIds) {
    const next = Object.fromEntries(LAYERS.map(key => [key, [...(reveal?.[key] ?? [])]]));
    const index = LAYERS.indexOf(layer);
    if (index < 0) return next;
    const keys = on ? LAYERS.slice(0, index + 1) : LAYERS.slice(index);
    for (const key of keys) {
        let list = next[key];
        if (who === ALL) {
            list = on ? [ALL] : [];
        } else if (on) {
            if (!list.includes(ALL) && !list.includes(who)) list = [...list, who];
            // Everyone individually → "all", so players who join later see it too.
            if (playerIds.length && playerIds.every(id => list.includes(id))) list = [ALL];
        } else {
            list = list.includes(ALL) ? playerIds.filter(id => id !== who) : list.filter(id => id !== who);
        }
        next[key] = list;
    }
    return next;
}

/** Back-compat helper: flips a layer for an audience. */
export function toggleLayer(reveal, layer, who, playerIds) {
    const list = reveal?.[layer] ?? [];
    const sees = who === ALL ? list.includes(ALL) : list.includes(ALL) || list.includes(who);
    return setLayer(reveal, layer, who, !sees, playerIds);
}

/** Layers that became visible to `userId` between two reveals. */
export function newlyVisible(before, after, userId) {
    const sees = (reveal, layer) => {
        const list = reveal?.[layer] ?? [];
        return list.includes(ALL) || list.includes(userId);
    };
    return LAYERS.filter(layer => !sees(before, layer) && sees(after, layer));
}

/* -------------------------------------------- */
/*  Entries                                     */
/* -------------------------------------------- */

export function normalizeEntry(raw = {}) {
    return {
        id: raw.id ?? foundry.utils.randomID(),
        kind: raw.kind === "place" ? "place" : "npc",
        name: String(raw.name ?? ""),
        title: String(raw.title ?? ""),
        img: String(raw.img ?? ""),
        summary: String(raw.summary ?? ""),
        secret: String(raw.secret ?? ""),
        groups: Array.isArray(raw.groups) ? [...new Set(raw.groups.map(String))] : [],
        places: Array.isArray(raw.places) ? [...new Set(raw.places.map(String))] : [],
        video: String(raw.video ?? ""),
        journalUuid: String(raw.journalUuid ?? ""),
        actorUuid: String(raw.actorUuid ?? ""),
        syncJournal: raw.syncJournal !== false,
        // Alive, dead or missing — set by the GM, shown on cards and in every player's Bonds wheel.
        status: ["alive", "dead", "missing"].includes(raw.status) ? raw.status : "alive",
        // Framing of the portrait (as players see it): focus point in % and zoom.
        focusX: Number.isFinite(Number(raw.focusX)) ? Math.min(100, Math.max(0, Number(raw.focusX))) : 50,
        focusY: Number.isFinite(Number(raw.focusY)) ? Math.min(100, Math.max(0, Number(raw.focusY))) : 20,
        zoom: Number.isFinite(Number(raw.zoom)) ? Math.min(3, Math.max(1, Number(raw.zoom))) : 1,
        reveal: Object.fromEntries(LAYERS.map(layer => [layer, Array.isArray(raw.reveal?.[layer]) ? [...raw.reveal[layer]] : []])),
        sort: Number.isFinite(raw.sort) ? raw.sort : Date.now(),
        // Manual position set by the GM's drag and drop; null = not arranged yet (alphabetical, after arranged ones).
        order: Number.isFinite(raw.order) ? raw.order : null
    };
}

/** GM's manual order first, then by name. Players see the same order. */
export function compareEntries(a, b) {
    const ao = a.order ?? Infinity, bo = b.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
}

export function getEntries() {
    return Object.values(getSetting("entries") ?? {})
        .map(normalizeEntry)
        .sort(compareEntries);
}

export function getEntry(id) {
    const raw = getSetting("entries")?.[id];
    return raw ? normalizeEntry(raw) : null;
}

export function saveEntry(entry) {
    const clean = normalizeEntry(entry);
    return updateSetting("entries", all => { all[clean.id] = clean; return all; }).then(() => clean);
}

export function patchEntry(id, mutate) {
    return updateSetting("entries", all => {
        if (!all[id]) return all;
        const entry = normalizeEntry(all[id]);
        all[id] = normalizeEntry(mutate(entry) ?? entry);
        return all;
    });
}

export async function deleteEntry(id) {
    await updateSetting("entries", all => {
        delete all[id];
        for (const entry of Object.values(all)) entry.places = (entry.places ?? []).filter(p => p !== id);
        return all;
    });
    await updateSetting("sharedNotes", notes => { delete notes[id]; return notes; });
}

export function setReveal(id, layer, who, on) {
    const ids = players().map(u => u.id);
    return patchEntry(id, entry => ({ ...entry, reveal: setLayer(entry.reveal, layer, who, on, ids) }));
}

/** Everything to everyone, or hide everything from everyone. */
export function setRevealAll(id, on) {
    return patchEntry(id, entry => ({ ...entry, reveal: Object.fromEntries(LAYERS.map(l => [l, on ? [ALL] : []])) }));
}

/** Links (or unlinks) a person to a place. Stored on the person. */
export function linkToPlace(personId, placeId, on) {
    return patchEntry(personId, entry => {
        const places = new Set(entry.places);
        if (on) places.add(placeId); else places.delete(placeId);
        return { ...entry, places: [...places] };
    });
}

/* -------------------------------------------- */
/*  Groups                                      */
/* -------------------------------------------- */

export function getGroups() {
    return Object.values(getSetting("groups") ?? {})
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label));
}

export async function createGroup(label, icon = "fa-solid fa-bookmark") {
    const text = String(label ?? "").trim();
    if (!text) return null;
    const existing = getGroups().find(g => g.label.toLowerCase() === text.toLowerCase());
    if (existing) return existing.id;
    const id = foundry.utils.randomID();
    await updateSetting("groups", groups => {
        groups[id] = { id, label: text, icon, order: Object.keys(groups).length };
        return groups;
    });
    return id;
}

/**
 * GM drag and drop: moves an entry just before `beforeId` (or to the end of `toGroup`'s entries),
 * and from folder `fromGroup` into folder `toGroup` when they differ.
 * Folder ids: a group id, "_none" (No group), or null to leave the groups as they are.
 * Every entry gets a fresh `order`, so the arrangement is stable from then on.
 */
export function moveEntry(id, { fromGroup = null, toGroup = null, beforeId = null } = {}) {
    return updateSetting("entries", all => {
        if (!all[id]) return all;
        const list = Object.values(all).map(normalizeEntry).sort(compareEntries);
        const entry = list.find(e => e.id === id);
        const rest = list.filter(e => e.id !== id);

        if (toGroup !== null && toGroup !== fromGroup) {
            const groups = new Set(entry.groups);
            if (fromGroup && fromGroup !== "_none") groups.delete(fromGroup);
            if (toGroup === "_none") groups.clear();
            else groups.add(toGroup);
            entry.groups = [...groups];
        }

        let at = beforeId ? rest.findIndex(e => e.id === beforeId) : -1;
        if (at < 0) {
            // End of the target folder: right after its last entry, else the very end.
            const inFolder = e => toGroup === "_none" ? !e.groups.length : toGroup ? e.groups.includes(toGroup) : true;
            const last = rest.map(inFolder).lastIndexOf(true);
            at = last >= 0 ? last + 1 : rest.length;
        }
        rest.splice(at, 0, entry);
        rest.forEach((e, i) => { all[e.id] = normalizeEntry({ ...all[e.id], groups: e.id === id ? entry.groups : all[e.id].groups, order: i }); });
        return all;
    });
}

/** GM drag and drop: moves a folder just before another (or to the end). */
export function moveGroup(id, beforeId = null) {
    return updateSetting("groups", groups => {
        const list = Object.values(groups).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label));
        const moving = list.find(g => g.id === id);
        if (!moving || id === beforeId) return groups;
        const rest = list.filter(g => g.id !== id);
        const at = beforeId ? rest.findIndex(g => g.id === beforeId) : -1;
        rest.splice(at < 0 ? rest.length : at, 0, moving);
        rest.forEach((g, i) => { groups[g.id] = { ...groups[g.id], order: i }; });
        return groups;
    });
}

export async function deleteGroup(id) {
    await updateSetting("groups", groups => { delete groups[id]; return groups; });
    await updateSetting("entries", all => {
        for (const entry of Object.values(all)) entry.groups = (entry.groups ?? []).filter(g => g !== id);
        return all;
    });
}

/* -------------------------------------------- */
/*  Per-user state: seen + private notes        */
/* -------------------------------------------- */

export function seenIds(user = game.user) {
    return new Set(user.getFlag(MODULE_ID, "seen") ?? []);
}

export async function markSeen(id) {
    const seen = seenIds();
    if (seen.has(id)) return;
    seen.add(id);
    await game.user.setFlag(MODULE_ID, "seen", [...seen]);
}

export function privateNote(id) {
    return game.user.getFlag(MODULE_ID, "notes")?.[id] ?? "";
}

export function savePrivateNote(id, text) {
    return game.user.update({ [`flags.${MODULE_ID}.notes.${id}`]: String(text ?? "") });
}

export function sharedNotes(id) {
    return [...(getSetting("sharedNotes")?.[id] ?? [])].sort((a, b) => a.ts - b.ts);
}

/* -------------------------------------------- */
/*  Images inside Journal text                  */
/* -------------------------------------------- */

/** First <img src> in an HTML string (Kanka and many Journals put the portrait in the text). */
export function firstImageIn(html) {
    const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(String(html ?? ""));
    return match ? match[1].replace(/&amp;/g, "&") : "";
}

/** Removes the image used as the portrait from a story, and any wrapper left empty. */
export function withoutImage(html, src) {
    if (!src) return html;
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "(?:&|&amp;)");
    let out = String(html ?? "").replace(new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*["']${escaped}["'][^>]*>`, "gi"), "");
    for (let i = 0; i < 3; i++) out = out.replace(/<(p|figure|div|a|span)\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/\1>/gi, "");
    return out;
}

/* -------------------------------------------- */
/*  Handouts: open a card on players' screens   */
/* -------------------------------------------- */

/**
 * GM: reveals the face and name to `who` ("all" or a user id) — so it stays in their gallery —
 * then pops the card open on their screens.
 */
export async function showHandout(entryId, who) {
    if (!game.user.isGM || !getEntry(entryId)) return;
    await setReveal(entryId, "name", who, true);
    await setSetting("handout", { nonce: foundry.utils.randomID(), entryId, who, ts: Date.now() });
}

/** Removes every image from a story (the card already shows the portrait), and wrappers left empty. */
export function withoutImages(html) {
    let out = String(html ?? "").replace(/<img\b[^>]*>/gi, "");
    for (let i = 0; i < 3; i++) out = out.replace(/<(p|figure|div|a|span)\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/\1>/gi, "");
    return out;
}
