/**
 * Bonds belong to a character of the story, not to a user or a single sheet.
 *
 * - A "character" is one person in the story. By default every player character sheet (an Actor
 *   of type "character" owned by a player, or a player's assigned character) is its own character.
 * - The GM can say "this sheet is the same person as that one" (e.g. the same hero in two
 *   realities, a cleric in one and a paladin in the other): both sheets then share one wheel.
 * - The GM can retire characters (end of a chapter): their wheels are kept, read-only, under
 *   "Past characters", and they leave the party ring. New characters start with fresh wheels.
 *
 * Registry (world setting `characters`, GM-written): { aliases: { actorId: primaryActorId }, retired: [key] }.
 * A character's key is its primary sheet's actor id. Its wheel lives in its main owner's user
 * flags (`flags.persona.wheels.<key>`), which that player can write themselves.
 */
import { MODULE_ID } from "../constants.js";
import { getSetting } from "../settings.js";
import { updateSetting } from "../store.js";
import { normalizeBonds } from "./model.js";

/** Party node ids on the wheel: "c:<character key>". */
export const CHAR_PREFIX = "c:";

export function getRegistry() {
    const raw = getSetting("characters") ?? {};
    return {
        aliases: raw.aliases && typeof raw.aliases === "object" ? { ...raw.aliases } : {},
        retired: Array.isArray(raw.retired) ? [...raw.retired] : []
    };
}

function saveRegistry(change) {
    return updateSetting("characters", raw => {
        const reg = {
            aliases: raw?.aliases && typeof raw.aliases === "object" ? { ...raw.aliases } : {},
            retired: Array.isArray(raw?.retired) ? [...raw.retired] : []
        };
        change(reg);
        return reg;
    });
}

/** Players (not GMs) who own an Actor. */
export function playerOwners(actor) {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    return game.users.filter(u => !u.isGM && (actor.testUserPermission?.(u, OWNER) ?? (actor.ownership?.[u.id] ?? actor.ownership?.default ?? 0) >= OWNER));
}

/** Player character sheets: type "character" owned by a player, plus every player's assigned character. */
export function pcActors() {
    const set = new Map();
    for (const actor of game.actors) if (actor.type === "character" && playerOwners(actor).length) set.set(actor.id, actor);
    for (const user of game.users) if (!user.isGM && user.character) set.set(user.character.id, user.character);
    return [...set.values()];
}

/** The character key a sheet belongs to. */
export function keyOf(actorId, reg = getRegistry()) {
    const target = reg.aliases[actorId];
    return target && game.actors.get(target) ? target : actorId;
}

/**
 * Every character, with its sheets and owners.
 * @param activeActorIds sheets in use right now (the viewer's selected tokens), to pick the face shown
 */
export function characters(activeActorIds = new Set()) {
    const reg = getRegistry();
    const map = new Map();
    for (const actor of pcActors()) {
        const key = keyOf(actor.id, reg);
        const entry = map.get(key) ?? { key, actors: [], owners: new Set(), retired: reg.retired.includes(key) };
        entry.actors.push(actor);
        for (const u of playerOwners(actor)) entry.owners.add(u);
        if (!entry.owners.size) for (const u of game.users) if (!u.isGM && u.character?.id === actor.id) entry.owners.add(u);
        map.set(key, entry);
    }
    const list = [...map.values()].map(c => {
        const owners = [...c.owners].sort((a, b) => a.name.localeCompare(b.name));
        const primary = game.actors.get(c.key) ?? c.actors[0];
        // The player who keeps the wheel: the one whose assigned character is one of these sheets.
        const owner = owners.find(u => c.actors.some(a => a.id === u.character?.id)) ?? owners[0] ?? null;
        // The face: a sheet in use right now, else the assigned one, else the primary sheet.
        const display = c.actors.find(a => activeActorIds.has(a.id))
            ?? c.actors.find(a => owners.some(u => u.character?.id === a.id))
            ?? primary;
        return { ...c, owners, owner, primary, display };
    });
    return list.sort((a, b) => (a.owner?.name ?? "").localeCompare(b.owner?.name ?? "") || a.display.name.localeCompare(b.display.name));
}

/** The character a sheet belongs to, if it's a player character. */
export function characterOfActor(actor, list = characters()) {
    if (!actor) return null;
    const key = keyOf(actor.id);
    return list.find(c => c.key === key) ?? null;
}

/* -------------------------------------------- */
/*  Wheels                                      */
/* -------------------------------------------- */

/**
 * A character's wheel. Falls back to the 0.5–0.11 per-user wheel for a player's assigned character,
 * and rewrites old party ids ("u:<userId>") to character ids.
 */
export function wheelOf(character) {
    if (!character?.owner) return normalizeBonds(null);
    const owner = character.owner;
    let raw = owner.getFlag(MODULE_ID, "wheels")?.[character.key];
    if (!raw && character.actors.some(a => a.id === owner.character?.id)) raw = owner.getFlag(MODULE_ID, "bonds");
    return migrateLinks(normalizeBonds(raw));
}

/** Old wheels pointed party links at users; point them at those users' characters. */
export function migrateLinks(bonds) {
    if (!bonds.links.some(l => l.a.startsWith("u:") || l.b.startsWith("u:"))) return bonds;
    const map = id => {
        if (!id.startsWith("u:")) return id;
        const actor = game.users.get(id.slice(2))?.character;
        return actor ? `${CHAR_PREFIX}${keyOf(actor.id)}` : id;
    };
    return normalizeBonds({ ...bonds, links: bonds.links.map(l => ({ ...l, a: map(l.a), b: map(l.b) })) });
}

/** Saves a character's wheel to its owner's flags: the owner themselves, or the GM. */
export function saveWheel(character, bonds) {
    const owner = character?.owner;
    if (!owner) return Promise.reject(new Error("This character has no player"));
    if (!game.user.isGM && owner.id !== game.user.id) return Promise.reject(new Error("Not allowed to edit this wheel"));
    return owner.update({ [`flags.${MODULE_ID}.wheels.${character.key}`]: normalizeBonds(bonds) });
}

/** A moment's copy of a character's wheel (moments before 0.12 were keyed by user). */
export function momentWheel(moment, character) {
    const raw = moment?.wheels?.[character.key]
        ?? (character.owner && character.actors.some(a => a.id === character.owner.character?.id) ? moment?.wheels?.[character.owner.id] : null);
    return raw ? migrateLinks(normalizeBonds(raw)) : null;
}

/* -------------------------------------------- */
/*  GM: same person, retire                     */
/* -------------------------------------------- */

/** "This sheet is the same person as that character" (null = its own character again). */
export function setSamePerson(actorId, targetKey) {
    return saveRegistry(reg => {
        const target = targetKey && targetKey !== actorId ? keyOf(targetKey, reg) : null;
        if (target) {
            reg.aliases[actorId] = target;
            // Sheets that pointed at this one follow it to its new character.
            for (const [id, to] of Object.entries(reg.aliases)) if (to === actorId) reg.aliases[id] = target;
        } else {
            delete reg.aliases[actorId];
        }
        delete reg.aliases[target];
    });
}

export function setRetired(key, retired) {
    return saveRegistry(reg => {
        reg.retired = reg.retired.filter(k => k !== key);
        if (retired) reg.retired.push(key);
    });
}
