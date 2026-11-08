/**
 * Builds plain, template-ready contexts. Read-only: nothing here writes documents.
 */
import { MODULE_ID, LAYERS, ALL } from "./constants.js";
import {
    getEntries, getEntry, getGroups, canSee, audienceOf, players, seenIds,
    privateNote, sharedNotes, firstImageIn, withoutImages
} from "./store.js";
import { canWriteSharedNotes } from "./relay.js";

const PLACEHOLDER = {
    npc: `modules/${MODULE_ID}/assets/unknown-person.svg`,
    place: `modules/${MODULE_ID}/assets/unknown-place.svg`
};

/** The entry's own image, else the first image in its story (e.g. a Journal page), else a placeholder. */
export function portraitOf(entry) {
    return entry.img || firstImageIn(entry.summary) || "";
}

export function imageOf(entry) {
    return portraitOf(entry) || PLACEHOLDER[entry.kind] || PLACEHOLDER.npc;
}

/** CSS variables for the portrait's framing, used by every view of the image. */
export function frameStyle(entry) {
    return `--fx: ${entry.focusX ?? 50}%; --fy: ${entry.focusY ?? 20}%; --zoom: ${entry.zoom ?? 1};`;
}

const t = key => game.i18n.localize(key);
const UNGROUPED = "_none";

function matchesFilter(entry, filter) {
    if (!filter || filter === "all") return true;
    if (filter === "places") return entry.kind === "place";
    return entry.groups.includes(filter);
}

function matchesSearch(entry, search, user) {
    if (!search) return true;
    const query = search.toLowerCase();
    const named = canSee(entry, "name", user);
    return [named ? entry.name : "", named ? entry.title : ""].some(text => text.toLowerCase().includes(query));
}

/** Filter chips: everyone, each group with something in it (for players: something they know), places. */
function buildChips(pool, filter, isGM) {
    const count = predicate => pool.filter(predicate).length;
    const groups = getGroups()
        .map(group => ({ id: group.id, label: group.label, icon: group.icon, count: count(e => e.groups.includes(group.id)) }))
        .filter(group => isGM || group.count > 0);
    return [
        { id: "all", label: t("PERSONA.Filter.All"), icon: "fa-solid fa-users", count: pool.length },
        ...groups,
        { id: "places", label: t("PERSONA.Filter.Places"), icon: "fa-solid fa-map-location-dot", count: count(e => e.kind === "place") }
    ].map(chip => ({ ...chip, active: chip.id === (filter || "all") }));
}

/**
 * Folders: with no filter or search, entries are shown in one collapsible section per group
 * (an entry in two groups shows in both), then the ones without a group.
 * With a filter or a search, one flat section.
 */
function buildSections(list, { filter, search, collapsed, item }) {
    if ((filter && filter !== "all") || search) {
        return [{ id: "flat", flat: true, items: list.map(item) }];
    }
    const sections = getGroups()
        .map(group => ({ id: group.id, label: group.label, icon: group.icon, entries: list.filter(e => e.groups.includes(group.id)) }))
        .filter(section => section.entries.length);
    const loose = list.filter(e => !e.groups.length);
    if (loose.length) sections.push({ id: UNGROUPED, label: t("PERSONA.Group.Ungrouped"), icon: "fa-regular fa-folder", entries: loose });
    if (!sections.length) return [{ id: "flat", flat: true, items: [] }];
    // A single "ungrouped" folder is just the list.
    if (sections.length === 1 && sections[0].id === UNGROUPED) return [{ id: "flat", flat: true, items: loose.map(item) }];
    return sections.map(section => ({
        id: section.id,
        label: section.label,
        icon: section.icon,
        count: section.entries.length,
        collapsed: !!collapsed?.[section.id],
        items: section.entries.map(item)
    }));
}

/* -------------------------------------------- */
/*  Panel                                       */
/* -------------------------------------------- */

/** Buttons to show a card to everyone or to one player. */
export function shareTargets() {
    return [
        { id: ALL, label: t("PERSONA.Reveal.All"), icon: "fa-solid fa-users" },
        ...players().map(u => ({ id: u.id, label: u.name, icon: "fa-solid fa-user" }))
    ];
}

export function buildPanelContext({ filter = "all", search = "", expanded = new Set(), collapsed = {}, sharing = new Set() } = {}) {
    const user = game.user;
    const isGM = user.isGM;
    const all = getEntries();
    const pool = isGM ? all : all.filter(e => canSee(e, "face", user));
    const list = pool.filter(e => matchesFilter(e, filter) && matchesSearch(e, search, user));
    const context = {
        isGM,
        search,
        chips: buildChips(pool, filter, isGM),
        total: pool.length,
        count: list.length
    };
    return isGM
        ? { ...context, ...buildDirector(list, { filter, search, expanded, collapsed, sharing }) }
        : { ...context, ...buildGallery(list, user, { filter, search, collapsed }) };
}

function buildGallery(list, user, options) {
    const seen = seenIds(user);
    const tile = entry => {
        const named = canSee(entry, "name", user);
        return {
            id: entry.id,
            kind: entry.kind,
            isPlace: entry.kind === "place",
            img: imageOf(entry),
            frame: frameStyle(entry),
            name: named ? entry.name : null,
            title: named ? entry.title : "",
            isNew: !seen.has(entry.id),
            status: entry.kind === "npc" && entry.status !== "alive" ? entry.status : null,
            statusLabel: entry.kind === "npc" && entry.status !== "alive" ? t(`PERSONA.Status.${entry.status}`) : "",
            statusIcon: entry.status === "dead" ? "fa-solid fa-skull" : "fa-solid fa-question",
            isPrivate: !(entry.reveal.face ?? []).includes(ALL)
        };
    };
    // People first, then places, inside each folder.
    const ordered = [...list.filter(e => e.kind === "npc"), ...list.filter(e => e.kind === "place")];
    const sections = buildSections(ordered, { ...options, item: tile }).map(section => ({
        ...section,
        people: section.items.filter(i => !i.isPlace),
        places: section.items.filter(i => i.isPlace)
    }));
    return { sections, isEmpty: !list.length };
}

/** Layer summary for a row: visible to everyone / some / nobody. */
function layerSummary(entry, layer, roster) {
    const who = audienceOf(entry, layer, roster.map(u => u.id));
    const state = who.all ? "all" : who.ids.length ? "some" : "none";
    const names = roster.filter(u => who.ids.includes(u.id)).map(u => u.name);
    return {
        key: layer,
        label: t(`PERSONA.Layer.${layer}`),
        state,
        icon: state === "none" ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
        count: state === "some" ? `${who.ids.length}/${roster.length}` : "",
        tooltip: `${t(`PERSONA.Layer.${layer}`)}: ${state === "all" ? t("PERSONA.Reveal.Everyone") : state === "some" ? names.join(", ") : t("PERSONA.Reveal.Nobody")}`,
        disabled: layer === "secret" && !entry.secret.trim()
    };
}

function buildDirector(list, { filter, search, expanded, collapsed, sharing }) {
    const roster = players();
    const ids = roster.map(u => u.id);
    const groups = new Map(getGroups().map(g => [g.id, g]));

    const row = entry => {
        const isOpen = expanded.has(entry.id);
        const layers = LAYERS.map(layer => layerSummary(entry, layer, roster));
        return {
            id: entry.id,
            kind: entry.kind,
            isPerson: entry.kind === "npc",
            img: imageOf(entry),
            frame: frameStyle(entry),
            name: entry.name || t("PERSONA.Unnamed"),
            title: entry.title,
            status: entry.kind === "npc" && entry.status !== "alive" ? entry.status : null,
            statusLabel: entry.kind === "npc" && entry.status !== "alive" ? t(`PERSONA.Status.${entry.status}`) : "",
            groups: entry.groups.map(id => groups.get(id)?.label).filter(Boolean).join(" · "),
            hasVideo: !!entry.video,
            hasJournal: !!entry.journalUuid,
            hiddenFromAll: layers.every(l => l.state === "none"),
            isSharing: sharing.has(entry.id),
            shareTargets: sharing.has(entry.id) ? shareTargets() : null,
            layers,
            isOpen,
            // The reveal grid: one row per layer, one column for everyone + one per player.
            grid: isOpen ? {
                players: roster.map(u => ({ id: u.id, name: u.name, initial: u.name.charAt(0).toUpperCase(), color: u.color?.css ?? u.color })),
                rows: LAYERS.map(layer => {
                    const who = audienceOf(entry, layer, ids);
                    return {
                        key: layer,
                        label: t(`PERSONA.Layer.${layer}`),
                        disabled: layer === "secret" && !entry.secret.trim(),
                        all: who.all,
                        some: !who.all && who.ids.length > 0,
                        cells: roster.map(u => ({ userId: u.id, name: u.name, on: who.all || who.ids.includes(u.id) }))
                    };
                })
            } : null
        };
    };

    return {
        sections: buildSections(list, { filter, search, collapsed, item: row }).map(s => ({ ...s, isLoose: s.id === UNGROUPED })),
        hasPlayers: roster.length > 0,
        // Drag and drop to arrange: not while searching (the list is partial).
        canArrange: !search
    };
}

/* -------------------------------------------- */
/*  Card                                        */
/* -------------------------------------------- */

export async function buildCardContext(entry, { tab = "private" } = {}) {
    const user = game.user;
    const isGM = user.isGM;
    const named = canSee(entry, "name", user);
    const groups = new Map(getGroups().map(g => [g.id, g]));
    const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { secrets: isGM });
    // The card already shows the portrait; pictures inside the Journal text would repeat it.
    const story = withoutImages(entry.summary);
    const showSummary = canSee(entry, "summary", user) && story.trim();
    const showSecret = canSee(entry, "secret", user) && entry.secret.trim();
    const roster = players();
    const seen = seenIds(user);

    const notes = sharedNotes(entry.id).map(note => {
        const author = game.users.get(note.userId);
        return {
            id: note.id,
            text: note.text,
            author: author?.name ?? "?",
            initial: (author?.name ?? "?").charAt(0).toUpperCase(),
            color: author?.color?.css ?? author?.color ?? "#857a65",
            canDelete: isGM || note.userId === user.id
        };
    });

    // Links between people and places, limited to what this user knows.
    const linkTile = other => ({
        id: other.id,
        img: imageOf(other),
        frame: frameStyle(other),
        name: canSee(other, "name", user) ? other.name : "???",
        isNew: !isGM && !seen.has(other.id),
        hidden: isGM && LAYERS.every(l => !(other.reveal[l] ?? []).length)
    });
    const visible = other => other && (isGM || canSee(other, "face", user));
    const people = entry.kind === "place"
        ? getEntries().filter(e => e.kind === "npc" && e.places.includes(entry.id)).filter(visible).map(linkTile)
        : [];
    const places = entry.kind === "npc"
        ? entry.places.map(id => getEntry(id)).filter(visible).map(linkTile)
        : [];

    return {
        id: entry.id,
        isGM,
        kind: entry.kind,
        kindLabel: t(entry.kind === "place" ? "PERSONA.Kind.place" : "PERSONA.Kind.npc"),
        img: imageOf(entry),
        frame: frameStyle(entry),
        named,
        name: named ? entry.name : null,
        title: named ? entry.title : "",
        status: entry.kind === "npc" && entry.status !== "alive" ? entry.status : null,
        statusLabel: entry.kind === "npc" && entry.status !== "alive" ? t(`PERSONA.Status.${entry.status}`) : "",
        statusIcon: entry.status === "dead" ? "fa-solid fa-skull" : "fa-solid fa-question",
        groups: entry.groups.map(id => groups.get(id)).filter(Boolean),
        summary: showSummary ? await enrich(story) : null,
        secret: showSecret ? await enrich(entry.secret) : null,
        hasVideo: !!entry.video && (isGM || canSee(entry, "face", user)),
        people,
        places,
        tab,
        showPrivate: !isGM && tab === "private",
        privateNote: isGM ? "" : privateNote(entry.id),
        notes,
        canWriteShared: canWriteSharedNotes(),
        audit: isGM ? LAYERS.map(layer => layerSummary(entry, layer, roster)) : null,
        shareTargets: isGM && roster.length ? shareTargets() : null
    };
}
