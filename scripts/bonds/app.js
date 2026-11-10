/**
 * Bonds in Foundry: the window, the data adapter for the wheel, and moments (timeline snapshots).
 *
 * - A wheel belongs to a character of the story (see characters.js): one or more sheets the GM
 *   marked as the same person. It lives in its player's user flags, which they may write themselves.
 *   A player edits their own characters' wheels; the GM edits anyone's; retired ones are read-only.
 * - The wheel only ever draws people the character's player can see in Persona (face revealed),
 *   through the same cards: players never touch an Actor or its sheet.
 * - Moments are world data written by the GM: a snapshot of every wheel and every status.
 */
import { MODULE_ID } from "../constants.js";
import { getSetting } from "../settings.js";
import { getEntries, getEntry, getGroups, canSee, seenIds, updateSetting } from "../store.js";
import { imageOf, frameStyle } from "../view-data.js";
import { BondsView } from "./view.js";
import { normalizeBonds, normalizeOfficial, diffWheels, setShared, SECTOR_COLORS, NO_TAG } from "./model.js";
import { CHAR_PREFIX, characters, characterOfActor, wheelOf, saveWheel, momentWheel, setSamePerson, setRetired } from "./characters.js";

const t = key => game.i18n.localize(key);

/* -------------------------------------------- */
/*  Data                                        */
/* -------------------------------------------- */

/** A character as a portrait on the wheel. */
function portrait(c) {
    return { id: `${CHAR_PREFIX}${c.key}`, name: c.display.name, img: c.display.img || "icons/svg/mystery-man.svg" };
}

/** Sheets the viewer is using right now (selected tokens), to show the right face. */
function activeSheets() {
    const ids = new Set();
    for (const token of canvas?.tokens?.controlled ?? []) if (token.actor) ids.add(token.actor.id);
    if (game.user.character) ids.add(game.user.character.id);
    return ids;
}

/** The GM's Persona folders as the wheel's default slices, in folder order. */
function folderTags() {
    return getGroups().map((g, i) => ({ key: g.id, label: g.label, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
}

/**
 * Wheels from 0.5.0–0.5.3 had hand-made slices, often copies of the folders. A category named like
 * a folder becomes that folder's slice again (its people go back to "follow the folder").
 */
function migrate(bonds) {
    const labels = new Set(getGroups().map(g => g.label.trim().toLowerCase()));
    const copies = new Set(bonds.sectors.filter(s => labels.has(s.label.trim().toLowerCase())).map(s => s.id));
    if (!copies.size) return bonds;
    return normalizeBonds({ ...bonds, placements: bonds.placements.map(p => copies.has(p.sector) ? { ...p, sector: null } : p) });
}

/** The GM's official links (all of them; filtered per viewer in the model). */
export function getOfficial() {
    return normalizeOfficial(getSetting("officialLinks"));
}

export function saveOfficial(list) {
    if (!game.user.isGM) return Promise.reject(new Error("Only the GM sets official links"));
    return updateSetting("officialLinks", () => Object.fromEntries(normalizeOfficial(list).map(l => [l.id, l])));
}

/** Entry ids with a token on the scene currently viewed (by their linked Actor). */
function inScene(entries) {
    const scene = canvas?.scene;
    if (!scene) return null;
    const actors = new Set();
    for (const token of scene.tokens) {
        if (token.actorId) actors.add(`Actor.${token.actorId}`);
        const uuid = token.actor?.uuid;
        if (uuid) actors.add(uuid);
    }
    return entries.filter(e => e.actorUuid && actors.has(e.actorUuid)).map(e => e.id);
}

/**
 * What changed for this player since they last acknowledged it: people newly revealed to them,
 * status changes (deaths, disappearances), official links that became visible.
 * The first time, the snapshot is taken silently so nobody gets a flood of "new" people.
 */
function changesFor(owner, known, official) {
    const seen = owner.getFlag(MODULE_ID, "bondsSeen");
    if (!seen) return { changes: null, snapshot: true };
    const knownBefore = new Set(seen.known ?? []);
    const statusBefore = seen.statuses ?? {};
    const linksBefore = new Set(seen.links ?? []);
    const newIds = known.filter(e => !knownBefore.has(e.id)).map(e => e.id);
    const statusIds = known.filter(e => knownBefore.has(e.id) && (statusBefore[e.id] ?? "alive") !== e.status).map(e => e.id);
    const linkIds = official.filter(l => !linksBefore.has(l.id)).map(l => l.id);
    const any = newIds.length || statusIds.length || linkIds.length;
    return { changes: any ? { newIds, statusIds, linkIds } : null, snapshot: false };
}

function snapshotFor(known, official) {
    return {
        known: known.map(e => e.id),
        statuses: Object.fromEntries(known.map(e => [e.id, e.status])),
        links: official.map(l => l.id)
    };
}

export function getMoments() {
    return Object.values(getSetting("moments") ?? {}).sort((a, b) => a.ts - b.ts);
}

export async function recordMoment(label, auto = null) {
    if (!game.user.isGM) return;
    const id = foundry.utils.randomID();
    const wheels = Object.fromEntries(characters().filter(c => c.owner).map(c => [c.key, wheelOf(c)]));
    const statuses = Object.fromEntries(getEntries().map(e => [e.id, e.status]));
    await updateSetting("moments", moments => {
        moments[id] = { id, label: String(label).slice(0, 60), ts: Date.now(), wheels, statuses, auto };
        return moments;
    });
    return id;
}

/* -------------------------------------------- */
/*  Automatic moments                           */
/* -------------------------------------------- */

const SESSION_GAP = 6 * 60 * 60 * 1000; // a GM login this long after the last moment = a new session

/** Only one client records: the active GM. */
function isRecorder() {
    return game.user.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id;
}

const dateLabel = () => new Date().toLocaleDateString(game.i18n.lang, { day: "numeric", month: "short" });

/** At the start of a session: how every wheel looked when the table sat down. */
export async function autoMomentOnLogin() {
    if (!isRecorder() || !["session", "both"].includes(getSetting("autoMoment"))) return;
    if (!characters().some(c => !c.retired)) return;
    const last = getMoments().at(-1);
    if (last && Date.now() - last.ts < SESSION_GAP) return;
    const n = getMoments().filter(m => m.auto === "session").length + 1;
    await recordMoment(game.i18n.format("PERSONA.Bonds.AutoSession", { n, date: dateLabel() }), "session");
}

/** After a fight: what changed in the heat of it. */
export async function autoMomentAfterCombat(combat) {
    if (!isRecorder() || !["combat", "both"].includes(getSetting("autoMoment"))) return;
    if (!combat?.started && !combat?.round) return;
    const scene = combat.scene?.name ?? game.scenes.get(combat.scene)?.name ?? "";
    await recordMoment(game.i18n.format("PERSONA.Bonds.AutoCombat", { scene: scene || dateLabel() }), "combat");
}

export function deleteMoment(id) {
    return updateSetting("moments", moments => { delete moments[id]; return moments; });
}

/* -------------------------------------------- */
/*  Window                                      */
/* -------------------------------------------- */

export class BondsWindow extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "persona-bonds",
        classes: ["persona-window", "persona-bonds-window"],
        window: { title: "PERSONA.Bonds.Title", icon: "fa-solid fa-circle-nodes", resizable: true },
        position: { width: 1120, height: 820 }
    };

    #host = null;
    view = null;
    /** Whose wheel is shown: a character key. */
    ownerId = null;
    momentId = null;
    /** Players: also show the wheels the party shares. Everyone: show retired characters. */
    partyView = false;
    pastView = false;

    constructor({ openCard }, options = {}) {
        super(options);
        this.openCard = openCard;
    }

    /** Opens on a character's wheel: a given key, or the one in use (selected token, assigned sheet). */
    async show(key = null) {
        this.ownerId = key ?? this.ownerId;
        await this.render({ force: true });
        this.bringToFront?.();
    }

    /** Selecting a token of a player character switches the wheel to it (players: only their own). */
    followToken(actor) {
        if (!this.rendered || !actor) return;
        const c = characterOfActor(actor);
        if (!c) return;
        if (!game.user.isGM && !c.owners.some(u => u.id === game.user.id)) return;
        if (c.key === this.ownerId) return this.refresh();
        this.ownerId = c.key;
        this.momentId = null;
        this.pastView = c.retired;
        this.refresh();
    }

    async _renderHTML() {
        return null;
    }

    _replaceHTML(_result, content) {
        if (this.#host?.isConnected && this.view) return this.view.refresh();
        this.#host = document.createElement("div");
        this.#host.className = "persona-bonds-host";
        content.replaceChildren(this.#host);
        this.view = new BondsView(this.#host, this.#adapter());
    }

    _onClose(options) {
        super._onClose(options);
        this.view?.destroy();
        this.view = null;
        this.#host = null;
        this.momentId = null;
    }

    refresh() {
        if (this.rendered) this.view?.refresh();
    }

    #current() {
        return characters(activeSheets()).find(c => c.key === this.ownerId) ?? null;
    }

    #adapter() {
        return {
            t: key => game.i18n.localize(key),
            getModel: () => this.buildModel(),
            saveBonds: bonds => saveWheel(this.#current(), bonds),
            openCard: id => this.openCard(id),
            selectPlayer: key => { this.ownerId = key; this.momentId = null; this.view?.refresh(); },
            togglePartyView: () => { this.partyView = !this.partyView; this.momentId = null; this.view?.refresh(); },
            togglePastView: () => {
                this.pastView = !this.pastView;
                // Leaving the past: back to a character in play.
                if (!this.pastView) this.ownerId = null;
                this.momentId = null;
                this.view?.refresh();
            },
            setShared: shared => {
                const c = this.#current();
                return saveWheel(c, setShared(wheelOf(c), shared));
            },
            setSamePerson: (actorId, key) => setSamePerson(actorId, key || null),
            setRetired: (key, retired) => setRetired(key, retired),
            selectMoment: id => { this.momentId = id; this.view?.refresh(); },
            recordMoment: () => this.#promptMoment(),
            saveOfficial: list => saveOfficial(list),
            ackChanges: () => this.#ack(),
            notify: message => ui.notifications.warn(message),
            getLinkStyle: () => (this.linkStyle ??= getSetting("bondsLinkStyle")),
            setLinkStyle: style => { this.linkStyle = style; return game.settings.set(MODULE_ID, "bondsLinkStyle", style); },
            deleteMoment: id => this.#confirmDelete(id)
        };
    }

    /** The wheel's data for the current character and moment (see BondsView for the shape). */
    buildModel() {
        const isGM = game.user.isGM;
        const me = game.user;
        const all = characters(activeSheets());
        const mine = c => c.owners.some(u => u.id === me.id);
        const active = all.filter(c => !c.retired);
        // Players may look at the wheels the rest of the party shares (read-only); the GM sees all.
        const shares = c => mine(c) || wheelOf(c).shared;
        const allowed = c => isGM || mine(c) || (this.partyView && !c.retired && shares(c));

        // Whose wheel: the chosen one if still allowed, else the sheet in use, else the first.
        let current = all.find(c => c.key === this.ownerId && allowed(c));
        if (!current) {
            const inUse = [...activeSheets()].map(id => all.find(c => c.actors.some(a => a.id === id))).find(c => c && allowed(c) && !c.retired);
            current = inUse ?? (isGM ? active[0] : active.find(mine)) ?? all.find(allowed) ?? null;
        }
        // Looking at the past: open a retired character.
        const pastList = all.filter(c => c.retired && (isGM || mine(c)));
        if (this.pastView && !current?.retired && pastList.length) current = pastList.find(c => c.key === this.ownerId) ?? pastList[0];
        this.ownerId = current?.key ?? null;
        if (current?.retired) this.pastView = true;

        const moments = getMoments();
        const moment = this.momentId ? moments.find(m => m.id === this.momentId) : null;
        if (this.momentId && !moment) this.momentId = null;

        // The character chips: past ones when looking at the past, else the active ones the viewer may open.
        const past = all.filter(c => c.retired && (isGM || mine(c)));
        const chips = (this.pastView ? past : active.filter(c => isGM || mine(c) || (this.partyView && shares(c))))
            .map(c => ({ id: c.key, name: c.display.name, user: c.owner?.name ?? "", img: c.display.img || "icons/svg/mystery-man.svg", self: !isGM && mine(c), retired: c.retired }));
        const ownActive = active.filter(mine);

        // What changed in each moment for this wheel, against the moment before it.
        const summarize = c => moments.map((m, i) => {
            const prev = moments[i - 1];
            const d = diffWheels(prev && c ? momentWheel(prev, c) : null, c ? momentWheel(m, c) : null, prev?.statuses ?? {}, m.statuses ?? {});
            return { id: m.id, label: m.label, ts: m.ts, auto: m.auto ?? null, diff: { ...d, moves: [...d.moves] } };
        });
        const base = {
            isGM,
            players: (isGM || this.partyView || this.pastView || ownActive.length > 1) ? chips : [],
            canBrowse: !isGM && active.filter(c => !mine(c) && shares(c)).length > 0,
            browsing: !isGM && !!this.partyView,
            hasPast: past.length > 0,
            pastView: !!this.pastView,
            moments: summarize(current),
            momentId: moment?.id ?? null,
            characters: isGM ? this.#characterSheets(all) : null
        };
        if (!current?.owner) {
            return {
                ...base, editable: false, owner: { id: null, name: "" },
                self: { name: "—", img: "icons/svg/mystery-man.svg", sheets: [] }, party: [], entries: [], bonds: null, tags: [],
                official: [], officialAll: [], changes: null, inScene: null, peers: [], overview: isGM ? this.#overview(active) : null
            };
        }

        // People this character's player knows, as they know them (name hidden until revealed).
        // Looking at someone else's wheel, a player only sees the people *they* know too, as they know them.
        const knower = current.owner;
        const other = !isGM && !mine(current);
        const viewer = isGM ? knower : me;
        const seen = seenIds(knower);
        const statusOf = entry => moment?.statuses?.[entry.id] ?? entry.status;
        const known = getEntries().filter(e => e.kind === "npc" && canSee(e, "face", knower) && (!other || canSee(e, "face", me)));
        const tags = folderTags();
        const order = new Map(tags.map((tag, i) => [tag.key, i]));
        const entries = known.map(e => {
            const named = canSee(e, "name", viewer);
            // The person's slice by default: their first folder, in the GM's folder order.
            const tag = [...e.groups].filter(id => order.has(id)).sort((a, b) => order.get(a) - order.get(b))[0] ?? NO_TAG;
            return {
                id: e.id,
                name: named ? e.name : null,
                title: named ? e.title : "",
                img: imageOf(e),
                frame: frameStyle(e),
                status: statusOf(e),
                isNew: !isGM && !other && knower.id === me.id && !seen.has(e.id),
                tag
            };
        });
        const knownIds = new Set(known.map(e => e.id));

        // Official links: both people known, and not hidden (the GM sees all).
        const officialAll = getOfficial();
        const official = officialAll.filter(l => knownIds.has(l.a) && knownIds.has(l.b) && (isGM || !l.hidden));
        // "Since you last looked": only on the player's own wheel, in the present.
        let changes = null;
        if (!isGM && !moment && knower.id === me.id) {
            const result = changesFor(me, known, official.filter(l => !l.hidden));
            changes = result.changes;
            if (result.snapshot) me.setFlag(MODULE_ID, "bondsSeen", snapshotFor(known, official));
        }

        // Where the rest of the party put the same people (ring only), for "What the party thinks".
        const party = active.filter(c => c.key !== current.key && c.owner);
        const peers = party.map(c => {
            const theirs = wheelOf(c);
            const rings = {};
            for (const p of theirs.placements) if (knownIds.has(p.id) && canSee(getEntry(p.id), "face", c.owner)) rings[p.id] = p.ring;
            const { name, img } = portrait(c);
            return { id: c.key, name, img, rings };
        });

        const face = portrait(current);
        const wheel = moment ? momentWheel(moment, current) : wheelOf(current);
        return {
            ...base,
            peers,
            overview: isGM ? this.#overview(active) : null,
            // Moments and retired characters are read-only; otherwise players edit their own characters, the GM anyone's.
            editable: !moment && !current.retired && (isGM || current.owner.id === me.id),
            retired: current.retired,
            owner: { id: current.key, name: face.name },
            self: {
                name: face.name,
                img: face.img,
                sheets: current.actors.length > 1 ? current.actors.map(a => ({ name: a.name, img: a.img, active: a.id === current.display.id })) : []
            },
            party: party.map(portrait),
            entries,
            bonds: this.#forViewer(migrate(normalizeBonds(wheel)), other),
            viewingOther: other,
            tags,
            official: moment ? [] : official,
            officialAll: isGM ? officialAll : [],
            changes,
            inScene: moment ? null : inScene(known)
        };
    }

    /** Someone else's wheel, seen by a player: their private notes stay theirs. */
    #forViewer(bonds, other) {
        if (!other) return bonds;
        return { ...bonds, links: bonds.links.map(l => (l.notePrivate ? { ...l, note: "" } : l)) };
    }

    /** GM: the player sheets, which character each belongs to, and which characters are retired. */
    #characterSheets(all) {
        const reg = all.map(c => ({ key: c.key, name: c.primary.name, retired: c.retired, owner: c.owner?.name ?? "" }));
        const sheets = all.flatMap(c => c.actors.map(a => ({
            id: a.id,
            name: a.name,
            img: a.img || "icons/svg/mystery-man.svg",
            owners: c.owners.map(u => u.name).join(", "),
            key: c.key,
            primary: a.id === c.key || (!game.actors.get(c.key) && a.id === c.actors[0].id),
            retired: c.retired
        })));
        return { sheets, characters: reg };
    }

    /** GM: every person any player knows, against every active character — known? on the wheel? how close? */
    #overview(active) {
        const cols = active.filter(c => c.owner);
        const wheels = new Map(cols.map(c => [c.key, wheelOf(c)]));
        const rows = [];
        for (const e of getEntries().filter(x => x.kind === "npc")) {
            const cells = {};
            let anyone = false;
            for (const c of cols) {
                const known = canSee(e, "face", c.owner);
                anyone ||= known;
                const w = wheels.get(c.key);
                const p = w.placements.find(x => x.id === e.id);
                cells[c.key] = {
                    known,
                    ring: p?.ring ?? null,
                    archived: w.archived.includes(e.id),
                    pinned: w.pins.includes(e.id),
                    links: w.links.filter(l => l.a === e.id || l.b === e.id).length
                };
            }
            if (anyone) rows.push({ id: e.id, name: e.name, title: e.title, img: imageOf(e), frame: frameStyle(e), status: e.status, cells });
        }
        return { players: cols.map(c => ({ ...portrait(c), id: c.key })), rows };
    }

    /** The player has seen what changed: remember the current state. */
    #ack() {
        const known = getEntries().filter(e => e.kind === "npc" && canSee(e, "face", game.user));
        const knownIds = new Set(known.map(e => e.id));
        const official = getOfficial().filter(l => knownIds.has(l.a) && knownIds.has(l.b) && !l.hidden);
        return game.user.setFlag(MODULE_ID, "bondsSeen", snapshotFor(known, official));
    }

    async #promptMoment() {
        const count = getMoments().length + 1;
        const fallback = game.i18n.format("PERSONA.Bonds.MomentDefault", { n: count });
        const label = await foundry.applications.api.DialogV2.prompt({
            window: { title: t("PERSONA.Bonds.Record"), icon: "fa-solid fa-camera-retro" },
            content: `<p>${t("PERSONA.Bonds.RecordHint")}</p><input type="text" name="label" value="${foundry.utils.escapeHTML?.(fallback) ?? fallback}" maxlength="60" autofocus>`,
            ok: {
                label: t("PERSONA.Bonds.Record"),
                callback: (_event, button) => button.form.elements.label.value.trim() || fallback
            },
            rejectClose: false
        }).catch(() => null);
        if (!label) return;
        await recordMoment(label);
        ui.notifications.info(game.i18n.format("PERSONA.Bonds.Recorded", { label }));
    }

    async #confirmDelete(id) {
        const moment = getMoments().find(m => m.id === id);
        if (!moment) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: t("PERSONA.Bonds.DeleteMoment") },
            content: `<p>${game.i18n.format("PERSONA.Bonds.DeleteMomentConfirm", { label: foundry.utils.escapeHTML?.(moment.label) ?? moment.label })}</p>`
        });
        if (!ok) return;
        this.momentId = null;
        await deleteMoment(id);
    }
}
