/**
 * The Persona panel: a view that renders into any host element.
 * The same view is mounted in its own window, or inside Triad's tray as a tab.
 */
import { MODULE_ID, TEMPLATE_ROOT } from "./constants.js";
import { getSetting, setSetting } from "./settings.js";
import { buildPanelContext } from "./view-data.js";
import * as Store from "./store.js";
import { createFromDrop } from "./entries.js";

const renderTemplate = (...args) => foundry.applications.handlebars.renderTemplate(...args);

export class PanelView {
    filter = "all";
    search = "";
    /** Rows whose reveal grid is open (GM). */
    expanded = new Set();
    /** Rows showing the "show to" buttons (GM). */
    sharing = new Set();
    #hosts = new Set();
    /** The row or folder being dragged to rearrange the Director (GM). */
    #arranging = null;
    #pending = null;
    #searchTimer = null;

    constructor({ openCard, openEditor, playEntryVideo, playFile, openBonds }) {
        this.openCard = openCard;
        this.openBonds = openBonds;
        this.openEditor = openEditor;
        this.playEntryVideo = playEntryVideo;
        this.playFile = playFile;
    }

    mount(host) {
        if (this.#hosts.has(host)) return;
        this.#hosts.add(host);
        host.classList.add("persona");
        host.addEventListener("click", this.#onClick);
        host.addEventListener("input", this.#onInput);
        host.addEventListener("dragstart", this.#onDragStart);
        host.addEventListener("dragend", this.#onDragEnd);
        host.addEventListener("dragover", this.#onDragOver);
        host.addEventListener("dragleave", this.#onDragLeave);
        host.addEventListener("drop", this.#onDrop);
        this.requestRender();
    }

    unmount(host) {
        if (!this.#hosts.delete(host)) return;
        host.removeEventListener("click", this.#onClick);
        host.removeEventListener("input", this.#onInput);
        host.removeEventListener("dragstart", this.#onDragStart);
        host.removeEventListener("dragend", this.#onDragEnd);
        host.removeEventListener("dragover", this.#onDragOver);
        host.removeEventListener("dragleave", this.#onDragLeave);
        host.removeEventListener("drop", this.#onDrop);
    }

    /** Coalesces bursts of changes (several settings in a row) into one render. */
    requestRender() {
        if (this.#pending) return this.#pending;
        this.#pending = new Promise(resolve => requestAnimationFrame(async () => {
            this.#pending = null;
            try { await this.render(); } catch (error) { console.error(`${MODULE_ID} | panel render failed`, error); }
            resolve();
        }));
        return this.#pending;
    }

    async render() {
        if (!this.#hosts.size) return;
        // Don't pull the rows out from under a drag; render once it ends.
        if (this.#arranging) { this.#arranging.stale = true; return; }
        const context = buildPanelContext({
            filter: this.filter,
            search: this.search,
            expanded: this.expanded,
            sharing: this.sharing,
            collapsed: getSetting("collapsed") ?? {}
        });
        const html = await renderTemplate(`${TEMPLATE_ROOT}/panel.hbs`, context);
        for (const host of this.#hosts) {
            if (!host.isConnected) continue;
            const active = document.activeElement;
            const typing = active?.name === "search" && host.contains(active);
            const caret = typing ? active.selectionStart : null;
            const scroll = host.querySelector(".persona-body")?.scrollTop ?? 0;
            host.innerHTML = html;
            const body = host.querySelector(".persona-body");
            if (body) body.scrollTop = scroll;
            if (typing) {
                const input = host.querySelector('input[name="search"]');
                input?.focus();
                input?.setSelectionRange(caret, caret);
            }
        }
    }

    /* -------------------------------------------- */

    #onClick = event => {
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const { action, id } = target.dataset;
        const handler = this.#actions[action];
        if (!handler) return;
        event.preventDefault();
        Promise.resolve(handler(target, id, event)).catch(error => {
            console.error(`${MODULE_ID} | ${action} failed`, error);
            ui.notifications.error(game.i18n.localize("PERSONA.Warn.ActionFailed"));
        });
    };

    #actions = {
        filter: target => { this.filter = target.dataset.filter; return this.requestRender(); },
        openCard: (_t, id) => this.openCard(id),
        toggleReveal: (_t, id) => {
            if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
            return this.requestRender();
        },
        revealCell: target => Store.setReveal(target.dataset.id, target.dataset.layer, target.dataset.who, target.dataset.on !== "1"),
        toggleShare: (_t, id) => {
            if (this.sharing.has(id)) this.sharing.delete(id); else this.sharing.add(id);
            return this.requestRender();
        },
        showHandout: async (target, id) => {
            await Store.showHandout(id, target.dataset.who);
            this.sharing.delete(id);
            this.requestRender();
            const who = target.dataset.who === "all" ? game.i18n.localize("PERSONA.Reveal.Everyone") : game.users.get(target.dataset.who)?.name;
            ui.notifications.info(game.i18n.format("PERSONA.Handout.Shown", { name: Store.getEntry(id)?.name ?? "", who }));
        },
        revealAll: (_t, id) => Store.setRevealAll(id, true),
        hideAll: (_t, id) => Store.setRevealAll(id, false),
        toggleFolder: async target => {
            const collapsed = { ...(getSetting("collapsed") ?? {}) };
            const id = target.dataset.folder;
            if (collapsed[id]) delete collapsed[id]; else collapsed[id] = true;
            await setSetting("collapsed", collapsed);
            return this.requestRender();
        },
        playVideo: (_t, id) => this.playEntryVideo(id),
        playFile: () => this.playFile(),
        openBonds: () => this.openBonds?.(),
        newEntry: () => this.openEditor(null),
        edit: (_t, id) => this.openEditor(id),
        openJournal: async (_t, id) => {
            const entry = Store.getEntry(id);
            const doc = entry?.journalUuid ? await fromUuid(entry.journalUuid) : null;
            if (!doc) return ui.notifications.warn(game.i18n.localize("PERSONA.Warn.JournalMissing"));
            if (doc.documentName === "JournalEntryPage") return doc.parent.sheet.render(true, { pageId: doc.id });
            return doc.sheet.render(true);
        }
    };

    #onInput = event => {
        if (event.target.name !== "search") return;
        this.search = event.target.value;
        clearTimeout(this.#searchTimer);
        this.#searchTimer = setTimeout(() => this.requestRender(), 120);
    };

    /* -------------------------------------------- */
    /*  Arranging the Director (GM drag and drop)   */
    /* -------------------------------------------- */

    /** A folder id from the panel ("flat" = the filtered list: the filter's group, if it is one). */
    #folderOf(id) {
        if (id !== "flat") return id;
        const groupFilter = this.filter && !["all", "places"].includes(this.filter);
        return groupFilter ? this.filter : null;
    }

    #onDragStart = event => {
        if (!game.user.isGM) return;
        const row = event.target.closest?.("[data-drag-entry]");
        const folder = event.target.closest?.("[data-drag-group]");
        if (!row && !folder) return;
        this.#arranging = row
            ? { kind: "entry", id: row.dataset.dragEntry, from: this.#folderOf(row.dataset.folder), el: row }
            : { kind: "group", id: folder.dataset.dragGroup, el: folder.closest(".persona-section") };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `persona:${this.#arranging.kind}:${this.#arranging.id}`);
        requestAnimationFrame(() => this.#arranging?.el.classList.add("is-dragging"));
    };

    #onDragEnd = () => {
        const drag = this.#arranging;
        this.#arranging = null;
        drag?.el.classList.remove("is-dragging");
        this.#clearMarks();
        if (drag?.stale) this.requestRender();
    };

    #clearMarks() {
        for (const host of this.#hosts) {
            host.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-into").forEach(el => el.classList.remove("is-drop-before", "is-drop-after", "is-drop-into"));
        }
    }

    /** Where the dragged row or folder would land under the pointer. */
    #arrangeTarget(event) {
        const drag = this.#arranging;
        if (drag.kind === "group") {
            const header = event.target.closest("[data-drag-group]");
            if (!header || header.dataset.dragGroup === drag.id) return null;
            const rect = header.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            return { el: header, mark: after ? "is-drop-after" : "is-drop-before", groupId: header.dataset.dragGroup, after };
        }
        const row = event.target.closest("[data-drag-entry]");
        if (row) {
            if (row.dataset.dragEntry === drag.id) return null;
            const rect = row.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            return { el: row, mark: after ? "is-drop-after" : "is-drop-before", folder: this.#folderOf(row.dataset.folder), rowId: row.dataset.dragEntry, after };
        }
        const folder = event.target.closest("[data-drop-folder]");
        if (folder) return { el: folder, mark: "is-drop-into", folder: this.#folderOf(folder.dataset.dropFolder), rowId: null };
        return null;
    }

    async #arrangeDrop(event) {
        const drag = this.#arranging;
        const target = this.#arrangeTarget(event);
        this.#clearMarks();
        if (!target) return;
        if (drag.kind === "group") {
            const groups = Store.getGroups().map(g => g.id);
            const next = target.after ? groups[groups.indexOf(target.groupId) + 1] ?? null : target.groupId;
            return Store.moveGroup(drag.id, next === drag.id ? groups[groups.indexOf(drag.id) + 1] ?? null : next);
        }
        let beforeId = target.rowId;
        if (target.rowId && target.after) {
            // "After this row" = before the next row in the same list.
            const rows = [...target.el.parentElement.querySelectorAll("[data-drag-entry]")].map(r => r.dataset.dragEntry).filter(id => id !== drag.id);
            beforeId = rows[rows.indexOf(target.rowId) + 1] ?? null;
        }
        const toGroup = target.folder;
        await Store.moveEntry(drag.id, { fromGroup: drag.from, toGroup, beforeId });
        const group = Store.getGroups().find(g => g.id === toGroup);
        if (toGroup && toGroup !== drag.from) {
            const label = toGroup === "_none" ? game.i18n.localize("PERSONA.Group.Ungrouped") : group?.label;
            if (label) ui.notifications.info(game.i18n.format("PERSONA.Arrange.Moved", { name: Store.getEntry(drag.id)?.name ?? "", group: label }));
        }
    }

    /* Drop an Actor, Journal entry or Journal page on the panel to add it (GM). */
    #onDragOver = event => {
        if (!game.user.isGM) return;
        event.preventDefault();
        if (this.#arranging) {
            event.dataTransfer.dropEffect = "move";
            const target = this.#arrangeTarget(event);
            this.#clearMarks();
            target?.el.classList.add(target.mark);
            return;
        }
        event.currentTarget.querySelector("[data-drop-zone]")?.classList.add("is-over");
    };

    #onDragLeave = event => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        this.#clearMarks();
        event.currentTarget.querySelector("[data-drop-zone]")?.classList.remove("is-over");
    };

    #onDrop = async event => {
        if (!game.user.isGM) return;
        event.preventDefault();
        if (this.#arranging) {
            const drag = this.#arranging;
            try { await this.#arrangeDrop(event); }
            finally {
                drag.el.classList.remove("is-dragging");
                this.#arranging = null;
                this.requestRender();
            }
            return;
        }
        event.currentTarget.querySelector("[data-drop-zone]")?.classList.remove("is-over");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const entry = await createFromDrop(data);
        if (entry) ui.notifications.info(game.i18n.format("PERSONA.Entry.Added", { name: entry.name }));
    };
}

/** Standalone window that hosts the panel when Triad isn't used. */
export class PersonaWindow extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "persona-window",
        classes: ["persona-window"],
        window: { title: "PERSONA.Title", icon: "fa-solid fa-masks-theater", resizable: true },
        position: { width: 380, height: 680 }
    };

    #host = null;

    constructor(view, options = {}) {
        super(options);
        this.view = view;
    }

    async _renderHTML() {
        return null;
    }

    _replaceHTML(_result, content) {
        if (this.#host?.isConnected) return this.view.requestRender();
        this.#host = document.createElement("div");
        this.#host.className = "persona-host";
        content.replaceChildren(this.#host);
        this.view.mount(this.#host);
    }

    _onClose(options) {
        super._onClose(options);
        if (this.#host) this.view.unmount(this.#host);
        this.#host = null;
    }
}
