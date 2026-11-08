/**
 * Creating entries from Foundry documents, and keeping their text in step with the Journal.
 * The Journal stays the source of truth: the entry keeps a copy of the page text so players
 * can read it in the card without needing permission on the Journal itself.
 */
import { getEntries, saveEntry, patchEntry, normalizeEntry, firstImageIn } from "./store.js";

/** First text page and first image page of a Journal entry (or the page itself). */
async function journalParts(uuid) {
    const doc = uuid ? await fromUuid(uuid) : null;
    if (!doc) return null;
    const pages = doc.documentName === "JournalEntryPage" ? [doc] : [...(doc.pages?.contents ?? [])].sort((a, b) => a.sort - b.sort);
    const text = pages.find(p => p.type === "text");
    const image = pages.find(p => p.type === "image" && p.src);
    return {
        doc,
        name: doc.name,
        summary: text?.text?.content ?? "",
        // An image page, else the first picture inside the text (Kanka imports put the portrait there).
        img: image?.src || firstImageIn(text?.text?.content) || ""
    };
}

export async function summaryFromJournal(uuid) {
    return (await journalParts(uuid))?.summary ?? "";
}

/**
 * Builds a new entry from dropped data: an Actor (name + portrait), a Journal entry or a
 * Journal page (name + text + first image). Returns the saved entry, or null.
 */
export async function createFromDrop(data) {
    if (!data?.uuid && !data?.type) return null;
    const doc = data.uuid ? await fromUuid(data.uuid) : null;
    if (!doc) return null;

    if (doc.documentName === "Actor") {
        return saveEntry(normalizeEntry({
            kind: "npc",
            name: doc.name,
            img: doc.img,
            actorUuid: doc.uuid
        }));
    }
    if (doc.documentName === "JournalEntry" || doc.documentName === "JournalEntryPage") {
        const parts = await journalParts(doc.uuid);
        return saveEntry(normalizeEntry({
            kind: "npc",
            name: parts.name,
            img: parts.img,
            summary: parts.summary,
            journalUuid: doc.uuid
        }));
    }
    if (doc.documentName === "Scene") {
        return saveEntry(normalizeEntry({
            kind: "place",
            name: doc.navName || doc.name,
            img: doc.background?.src ?? doc.thumb ?? ""
        }));
    }
    ui.notifications.warn(game.i18n.localize("PERSONA.Warn.DropType"));
    return null;
}

/** GM side: when a linked Journal page changes, refresh the entries that follow it. */
export async function syncFromJournal(page) {
    if (!game.user.isGM || page?.type !== "text") return;
    const uuids = new Set([page.uuid, page.parent?.uuid]);
    const followers = getEntries().filter(e => e.syncJournal && uuids.has(e.journalUuid));
    for (const entry of followers) {
        const summary = await summaryFromJournal(entry.journalUuid);
        if (summary !== entry.summary) await patchEntry(entry.id, e => ({ ...e, summary }));
    }
}

