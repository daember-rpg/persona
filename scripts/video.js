/**
 * Full-screen video, played for everyone at the same time.
 *
 * The GM writes { path, startedAt, offset, paused } to a world setting; every client derives
 * where the video should be from the server clock, so late joiners and pauses stay in sync.
 * Players can close it for themselves. A card's "watch again" plays locally, for one person.
 */
import { DEFAULT_VIDEO } from "./constants.js";
import { getSetting, setSetting } from "./settings.js";

const DRIFT = 0.75; // seconds of drift tolerated before seeking
const t = key => game.i18n.localize(key);
const now = () => game.time?.serverTime ?? Date.now();

export class VideoPlayer {
    #root = null;
    #video = null;
    #mode = null;          // "shared" | "local" | null
    #dismissed = null;     // nonce the user closed locally
    #localPaused = false;
    #titleTimer = null;

    #ensure() {
        if (this.#root) return this.#root;
        const root = document.createElement("div");
        root.id = "persona-video";
        root.className = "persona persona-video";
        root.hidden = true;
        root.innerHTML = `
            <div class="persona-video__box">
                <video playsinline preload="auto"></video>
                <div class="persona-video__title"><span></span><small></small></div>
                <div class="persona-video__progress"><i></i></div>
            </div>
            <button type="button" class="persona-video__close" data-video-tool="close" aria-label="${t("PERSONA.Close")}"><i class="fa-solid fa-xmark" inert></i></button>
            <button type="button" class="persona-video__unmute" data-video-tool="unblock" hidden><i class="fa-solid fa-volume-high" inert></i> ${t("PERSONA.Video.ClickToPlay")}</button>
            <div class="persona-video__tools"></div>`;
        document.body.append(root);
        this.#root = root;
        this.#video = root.querySelector("video");
        this.#video.addEventListener("timeupdate", () => this.#progress());
        this.#video.addEventListener("ended", () => this.#onEnded());
        this.#video.addEventListener("loadedmetadata", () => this.sync());
        root.addEventListener("click", this.#onClick);
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && this.#mode && !root.hidden && !(this.#mode === "shared" && game.user.isGM)) {
                event.stopPropagation();
                this.#close();
            }
        }, true);
        return root;
    }

    get #state() {
        return { ...DEFAULT_VIDEO, ...(getSetting("video") ?? {}) };
    }

    /* -------------------------------------------- */
    /*  GM: shared playback                         */
    /* -------------------------------------------- */

    static async playForAll({ path, title = "", subtitle = "" }) {
        if (!game.user.isGM || !path) return;
        await setSetting("video", {
            nonce: foundry.utils.randomID(),
            path, title, subtitle,
            startedAt: now(),
            offset: 0,
            paused: false
        });
    }

    static async stopForAll() {
        if (!game.user.isGM) return;
        await setSetting("video", foundry.utils.deepClone(DEFAULT_VIDEO));
    }

    async #setPaused(paused) {
        const state = this.#state;
        const position = this.#position(state);
        await setSetting("video", { ...state, paused, offset: position, startedAt: now() });
    }

    async #restart() {
        await setSetting("video", { ...this.#state, offset: 0, startedAt: now(), paused: false });
    }

    /* -------------------------------------------- */
    /*  Everyone: follow the shared state           */
    /* -------------------------------------------- */

    #position(state) {
        return state.paused ? state.offset : state.offset + Math.max(0, now() - state.startedAt) / 1000;
    }

    /** Called on load and whenever the shared video setting changes. */
    sync() {
        if (this.#mode === "local") return;
        const state = this.#state;
        if (!state.path || state.nonce === this.#dismissed) return this.#hide();

        const root = this.#ensure();
        const video = this.#video;
        const fresh = this.#mode !== "shared" || video.dataset.nonce !== state.nonce;
        this.#mode = "shared";
        if (fresh) {
            video.dataset.nonce = state.nonce;
            video.src = state.path;
            video.loop = false;
            this.#showTitle(state.title, state.subtitle);
        }
        video.volume = Number(getSetting("videoVolume") ?? 0.8);
        root.hidden = false;
        document.body.classList.add("persona-video-open");
        this.#renderTools();

        if (!Number.isFinite(video.duration)) return; // wait for metadata
        const target = Math.min(this.#position(state), Math.max(0, video.duration - 0.1));
        if (Math.abs(video.currentTime - target) > DRIFT) video.currentTime = target;
        if (state.paused) video.pause();
        else this.#play();
    }

    /* -------------------------------------------- */
    /*  Local replay from a card                    */
    /* -------------------------------------------- */

    playLocal({ path, title = "", subtitle = "" }) {
        if (!path) return;
        const root = this.#ensure();
        this.#mode = "local";
        this.#localPaused = false;
        const video = this.#video;
        video.dataset.nonce = "";
        video.src = path;
        video.currentTime = 0;
        video.volume = Number(getSetting("videoVolume") ?? 0.8);
        this.#showTitle(title, subtitle);
        root.hidden = false;
        document.body.classList.add("persona-video-open");
        this.#renderTools();
        this.#play();
    }

    /* -------------------------------------------- */

    #play() {
        const unblock = this.#root.querySelector(".persona-video__unmute");
        this.#video.play().then(() => { unblock.hidden = true; }).catch(() => {
            // Browsers block sound until the page has been clicked.
            unblock.hidden = false;
        });
    }

    #showTitle(title, subtitle) {
        const box = this.#root.querySelector(".persona-video__title");
        box.querySelector("span").textContent = title ?? "";
        box.querySelector("small").textContent = subtitle ?? "";
        box.hidden = !title;
        box.classList.remove("is-in");
        void box.offsetWidth;
        box.classList.add("is-in");
    }

    #progress() {
        const bar = this.#root?.querySelector(".persona-video__progress i");
        const video = this.#video;
        if (bar && video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    }

    #renderTools() {
        const tools = this.#root.querySelector(".persona-video__tools");
        const shared = this.#mode === "shared";
        const paused = shared ? this.#state.paused : this.#localPaused;
        const button = (tool, icon, label) => `<button type="button" class="persona-mini" data-video-tool="${tool}"><i class="${icon}" inert></i> ${label}</button>`;
        const pause = paused ? button("resume", "fa-solid fa-play", t("PERSONA.Video.Resume")) : button("pause", "fa-solid fa-pause", t("PERSONA.Video.Pause"));
        if (shared && game.user.isGM) {
            tools.innerHTML = `<span class="persona-video__tag">${t("PERSONA.Video.ForEveryone")}</span>`
                + pause + button("restart", "fa-solid fa-rotate-left", t("PERSONA.Video.Restart"))
                + button("stop", "fa-solid fa-stop", t("PERSONA.Video.Stop"));
        } else if (shared) {
            tools.innerHTML = button("mute", this.#video.muted ? "fa-solid fa-volume-xmark" : "fa-solid fa-volume-high",
                this.#video.muted ? t("PERSONA.Video.Unmute") : t("PERSONA.Video.Mute"));
        } else {
            tools.innerHTML = `<span class="persona-video__tag">${t("PERSONA.Video.JustYou")}</span>`
                + pause + button("restart", "fa-solid fa-rotate-left", t("PERSONA.Video.Restart"));
        }
        // The X closes it for this user; the GM stops it for everyone from the bar.
        this.#root.querySelector(".persona-video__close").hidden = shared && game.user.isGM;
    }

    #onClick = event => {
        const tool = event.target.closest("[data-video-tool]")?.dataset.videoTool;
        if (!tool) return;
        const shared = this.#mode === "shared";
        switch (tool) {
            case "close": return this.#close();
            case "unblock": return this.#play();
            case "mute": this.#video.muted = !this.#video.muted; return this.#renderTools();
            case "pause":
                if (shared) return this.#setPaused(true);
                this.#localPaused = true; this.#video.pause(); return this.#renderTools();
            case "resume":
                if (shared) return this.#setPaused(false);
                this.#localPaused = false; this.#play(); return this.#renderTools();
            case "restart":
                if (shared) return this.#restart();
                this.#video.currentTime = 0; this.#play(); return;
            case "stop": return VideoPlayer.stopForAll();
        }
    };

    #onEnded() {
        if (this.#mode === "shared" && game.user.isGM) {
            return VideoPlayer.stopForAll();
        }
        this.#close();
    }

    #close() {
        if (this.#mode === "shared") this.#dismissed = this.#state.nonce;
        this.#hide();
        // A local replay ends: if a shared video is still running, show it again.
        if (this.#mode === null) this.sync();
    }

    #hide() {
        this.#mode = null;
        if (!this.#root) return;
        this.#video.pause();
        this.#video.removeAttribute("src");
        this.#video.load();
        this.#root.hidden = true;
        document.body.classList.remove("persona-video-open");
    }
}

