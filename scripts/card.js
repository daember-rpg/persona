/**
 * The person/place card: a centered overlay with the portrait, what this user knows,
 * and their notes. Closes with the X, Escape or a click outside.
 */
import { MODULE_ID, TEMPLATE_ROOT } from "./constants.js";
import { buildCardContext } from "./view-data.js";
import { getEntry, canSee, markSeen, savePrivateNote, showHandout } from "./store.js";
import { addSharedNote, deleteSharedNote } from "./relay.js";

const renderTemplate = (...args) => foundry.applications.handlebars.renderTemplate(...args);

export class CardOverlay {
    #layer = null;
    #id = null;
    #tab = "private";
    #saveTimer = null;
    #draft = null;

    constructor({ replayVideo }) {
        this.replayVideo = replayVideo;
    }

    get openId() {
        return this.#id;
    }

    #ensure() {
        if (this.#layer) return this.#layer;
        const layer = document.createElement("div");
        layer.id = "persona-card-layer";
        layer.className = "persona persona-card-layer";
        layer.hidden = true;
        layer.addEventListener("click", this.#onClick);
        layer.addEventListener("input", this.#onInput);
        layer.addEventListener("submit", this.#onSubmit);
        document.body.append(layer);
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && this.#id) {
                event.stopPropagation();
                this.close();
            }
        }, true);
        this.#layer = layer;
        return layer;
    }

    async open(id) {
        const entry = getEntry(id);
        if (!entry || !canSee(entry, "face")) return;
        if (this.#id !== id) this.#tab = game.user.isGM ? "shared" : "private";
        this.#id = id;
        if (!game.user.isGM) markSeen(id);
        await this.render();
    }

    async close() {
        await this.#flushNote();
        this.#id = null;
        if (this.#layer) {
            this.#layer.hidden = true;
            this.#layer.innerHTML = "";
        }
    }

    /** Re-renders when the entry, notes or reveals change; closes if it was hidden again. */
    async refresh() {
        if (!this.#id) return;
        const entry = getEntry(this.#id);
        if (!entry || !canSee(entry, "face")) return this.close();
        await this.render();
    }

    async render() {
        const entry = getEntry(this.#id);
        if (!entry) return this.close();
        const layer = this.#ensure();
        const context = await buildCardContext(entry, { tab: this.#tab });
        // Keep what the player is typing if a refresh lands mid-sentence.
        const typingShared = layer.querySelector('input[name="sharedNote"]')?.value ?? "";
        layer.innerHTML = await renderTemplate(`${TEMPLATE_ROOT}/card.hbs`, context);
        if (this.#draft !== null) {
            const area = layer.querySelector('textarea[name="privateNote"]');
            if (area) area.value = this.#draft;
        }
        const shared = layer.querySelector('input[name="sharedNote"]');
        if (shared && typingShared) shared.value = typingShared;
        layer.hidden = false;
    }

    #onClick = event => {
        if (event.target === this.#layer) return this.close();
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const action = target.dataset.action;
        if (action === "closeCard") return this.close();
        if (action === "noteTab") {
            this.#flushNote();
            this.#tab = target.dataset.tab;
            return this.render();
        }
        if (action === "deleteNote") return deleteSharedNote(this.#id, target.dataset.note);
        if (action === "replayVideo") return this.replayVideo(this.#id);
        if (action === "openLinked") return this.#openLinked(target.dataset.id);
        if (action === "showHandout") {
            const who = target.dataset.who === "all" ? game.i18n.localize("PERSONA.Reveal.Everyone") : game.users.get(target.dataset.who)?.name;
            return showHandout(this.#id, target.dataset.who).then(() =>
                ui.notifications.info(game.i18n.format("PERSONA.Handout.Shown", { name: getEntry(this.#id)?.name ?? "", who })));
        }
    };

    async #openLinked(id) {
        await this.#flushNote();
        this.#tab = game.user.isGM ? "shared" : "private";
        this.#id = null;
        return this.open(id);
    }

    #onInput = event => {
        if (event.target.name !== "privateNote") return;
        this.#draft = event.target.value;
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => this.#flushNote(), 700);
    };

    async #flushNote() {
        clearTimeout(this.#saveTimer);
        if (this.#draft === null || !this.#id) return;
        const text = this.#draft;
        this.#draft = null;
        try {
            await savePrivateNote(this.#id, text);
        } catch (error) {
            console.error(`${MODULE_ID} | saving note failed`, error);
        }
    }

    #onSubmit = async event => {
        if (!event.target.matches("[data-note-form]")) return;
        event.preventDefault();
        const input = event.target.querySelector('input[name="sharedNote"]');
        const text = input?.value.trim();
        if (!text) return;
        input.value = "";
        await addSharedNote(this.#id, text);
        this.#layer.querySelector('input[name="sharedNote"]')?.focus();
    };
}
