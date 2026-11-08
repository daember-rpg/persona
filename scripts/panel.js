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
        host.addEventListener("dragover", this.#onDragOver);
        host.addEventListener("dragleave", this.#onDragLeave);
        host.addEventListener("drop", this.#onDrop);
        this.requestRender();
    }

    unmount(host) {
        if (!this.#hosts.delete(host)) return;
        host.removeEventListener("click", this.#onClick);
        host.removeEventListener("input", this.#onInput);
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

    /* Drop an Actor, Journal entry or Journal page on the panel to add it (GM). */
    #onDragOver = event => {
        if (!game.user.isGM) return;
        event.preventDefault();
        event.currentTarget.querySelector("[data-drop-zone]")?.classList.add("is-over");
    };

    #onDragLeave = event => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        event.currentTarget.querySelector("[data-drop-zone]")?.classList.remove("is-over");
    };

    #onDrop = async event => {
        if (!game.user.isGM) return;
        event.preventDefault();
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
