/**
 * Group notes are shared world data, which only a GM can write. Players send their note
 * through socketlib; the active GM's client checks it and saves it.
 */
import { MODULE_ID } from "./constants.js";
import { updateSetting, canSee, getEntry } from "./store.js";

let socket = null;

export function ensureSocket() {
    if (socket) return socket;
    if (typeof socketlib === "undefined") return null;
    try {
        socket = socketlib.registerModule(MODULE_ID);
        socket.register("addNote", gmAddNote);
        socket.register("deleteNote", gmDeleteNote);
    } catch (error) {
        console.error(`${MODULE_ID} | socketlib registration failed`, error);
        socket = null;
    }
    return socket;
}

Hooks.once("socketlib.ready", () => ensureSocket());

/** True when this user can write group notes right now. */
export function canWriteSharedNotes() {
    if (game.user.isGM) return true;
    return !!ensureSocket() && !!game.users.activeGM;
}

export function addSharedNote(entryId, text) {
    const clean = String(text ?? "").trim().slice(0, 2000);
    if (!clean) return;
    if (game.user.isGM) return gmAddNote(entryId, clean, game.user.id);
    if (!canWriteSharedNotes()) return ui.notifications.warn(game.i18n.localize("PERSONA.Warn.NoRelay"));
    return socket.executeAsGM("addNote", entryId, clean, game.user.id);
}

export function deleteSharedNote(entryId, noteId) {
    if (game.user.isGM) return gmDeleteNote(entryId, noteId, game.user.id);
    if (!canWriteSharedNotes()) return ui.notifications.warn(game.i18n.localize("PERSONA.Warn.NoRelay"));
    return socket.executeAsGM("deleteNote", entryId, noteId, game.user.id);
}

async function gmAddNote(entryId, text, userId) {
    const user = game.users.get(userId);
    const entry = getEntry(entryId);
    // Players can only write about what they know.
    if (!user || !entry || !canSee(entry, "face", user)) return;
    await updateSetting("sharedNotes", notes => {
        const list = notes[entryId] ?? [];
        list.push({ id: foundry.utils.randomID(), userId, text: String(text).slice(0, 2000), ts: Date.now() });
        notes[entryId] = list;
        return notes;
    });
}

async function gmDeleteNote(entryId, noteId, userId) {
    const user = game.users.get(userId);
    if (!user) return;
    await updateSetting("sharedNotes", notes => {
        const list = notes[entryId] ?? [];
        // Authors delete their own notes; GMs delete any.
        notes[entryId] = list.filter(n => !(n.id === noteId && (user.isGM || n.userId === userId)));
        return notes;
    });
}
