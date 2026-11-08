/**
 * GM editor for one entry: identity, art, Journal link, summary, secret, groups, video.
 */
import { TEMPLATE_ROOT, GROUP_ICONS } from "./constants.js";
import { getEntry, getEntries, saveEntry, deleteEntry, getGroups, createGroup, normalizeEntry, deleteGroup, linkToPlace, patchEntry } from "./store.js";
import { summaryFromJournal } from "./entries.js";
import { imageOf, frameStyle } from "./view-data.js";
import { withoutImages } from "./store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FilePickerClass = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

export class EntryEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        classes: ["persona-editor"],
        tag: "form",
        window: { icon: "fa-solid fa-pen", resizable: true },
        position: { width: 560, height: "auto" },
        form: { handler: EntryEditor.#onSubmit, submitOnChange: false, closeOnSubmit: false },
        actions: {
            pickImage: EntryEditor.#onPickImage,
            pickVideo: EntryEditor.#onPickVideo,
            clearVideo: EntryEditor.#onClearVideo,
            pullJournal: EntryEditor.#onPullJournal,
            unlinkJournal: EntryEditor.#onUnlinkJournal,
            toggleGroup: EntryEditor.#onToggleGroup,
            togglePlace: EntryEditor.#onTogglePlace,
            togglePerson: EntryEditor.#onTogglePerson,
            addGroup: EntryEditor.#onAddGroup,
            removeGroup: EntryEditor.#onRemoveGroup,
            deleteEntry: EntryEditor.#onDelete,
            resetFrame: EntryEditor.#onResetFrame
        }
    };

    static PARTS = {
        form: { template: `${TEMPLATE_ROOT}/editor.hbs`, scrollable: [""] }
    };

    /** Working copy; saved on submit. */
    #entry;
    /** For a place: the people linked to it (stored on each person). */
    #people;

    constructor(entryId = null, options = {}) {
        super({ ...options, id: `persona-editor-${entryId ?? "new"}` });
        this.#entry = entryId ? getEntry(entryId) : normalizeEntry({});
        this.isNew = !entryId;
        this.#people = new Set(getEntries().filter(e => e.kind === "npc" && e.places.includes(this.#entry.id)).map(e => e.id));
    }

    get title() {
        return this.isNew
            ? game.i18n.localize("PERSONA.Entry.New")
            : game.i18n.format("PERSONA.Entry.EditTitle", { name: this.#entry.name || "?" });
    }

    async _prepareContext() {
        const entry = this.#entry;
        let journalName = "";
        if (entry.journalUuid) {
            const doc = await fromUuid(entry.journalUuid).catch(() => null);
            journalName = doc ? (doc.parent ? `${doc.parent.name} › ${doc.name}` : doc.name) : game.i18n.localize("PERSONA.Warn.JournalMissing");
        }
        const selected = new Set(entry.groups);
        return {
            entry,
            preview: imageOf(entry),
            isNew: this.isNew,
            isPerson: entry.kind === "npc",
            summaryLocked: !!entry.journalUuid && entry.syncJournal,
            summaryPreview: withoutImages(entry.summary),
            frame: frameStyle(entry),
            journalName,
            groups: getGroups().map(g => ({ ...g, selected: selected.has(g.id) })),
            placeOptions: getEntries().filter(e => e.kind === "place" && e.id !== entry.id)
                .map(e => ({ id: e.id, name: e.name, selected: entry.places.includes(e.id) })),
            peopleOptions: getEntries().filter(e => e.kind === "npc" && e.id !== entry.id)
                .map(e => ({ id: e.id, name: e.name, selected: this.#people.has(e.id) })),
            icons: GROUP_ICONS,
            statuses: [
                { id: "alive", icon: "fa-solid fa-heart-pulse" },
                { id: "dead", icon: "fa-solid fa-skull" },
                { id: "missing", icon: "fa-solid fa-question" }
            ].map(s => ({ ...s, label: game.i18n.localize(`PERSONA.Status.${s.id}`), selected: entry.status === s.id }))
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const drop = this.element.querySelector("[data-journal-drop]");
        drop?.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("is-over"); });
        drop?.addEventListener("dragleave", () => drop.classList.remove("is-over"));
        drop?.addEventListener("drop", event => this.#onJournalDrop(event, drop));
        this.#bindFramer();
    }

    /** Drag the picture to choose what shows; the range input zooms. Same framing players see. */
    #bindFramer() {
        const framer = this.element.querySelector("[data-framer]");
        const img = framer?.querySelector("img");
        if (!framer || !img) return;
        const fx = this.element.querySelector('[name="focusX"]');
        const fy = this.element.querySelector('[name="focusY"]');
        const zoom = this.element.querySelector('[name="zoom"]');
        const apply = () => {
            img.style.setProperty("--fx", `${fx.value}%`);
            img.style.setProperty("--fy", `${fy.value}%`);
            img.style.setProperty("--zoom", zoom.value);
        };
        zoom?.addEventListener("input", apply);
        framer.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            framer.setPointerCapture(event.pointerId);
            framer.classList.add("is-dragging");
            const rect = framer.getBoundingClientRect();
            const start = { x: event.clientX, y: event.clientY, fx: Number(fx.value), fy: Number(fy.value) };
            // Moving the picture right shows more of its left side.
            const speed = 140 / Number(zoom.value || 1);
            const move = e => {
                fx.value = Math.round(Math.min(100, Math.max(0, start.fx - ((e.clientX - start.x) / rect.width) * speed)));
                fy.value = Math.round(Math.min(100, Math.max(0, start.fy - ((e.clientY - start.y) / rect.height) * speed)));
                apply();
            };
            const up = () => {
                framer.classList.remove("is-dragging");
                framer.removeEventListener("pointermove", move);
                framer.removeEventListener("pointerup", up);
                framer.removeEventListener("pointercancel", up);
                this.#readForm();
            };
            framer.addEventListener("pointermove", move);
            framer.addEventListener("pointerup", up);
            framer.addEventListener("pointercancel", up);
        });
    }

    static #onResetFrame() {
        this.#readForm();
        Object.assign(this.#entry, { focusX: 50, focusY: 20, zoom: 1 });
        this.render();
    }

    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        // Keep typed values when the editor re-renders for a group or link change.
        this.element.addEventListener("input", () => this.#readForm());
        this.element.addEventListener("keydown", event => {
            if (event.key !== "Enter" || event.target.name !== "newGroup") return;
            event.preventDefault();
            event.stopPropagation();
            EntryEditor.#onAddGroup.call(this);
        }, true);
        this.element.addEventListener("change", event => {
            this.#readForm();
            // Following the Journal locks the story text; unfollowing makes it editable.
            if (event.target.name === "syncJournal" || event.target.name === "kind") this.render();
        });
    }

    /** Copies the visible fields into the working copy. */
    #readForm() {
        const form = this.element;
        const value = name => form.querySelector(`[name="${name}"]`)?.value ?? "";
        this.#entry = normalizeEntry({
            ...this.#entry,
            kind: form.querySelector('[name="kind"]:checked')?.value ?? this.#entry.kind,
            status: form.querySelector('[name="status"]:checked')?.value ?? this.#entry.status,
            name: value("name"),
            title: value("title"),
            img: value("img"),
            summary: value("summary"),
            secret: value("secret"),
            video: value("video"),
            focusX: Number(value("focusX")),
            focusY: Number(value("focusY")),
            zoom: Number(value("zoom")),
            syncJournal: !!form.querySelector('[name="syncJournal"]')?.checked
        });
    }

    async #onJournalDrop(event, drop) {
        event.preventDefault();
        drop.classList.remove("is-over");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const doc = data?.uuid ? await fromUuid(data.uuid) : null;
        if (!doc || !["JournalEntry", "JournalEntryPage"].includes(doc.documentName)) {
            return ui.notifications.warn(game.i18n.localize("PERSONA.Warn.DropJournal"));
        }
        this.#readForm();
        this.#entry.journalUuid = doc.uuid;
        this.#entry.summary = await summaryFromJournal(doc.uuid);
        if (!this.#entry.name) this.#entry.name = doc.name;
        this.render();
    }

    static #onPickImage() {
        this.#readForm();
        const picker = new (FilePickerClass())({
            type: "image",
            current: this.#entry.img,
            callback: path => { this.#entry.img = path; this.render(); }
        });
        picker.browse();
    }

    static #onPickVideo() {
        this.#readForm();
        const picker = new (FilePickerClass())({
            type: "video",
            current: this.#entry.video,
            callback: path => { this.#entry.video = path; this.render(); }
        });
        picker.browse();
    }

    static #onClearVideo() {
        this.#readForm();
        this.#entry.video = "";
        this.render();
    }

    static async #onPullJournal() {
        this.#readForm();
        if (!this.#entry.journalUuid) return;
        this.#entry.summary = await summaryFromJournal(this.#entry.journalUuid);
        this.render();
    }

    static #onUnlinkJournal() {
        this.#readForm();
        this.#entry.journalUuid = "";
        this.render();
    }

    static async #onToggleGroup(_event, target) {
        this.#readForm();
        const id = target.dataset.group;
        const groups = new Set(this.#entry.groups);
        if (groups.has(id)) groups.delete(id); else groups.add(id);
        this.#entry.groups = [...groups];
        await this.#saveGroups();
        this.render();
    }

    /** Group membership is saved right away (no need to press Save) for existing entries. */
    async #saveGroups() {
        if (this.isNew) return;
        const groups = [...this.#entry.groups];
        await patchEntry(this.#entry.id, entry => ({ ...entry, groups }));
    }

    static #onTogglePlace(_event, target) {
        this.#readForm();
        const places = new Set(this.#entry.places);
        const id = target.dataset.place;
        if (places.has(id)) places.delete(id); else places.add(id);
        this.#entry.places = [...places];
        this.render();
    }

    static #onTogglePerson(_event, target) {
        this.#readForm();
        const id = target.dataset.person;
        if (this.#people.has(id)) this.#people.delete(id); else this.#people.add(id);
        this.render();
    }

    static async #onAddGroup() {
        this.#readForm();
        const input = this.element.querySelector('[name="newGroup"]');
        const icon = this.element.querySelector('[name="newGroupIcon"]:checked')?.value;
        const label = input?.value?.trim();
        const id = await createGroup(label, icon);
        if (!id) return input?.focus();
        this.#entry.groups = [...new Set([...this.#entry.groups, id])];
        await this.#saveGroups();
        ui.notifications.info(game.i18n.format("PERSONA.Group.AddedTo", { name: this.#entry.name || "?", group: label }));
        this.render();
    }

    static async #onRemoveGroup(_event, target) {
        this.#readForm();
        const group = getGroups().find(g => g.id === target.dataset.group);
        if (!group) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("PERSONA.Group.Delete") },
            content: `<p>${game.i18n.format("PERSONA.Group.DeleteConfirm", { name: foundry.utils.escapeHTML?.(group.label) ?? group.label })}</p>`
        });
        if (!confirmed) return;
        await deleteGroup(group.id);
        this.#entry.groups = this.#entry.groups.filter(id => id !== group.id);
        this.render();
    }

    static async #onDelete() {
        if (this.isNew) return this.close();
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("PERSONA.Entry.Delete") },
            content: `<p>${game.i18n.format("PERSONA.Entry.DeleteConfirm", { name: this.#entry.name })}</p>`
        });
        if (!confirmed) return;
        await deleteEntry(this.#entry.id);
        this.close();
    }

    static async #onSubmit() {
        this.#readForm();
        if (!this.#entry.name.trim()) {
            return ui.notifications.warn(game.i18n.localize("PERSONA.Warn.NameRequired"));
        }
        const saved = await saveEntry(this.#entry);
        if (saved.kind === "place") {
            // Who lives or appears here: update each person's link.
            for (const person of getEntries().filter(e => e.kind === "npc")) {
                const linked = person.places.includes(saved.id);
                const wanted = this.#people.has(person.id);
                if (linked !== wanted) await linkToPlace(person.id, saved.id, wanted);
            }
        }
        await this.close();
    }
}

