/**
 * Builds plain, template-ready contexts. Read-only: nothing here writes documents.
 */
import { MODULE_ID, LAYERS, ALL } from "./constants.js";
import {
    getEntries, getEntry, getGroups, canSee, audienceOf, players, seenIds,
    privateNote, sharedNotes, firstImageIn, withoutImages
} from "./store.js";
import { canWriteSharedNotes } from "./relay.js";
import { sealSvg, tornClip, tiltOf, TORN_EDGES, PAPERS } from "./documents.js";
import { openedIds } from "./store.js";

const PLACEHOLDER = {
    npc: `modules/${MODULE_ID}/assets/unknown-person.svg`,
    place: `modules/${MODULE_ID}/assets/unknown-place.svg`,
    document: `modules/${MODULE_ID}/assets/document.svg`
};

/** The entry's own image, else the first image in its story (e.g. a Journal page), else a placeholder. */
export function portraitOf(entry) {
    return entry.img || firstImageIn(entry.summary) || "";
}

export function imageOf(entry) {
    // A document's own picture is a map on the paper, not a face for toasts and links.
    if (entry.kind === "document" && entry.paper !== "map") return PLACEHOLDER.document;
    return portraitOf(entry) || PLACEHOLDER[entry.kind] || PLACEHOLDER.npc;
}

/** CSS variables for the portrait's framing, used by every view of the image. */
export function frameStyle(entry) {
    return `--fx: ${entry.focusX ?? 50}%; --fy: ${entry.focusY ?? 20}%; --zoom: ${entry.zoom ?? 1};`;
}

const t = key => game.i18n.localize(key);
const UNGROUPED = "_none";
export const DOCS = "_docs";

function matchesFilter(entry, filter) {
    if (!filter || filter === "all") return true;
    if (filter === "places") return entry.kind === "place";
    if (filter === "documents") return entry.kind === "document";
    return entry.groups.includes(filter);
}

function matchesSearch(entry, search, user) {
    if (!search) return true;
    const query = search.toLowerCase();
    const named = canSee(entry, "name", user);
    return [named ? entry.name : "", named ? entry.title : ""].some(text => text.toLowerCase().includes(query));
}

/** Filter chips: everyone, each group with something in it (for players: something they know), places (players: only if they know one). */
function buildChips(pool, filter, isGM) {
    const count = predicate => pool.filter(predicate).length;
    const groups = getGroups()
        .map(group => ({ id: group.id, label: group.label, icon: group.icon, count: count(e => e.groups.includes(group.id)) }))
        .filter(group => isGM || group.count > 0);
    return [
        { id: "all", label: t("PERSONA.Filter.All"), icon: "fa-solid fa-users", count: pool.length },
        ...groups,
        { id: "places", label: t("PERSONA.Filter.Places"), icon: "fa-solid fa-map-location-dot", count: count(e => e.kind === "place") },
        { id: "documents", label: t("PERSONA.Filter.Documents"), icon: "fa-solid fa-scroll", count: count(e => e.kind === "document") }
    ].filter(chip => !["places", "documents"].includes(chip.id) || chip.count > 0 || isGM || filter === chip.id).map(chip => ({ ...chip, active: chip.id === (filter || "all") }));
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
    // Documents live in one folder of their own — the party's papers — not in the factions' folders.
    const docs = list.filter(e => e.kind === "document");
    const rest = list.filter(e => e.kind !== "document");
    const sections = getGroups()
        .map(group => ({ id: group.id, label: group.label, icon: group.icon, entries: rest.filter(e => e.groups.includes(group.id)) }))
        .filter(section => section.entries.length);
    if (docs.length) sections.unshift({ id: DOCS, label: t("PERSONA.Doc.Folder"), icon: "fa-solid fa-scroll", entries: docs });
    const loose = rest.filter(e => !e.groups.length);
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
/*  Documents                                   */
/* -------------------------------------------- */

/** What's pressed into the wax: an icon, the letters the GM typed, or the signature's initial. */
export function sealMarkOf(entry) {
    const mark = entry.sealMark.trim();
    if (mark.startsWith("fa-")) return { icon: mark };
    const text = (mark || entry.title.trim() || entry.name.trim() || "?").slice(0, mark ? 2 : 1).toUpperCase();
    return { text };
}

/** The pieces every view of a document needs: paper, tear, tilt, seal and whether it's still sealed for this user. */
export function documentLook(entry, user = game.user) {
    const torn = TORN_EDGES[entry.paper];
    return {
        paper: entry.paper,
        paperIcon: PAPERS.find(p => p.id === entry.paper)?.icon ?? "fa-solid fa-scroll",
        paperLabel: t(`PERSONA.Doc.Paper.${entry.paper}`),
        clip: torn ? `clip-path: ${tornClip(entry.id, torn)};` : "",
        tilt: `--tilt: ${tiltOf(entry.id, entry.paper)}deg;`,
        hasSeal: entry.sealed,
        sealed: entry.sealed && !openedIds(user).has(entry.id),
        seal: entry.sealed ? sealSvg(entry.id, entry.sealColor) : "",
        sealColor: entry.sealColor,
        mark: sealMarkOf(entry),
        mapImg: entry.paper === "map" ? portraitOf(entry) : ""
    };
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
            isPrivate: !(entry.reveal.face ?? []).includes(ALL),
            isDocument: entry.kind === "document",
            doc: entry.kind === "document" ? documentLook(entry, user) : null
        };
    };
    // People first, then places, then documents, inside each folder.
    const ordered = ["npc", "place", "document"].flatMap(kind => list.filter(e => e.kind === kind));
    const sections = buildSections(ordered, { ...options, item: tile }).map(section => ({
        ...section,
        people: section.items.filter(i => i.kind === "npc"),
        places: section.items.filter(i => i.kind === "place"),
        documents: section.items.filter(i => i.kind === "document")
    }));
    return { sections, isEmpty: !list.length };
}

/** Layer summary for a row: visible to everyone / some / nobody. */
/** The layers a GM handles for an entry: all four, or for a document "has it" and "hidden passage". */
export function layersOf(entry) {
    return entry.kind === "document" ? ["face", "secret"] : LAYERS;
}

export function layerLabel(entry, layer) {
    return t(entry.kind === "document" ? `PERSONA.Doc.Layer.${layer}` : `PERSONA.Layer.${layer}`);
}

function layerSummary(entry, layer, roster) {
    const who = audienceOf(entry, layer, roster.map(u => u.id));
    const state = who.all ? "all" : who.ids.length ? "some" : "none";
    const names = roster.filter(u => who.ids.includes(u.id)).map(u => u.name);
    const label = layerLabel(entry, layer);
    return {
        key: layer,
        label,
        state,
        icon: state === "none" ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
        count: state === "some" ? `${who.ids.length}/${roster.length}` : "",
        tooltip: `${label}: ${state === "all" ? t("PERSONA.Reveal.Everyone") : state === "some" ? names.join(", ") : t("PERSONA.Reveal.Nobody")}`,
        disabled: layer === "secret" && !entry.secret.trim()
    };
}

function buildDirector(list, { filter, search, expanded, collapsed, sharing }) {
    const roster = players();
    const ids = roster.map(u => u.id);
    const groups = new Map(getGroups().map(g => [g.id, g]));

    const row = entry => {
        const isOpen = expanded.has(entry.id);
        const layers = layersOf(entry).map(layer => layerSummary(entry, layer, roster));
        return {
            id: entry.id,
            kind: entry.kind,
            isPerson: entry.kind === "npc",
            isDocument: entry.kind === "document",
            doc: entry.kind === "document" ? documentLook(entry) : null,
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
                rows: layersOf(entry).map(layer => {
                    const who = audienceOf(entry, layer, ids);
                    return {
                        key: layer,
                        label: layerLabel(entry, layer),
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
        sections: buildSections(list, { filter, search, collapsed, item: row }).map(s => ({ ...s, isLoose: s.id === UNGROUPED || s.id === DOCS })),
        hasPlayers: roster.length > 0,
        // Drag and drop to arrange: not while searching (the list is partial).
        canArrange: !search
    };
}

/* -------------------------------------------- */
/*  Card                                        */
/* -------------------------------------------- */

/** A document, as this user may read it. */
export async function buildDocumentContext(entry, { tab = "private" } = {}) {
    const user = game.user;
    const isGM = user.isGM;
    const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { secrets: isGM });
    const showSecret = canSee(entry, "secret", user) && entry.secret.trim();
    const look = documentLook(entry, user);
    const body = entry.paper === "map" ? withoutImages(entry.summary) : entry.summary;
    const notes = sharedNotes(entry.id).map(note => {
        const author = game.users.get(note.userId);
        return {
            id: note.id, text: note.text, author: author?.name ?? "?",
            initial: (author?.name ?? "?").charAt(0).toUpperCase(),
            color: author?.color?.css ?? author?.color ?? "#857a65",
            canDelete: isGM || note.userId === user.id
        };
    });
    const roster = players();
    return {
        id: entry.id,
        isGM,
        isDocument: true,
        ...look,
        name: entry.name,
        signature: entry.title,
        dateline: entry.dateline,
        body: body.trim() ? await enrich(body) : "",
        secret: showSecret ? await enrich(entry.secret) : null,
        // Something is still unreadable: smudged lines, if the GM wants players to know there's more.
        hiddenHint: !showSecret && !!entry.secret.trim() && (isGM || entry.hintHidden),
        tab,
        showPrivate: !isGM && tab === "private",
        privateNote: isGM ? "" : privateNote(entry.id),
        notes,
        canWriteShared: canWriteSharedNotes(),
        audit: isGM ? layersOf(entry).map(layer => layerSummary(entry, layer, roster)) : null,
        shareTargets: isGM && roster.length ? shareTargets() : null
    };
}

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
