/**
 * Bonds in Foundry: the window, the data adapter for the wheel, and moments (timeline snapshots).
 *
 * - A player's wheel lives in their own user flags (`flags.persona.bonds`), which they may write
 *   themselves — no GM relay needed. Each player only ever sees and edits their own wheel; the GM
 *   can open and edit anyone's.
 * - The wheel only ever draws people this player can see in Persona (face revealed), through the
 *   same cards: players never touch an Actor or its sheet.
 * - Moments are world data written by the GM: a snapshot of every wheel and every status.
 */
import { MODULE_ID } from "../constants.js";
import { getSetting } from "../settings.js";
import { getEntries, getGroups, canSee, seenIds, players, updateSetting } from "../store.js";
import { imageOf, frameStyle } from "../view-data.js";
import { BondsView } from "./view.js";
import { normalizeBonds, PARTY_PREFIX } from "./model.js";

const t = key => game.i18n.localize(key);

/* -------------------------------------------- */
/*  Data                                        */
/* -------------------------------------------- */

export function bondsOf(user) {
    return normalizeBonds(user?.getFlag(MODULE_ID, "bonds"));
}

/** Saves a wheel: players only their own, the GM anyone's. */
export function saveBonds(userId, bonds) {
    const user = game.users.get(userId);
    if (!user || (!game.user.isGM && user.id !== game.user.id)) return Promise.reject(new Error("Not allowed to edit this wheel"));
    // Arrays inside replace whole on update, so removals stick.
    return user.update({ [`flags.${MODULE_ID}.bonds`]: normalizeBonds(bonds) });
}

export function saveOwnBonds(bonds) {
    return saveBonds(game.user.id, bonds);
}

/** A player as a portrait: their assigned character, else their user avatar. */
function persona(user) {
    const actor = user.character;
    return {
        id: `${PARTY_PREFIX}${user.id}`,
        name: actor?.name ?? user.name,
        img: actor?.img || user.avatar || "icons/svg/mystery-man.svg"
    };
}

export function getMoments() {
    return Object.values(getSetting("moments") ?? {}).sort((a, b) => a.ts - b.ts);
}

export async function recordMoment(label) {
    if (!game.user.isGM) return;
    const id = foundry.utils.randomID();
    const wheels = Object.fromEntries(players().map(u => [u.id, bondsOf(u)]));
    const statuses = Object.fromEntries(getEntries().map(e => [e.id, e.status]));
    await updateSetting("moments", moments => {
        moments[id] = { id, label: String(label).slice(0, 60), ts: Date.now(), wheels, statuses };
        return moments;
    });
    return id;
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
    /** Whose wheel is shown (players: always their own). */
    ownerId = null;
    momentId = null;

    constructor({ openCard }, options = {}) {
        super(options);
        this.openCard = openCard;
    }

    /** Opens on a given player's wheel (GM) or the user's own. */
    async show(userId = null) {
        if (game.user.isGM) {
            const roster = players();
            this.ownerId = (userId && roster.some(u => u.id === userId)) ? userId
                : roster.some(u => u.id === this.ownerId) ? this.ownerId
                : roster[0]?.id ?? null;
        } else {
            this.ownerId = game.user.id;
        }
        await this.render({ force: true });
        this.bringToFront?.();
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

    #adapter() {
        return {
            t: key => game.i18n.localize(key),
            getModel: () => this.buildModel(),
            saveBonds: bonds => saveBonds(this.ownerId ?? game.user.id, bonds),
            openCard: id => this.openCard(id),
            selectPlayer: id => { this.ownerId = id; this.momentId = null; this.view?.refresh(); },
            selectMoment: id => { this.momentId = id; this.view?.refresh(); },
            recordMoment: () => this.#promptMoment(),
            deleteMoment: id => this.#confirmDelete(id)
        };
    }

    /** The wheel's data for the current owner and moment (see BondsView for the shape). */
    buildModel() {
        const isGM = game.user.isGM;
        const roster = players();
        const owner = game.users.get(this.ownerId) ?? (isGM ? null : game.user);
        const moments = getMoments();
        const moment = this.momentId ? moments.find(m => m.id === this.momentId) : null;
        if (this.momentId && !moment) this.momentId = null;

        const base = {
            isGM,
            players: isGM ? roster.map(u => ({ id: u.id, name: u.character?.name ? `${u.name} · ${u.character.name}` : u.name })) : [],
            moments: moments.map(m => ({ id: m.id, label: m.label, ts: m.ts })),
            momentId: moment?.id ?? null
        };
        if (!owner) {
            return {
                ...base, editable: false, owner: { id: null, name: "" },
                self: { name: "—", img: "icons/svg/mystery-man.svg" }, party: [], entries: [], bonds: null, folders: []
            };
        }

        // People this player knows, as they know them (name hidden until revealed).
        const seen = seenIds(owner);
        const statusOf = entry => moment?.statuses?.[entry.id] ?? entry.status;
        const known = getEntries().filter(e => e.kind === "npc" && canSee(e, "face", owner));
        const entries = known.map(e => {
            const named = canSee(e, "name", owner);
            return {
                id: e.id,
                name: named ? e.name : null,
                title: named ? e.title : "",
                img: imageOf(e),
                frame: frameStyle(e),
                status: statusOf(e),
                isNew: !isGM && !seen.has(e.id)
            };
        });
        const knownIds = new Set(known.map(e => e.id));
        const folders = getGroups()
            .map(g => ({ label: g.label, entryIds: known.filter(e => e.groups.includes(g.id)).map(e => e.id) }))
            .filter(f => f.entryIds.length);
        const self = persona(owner);

        return {
            ...base,
            // Moments are read-only; otherwise a player edits their own wheel and the GM edits anyone's.
            editable: !moment && (isGM || owner.id === game.user.id),
            owner: { id: owner.id, name: self.name },
            self: { name: self.name, img: self.img },
            party: roster.filter(u => u.id !== owner.id).map(persona),
            entries: entries.filter(e => knownIds.has(e.id)),
            bonds: moment ? moment.wheels?.[owner.id] ?? null : bondsOf(owner),
            folders
        };
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
