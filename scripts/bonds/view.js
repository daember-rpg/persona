/**
 * The Bonds wheel: framework-free DOM view. It knows nothing about Foundry — everything it
 * needs comes through an adapter, so the module and the standalone preview run the same code.
 *
 * adapter = {
 *   t(key), getModel(), saveBonds(bonds), openCard(entryId),
 *   selectPlayer(userId), selectMoment(momentId | null), recordMoment(), deleteMoment(momentId)
 * }
 * getModel() → {
 *   editable, isGM, owner: { id, name }, self: { name, img }, party: [{ id, name, img }],
 *   entries: [{ id, name, title, img, frame, status, isNew }], bonds, folders: [{ label, entryIds }],
 *   players: [{ id, name }], moments: [{ id, label, ts }], momentId
 * }
 */
import {
    GEOMETRY, LINK_TYPES, SECTOR_COLORS, RINGS, SELF,
    normalizeBonds, layout, hitTest, wedgePath, arcPath, linkPath, polar,
    addSector, updateSector, moveSector, removeSector, place, unplace, setLink, removeLink, fromFolders
} from "./model.js";

const G = GEOMETRY;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NODE_R = { self: 54, party: 34, entry: 28 };
const DRAG_THRESHOLD = 5;

export class BondsView {
    /** Pan and zoom of the stage; `auto` refits when the window is resized. */
    #cam = { s: 1, x: 0, y: 0, auto: true };
    #model = null;
    #bonds = null;
    #laid = null;
    #visible = new Set();
    #linkMode = false;
    #linkFrom = null;
    #gesture = null;
    #resize = null;

    constructor(host, adapter) {
        this.host = host;
        this.adapter = adapter;
        this.t = key => adapter.t(`PERSONA.Bonds.${key}`);
        host.classList.add("persona", "bonds-host");
        host.addEventListener("pointerdown", this.#onPointerDown);
        host.addEventListener("pointermove", this.#onHover);
        host.addEventListener("click", this.#onClick);
        host.addEventListener("wheel", this.#onWheel, { passive: false });
        host.addEventListener("keydown", this.#onKey);
        host.addEventListener("submit", this.#onSubmit);
        this.#resize = new ResizeObserver(() => { if (this.#cam.auto) this.fit(); });
        this.refresh();
    }

    destroy() {
        this.#resize?.disconnect();
        this.host.removeEventListener("pointerdown", this.#onPointerDown);
        this.host.removeEventListener("pointermove", this.#onHover);
        this.host.removeEventListener("click", this.#onClick);
        this.host.removeEventListener("wheel", this.#onWheel);
        this.host.removeEventListener("keydown", this.#onKey);
        this.host.removeEventListener("submit", this.#onSubmit);
        this.#endGesture();
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    /** Re-reads the model and redraws (keeps the camera). Skipped mid-drag, redrawn after. */
    refresh() {
        if (this.#gesture?.dragging) { this.#gesture.stale = true; return; }
        this.#model = this.adapter.getModel();
        this.#bonds = normalizeBonds(this.#model.bonds);
        if (!this.#model.editable) this.#linkMode = false;
        this.#render();
    }

    #entryMap() {
        return new Map(this.#model.entries.map(e => [e.id, e]));
    }

    #render() {
        const m = this.#model;
        const entries = this.#entryMap();
        this.#visible = new Set(entries.keys());
        this.#laid = layout(this.#bonds, this.#visible, m.party.map(p => p.id));
        const placed = new Set(this.#bonds.placements.map(p => p.id));
        const loose = m.entries.filter(e => !placed.has(e.id));
        const pop = this.host.querySelector(".bonds-pop");
        const keepPop = pop && !pop.hidden ? pop.outerHTML : null;

        this.host.innerHTML = `
        <div class="bonds ${m.editable ? "is-editable" : "is-readonly"} ${this.#linkMode ? "is-linking" : ""}" tabindex="-1">
            ${this.#renderBar()}
            <div class="bonds-main">
                <div class="bonds-viewport" data-viewport>
                    <div class="bonds-stage" data-stage>
                        ${this.#renderSvg()}
                        <div class="bonds-layer">${this.#renderNodes(entries)}${this.#renderLinkMarkers()}</div>
                    </div>
                    ${this.#renderBanner()}
                    ${this.#renderLegend()}
                    <div class="bonds-zoom">
                        <button type="button" class="persona-icon-btn" data-action="zoomIn" aria-label="${esc(this.t("ZoomIn"))}" title="${esc(this.t("ZoomIn"))}"><i class="fa-solid fa-plus" inert></i></button>
                        <button type="button" class="persona-icon-btn" data-action="zoomOut" aria-label="${esc(this.t("ZoomOut"))}" title="${esc(this.t("ZoomOut"))}"><i class="fa-solid fa-minus" inert></i></button>
                        <button type="button" class="persona-icon-btn" data-action="fit" aria-label="${esc(this.t("Fit"))}" title="${esc(this.t("Fit"))}"><i class="fa-solid fa-expand" inert></i></button>
                    </div>
                </div>
                ${this.#renderDrawer(loose)}
            </div>
            ${this.#renderTimeline()}
            <div class="bonds-pop" hidden></div>
        </div>`;

        this.#applyCam();
        const viewport = this.host.querySelector("[data-viewport]");
        this.#resize.disconnect();
        this.#resize.observe(viewport);
        if (this.#cam.auto) this.fit();
        if (keepPop) this.#closePop();
    }

    #renderBar() {
        const m = this.#model;
        const players = m.isGM && m.players.length
            ? `<div class="bonds-players" role="tablist">${m.players.map(p => `
                <button type="button" class="persona-chip ${p.id === m.owner.id ? "is-active" : ""}" data-action="player" data-id="${esc(p.id)}" aria-pressed="${p.id === m.owner.id}">
                    <i class="fa-solid fa-user" inert></i><span>${esc(p.name)}</span>
                </button>`).join("")}</div>`
            : "";
        const tools = [];
        if (m.editable) {
            tools.push(`<button type="button" class="persona-button bonds-tool ${this.#linkMode ? "is-on" : ""}" data-action="linkMode" aria-pressed="${this.#linkMode}" title="${esc(this.t("LinkHint"))}"><i class="fa-solid fa-link" inert></i><span>${esc(this.t("Link"))}</span></button>`);
            tools.push(`<button type="button" class="persona-button bonds-tool" data-action="newSector"><i class="fa-solid fa-chart-pie" inert></i><span>${esc(this.t("AddSector"))}</span></button>`);
        }
        if (m.isGM && m.players.length) {
            tools.push(`<button type="button" class="persona-button bonds-tool bonds-tool--accent" data-action="recordMoment" title="${esc(this.t("RecordHint"))}"><i class="fa-solid fa-camera-retro" inert></i><span>${esc(this.t("Record"))}</span></button>`);
        }
        return `
        <header class="bonds-bar">
            <div class="bonds-bar__title">
                <span class="persona-eyebrow">${esc(m.isGM ? this.t("ReadOnlyEyebrow") : this.t("Eyebrow"))}</span>
                <h2>${esc(this.t("Title"))}${m.owner?.name ? ` <small>${esc(m.owner.name)}</small>` : ""}</h2>
            </div>
            ${players}
            <div class="bonds-bar__tools">${tools.join("")}</div>
        </header>`;
    }

    #renderSvg() {
        const m = this.#model;
        const laid = this.#laid;
        const C = G.center;
        const outer = G.ringBands[2][1];
        const inner = G.ringBands[0][0];
        const parts = [];

        // Gradients per slice colour, brightest near the party, fading outward.
        const defs = [`<radialGradient id="bonds-bg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3a2a22"/><stop offset="0.55" stop-color="#211d19"/><stop offset="1" stop-color="#14120f" stop-opacity="0"/></radialGradient>`];
        const colors = [...new Set(laid.sectors.map(s => s.color))];
        colors.forEach((color, i) => defs.push(`<radialGradient id="bonds-g${i}" gradientUnits="userSpaceOnUse" cx="${C}" cy="${C}" r="${outer}"><stop offset="${(inner / outer).toFixed(3)}" stop-color="${color}" stop-opacity="0.42"/><stop offset="0.7" stop-color="${color}" stop-opacity="0.16"/><stop offset="1" stop-color="${color}" stop-opacity="0.05"/></radialGradient>`));
        for (const type of LINK_TYPES.filter(t => t.directed)) {
            defs.push(`<marker id="bonds-arrow-${type.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${type.color}"/></marker>`);
        }
        const gradient = color => `url(#bonds-g${colors.indexOf(color)})`;

        parts.push(`<circle cx="${C}" cy="${C}" r="${G.labelRadius + 16}" fill="url(#bonds-bg)"/>`);
        // Fine radial grid, like an astrolabe.
        const spokes = [];
        for (let a = 0; a < 360; a += 6) {
            const p = polar(inner, a * Math.PI / 180), q = polar(outer, a * Math.PI / 180);
            spokes.push(`M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
        }
        parts.push(`<path class="bonds-grid" d="${spokes.join("")}"/>`);
        for (const r of [inner, G.ringBands[0][1], G.ringBands[1][1], outer]) parts.push(`<circle class="bonds-ring" cx="${C}" cy="${C}" r="${r}"/>`);

        // Slices: a wedge per ring (drop targets), divider arcs, the label along the rim.
        for (const s of laid.sectors) {
            parts.push(`<path class="bonds-sector" d="${wedgePath(inner, outer, s.start, s.end)}" fill="${gradient(s.color)}" stroke="${s.color}"/>`);
            for (const ring of RINGS) {
                const [r1, r2] = G.ringBands[ring - 1];
                parts.push(`<path class="bonds-cell" data-cell="${esc(s.id)}|${ring}" d="${wedgePath(r1, r2, s.start, s.end)}"/>`);
            }
            for (const r of [G.ringBands[0][1], G.ringBands[1][1]]) {
                parts.push(`<path class="bonds-divider" d="${arcPath(r, s.start, s.end).d}" stroke="${s.color}"/>`);
            }
            const arc = arcPath(G.labelRadius, s.start, s.end);
            const label = s.label || this.t("Unnamed");
            parts.push(`<path id="bonds-arc-${esc(s.id)}" d="${arc.d}" fill="none"/>`);
            parts.push(`<text class="bonds-sector-label" ${m.editable ? `data-action="editSector" data-id="${esc(s.id)}"` : ""} fill="${s.color}" dy="${arc.bottom ? 12 : 0}"><textPath href="#bonds-arc-${esc(s.id)}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
        }
        if (!laid.sectors.length) {
            parts.push(`<circle class="bonds-empty-ring" cx="${C}" cy="${C}" r="${(inner + outer) / 2}"/>`);
            parts.push(`<text class="bonds-empty-text" x="${C}" y="${C - (inner + outer) / 2 - 12}" text-anchor="middle">${esc(m.editable ? this.t("EmptyWheel") : this.t("EmptyWheelReadOnly"))}</text>`);
        }

        // The party ring and the centre.
        parts.push(`<circle class="bonds-party-band" cx="${C}" cy="${C}" r="${(G.partyBand[0] + G.partyBand[1]) / 2}" stroke-width="${G.partyBand[1] - G.partyBand[0]}"/>`);
        parts.push(`<circle class="bonds-ring bonds-ring--party" cx="${C}" cy="${C}" r="${G.partyBand[1]}"/>`);
        parts.push(`<circle class="bonds-ring bonds-ring--self" cx="${C}" cy="${C}" r="${G.partyBand[0]}"/>`);
        if (m.party.length) {
            const arc = arcPath(G.partyBand[1] - 10, -0.5, 0.5);
            parts.push(`<path id="bonds-arc-party" d="${arc.d}" fill="none"/><text class="bonds-party-label"><textPath href="#bonds-arc-party" startOffset="50%" text-anchor="middle">${esc(this.t("Party"))}</textPath></text>`);
        }

        // Links between portraits.
        const links = [];
        for (const link of this.#bonds.links) {
            const geo = this.#linkGeometry(link);
            if (!geo) continue;
            const type = LINK_TYPES.find(t => t.id === link.type) ?? LINK_TYPES[0];
            links.push(`<path class="bonds-link bonds-link--${type.id}" d="${geo.d}" stroke="${type.color}" ${type.directed ? `marker-end="url(#bonds-arrow-${type.id})"` : ""}/>`);
        }
        parts.push(`<g class="bonds-links">${links.join("")}<path class="bonds-rubber" data-rubber d="" /></g>`);

        return `<svg class="bonds-svg" viewBox="0 0 ${G.size} ${G.size}" width="${G.size}" height="${G.size}" aria-hidden="true"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
    }

    #radiusOf(id) {
        if (id === SELF) return NODE_R.self;
        return this.#model.party.some(p => p.id === id) ? NODE_R.party : NODE_R.entry;
    }

    #linkGeometry(link) {
        const a = this.#laid.nodes.get(link.a), b = this.#laid.nodes.get(link.b);
        if (!a || !b) return null;
        return linkPath(a, b, this.#radiusOf(link.a) + 3, this.#radiusOf(link.b) + 5);
    }

    #renderNodes(entries) {
        const m = this.#model;
        const laid = this.#laid;
        const sectors = new Map(laid.sectors.map(s => [s.id, s]));
        const out = [];
        const picked = id => (this.#linkFrom === id ? "is-picked" : "");

        out.push(`<button type="button" class="bonds-node bonds-node--self ${picked(SELF)}" data-node="${SELF}" style="left:${G.center}px;top:${G.center}px">
            <img src="${esc(m.self.img)}" alt="" draggable="false"><span class="bonds-node__name">${esc(m.self.name)}</span></button>`);
        for (const p of m.party) {
            const pos = laid.nodes.get(p.id);
            out.push(`<button type="button" class="bonds-node bonds-node--party ${picked(p.id)}" data-node="${esc(p.id)}" style="left:${pos.x}px;top:${pos.y}px">
                <img src="${esc(p.img)}" alt="" draggable="false"><span class="bonds-node__name">${esc(p.name)}</span></button>`);
        }
        for (const placement of this.#bonds.placements) {
            const entry = entries.get(placement.id);
            const pos = laid.nodes.get(placement.id);
            if (!entry || !pos) continue;
            const color = sectors.get(placement.sector)?.color ?? SECTOR_COLORS[0];
            out.push(this.#entryNode(entry, `left:${pos.x}px;top:${pos.y}px;--c:${color}`, picked(entry.id)));
        }
        return out.join("");
    }

    #entryNode(entry, style, extra = "") {
        const status = entry.status && entry.status !== "alive" ? `is-${entry.status}` : "";
        const mark = entry.status === "dead" ? `<span class="bonds-node__mark"><i class="fa-solid fa-skull" inert></i></span>`
            : entry.status === "missing" ? `<span class="bonds-node__mark"><i class="fa-solid fa-question" inert></i></span>` : "";
        const name = entry.name ?? "???";
        const statusText = entry.status && entry.status !== "alive" ? this.adapter.t(`PERSONA.Status.${entry.status}`) : "";
        return `<button type="button" class="bonds-node bonds-node--entry ${status} ${entry.isNew ? "is-new" : ""} ${extra}" data-node="${esc(entry.id)}" data-entry="${esc(entry.id)}" style="${style}" aria-label="${esc(name)}">
            <img class="persona-fit" src="${esc(entry.img)}" style="${esc(entry.frame ?? "")}" alt="" draggable="false">${mark}
            <span class="bonds-node__name">${esc(name)}${entry.title ? `<small>${esc(entry.title)}</small>` : ""}${statusText ? `<small class="bonds-node__status">${esc(statusText)}</small>` : ""}</span></button>`;
    }

    #renderLinkMarkers() {
        const editable = this.#model.editable;
        return this.#bonds.links.map(link => {
            const geo = this.#linkGeometry(link);
            if (!geo) return "";
            const type = LINK_TYPES.find(t => t.id === link.type) ?? LINK_TYPES[0];
            const label = this.t(`Type.${type.id}`);
            return `<button type="button" class="bonds-marker" ${editable ? `data-action="editLink"` : ""} data-id="${esc(link.id)}" style="left:${geo.mid.x}px;top:${geo.mid.y}px;--c:${type.color}" title="${esc(label)}" aria-label="${esc(label)}"><i class="${type.icon}" inert></i></button>`;
        }).join("");
    }

    #renderBanner() {
        const m = this.#model;
        const moment = m.momentId ? m.moments.find(x => x.id === m.momentId) : null;
        if (moment) {
            return `<div class="bonds-banner"><i class="fa-solid fa-clock-rotate-left" inert></i>
                <span>${esc(this.t("Viewing"))} <b>${esc(moment.label)}</b></span>
                <button type="button" class="persona-mini" data-action="moment" data-id="">${esc(this.t("BackToNow"))}</button>
                ${m.isGM ? `<button type="button" class="persona-mini persona-mini--icon" data-action="deleteMoment" data-id="${esc(moment.id)}" title="${esc(this.t("DeleteMoment"))}" aria-label="${esc(this.t("DeleteMoment"))}"><i class="fa-solid fa-trash" inert></i></button>` : ""}
            </div>`;
        }
        if (this.#linkMode) {
            return `<div class="bonds-banner bonds-banner--link"><i class="fa-solid fa-link" inert></i><span>${esc(this.#linkFrom ? this.t("LinkPickSecond") : this.t("LinkPickFirst"))}</span>
                <button type="button" class="persona-mini" data-action="linkMode">${esc(this.t("Done"))}</button></div>`;
        }
        if (!m.editable && m.isGM) return `<div class="bonds-banner bonds-banner--quiet"><i class="fa-solid fa-eye" inert></i><span>${esc(this.t("GMReadOnly"))}</span></div>`;
        return "";
    }

    #renderLegend() {
        const rings = [this.t("Ring1"), this.t("Ring2"), this.t("Ring3")];
        const used = new Set(this.#bonds.links.map(l => l.type));
        const types = LINK_TYPES.filter(t => used.has(t.id));
        return `<div class="bonds-legend">
            <div class="bonds-legend__rings">${rings.map((r, i) => `<span><b>${i + 1}</b>${esc(r)}</span>`).join("")}</div>
            ${types.length ? `<div class="bonds-legend__types">${types.map(t => `<span style="--c:${t.color}"><i class="${t.icon}" inert></i>${esc(this.t(`Type.${t.id}`))}</span>`).join("")}</div>` : ""}
        </div>`;
    }

    #renderDrawer(loose) {
        const m = this.#model;
        let body;
        if (!m.entries.length) {
            body = `<p class="bonds-drawer__hint"><i class="fa-solid fa-masks-theater" inert></i>${esc(m.isGM ? this.t("NobodyKnownGM") : this.t("NobodyKnown"))}</p>`;
        } else if (!loose.length) {
            body = `<p class="bonds-drawer__hint"><i class="fa-solid fa-check" inert></i>${esc(this.t("AllPlaced"))}</p>`;
        } else {
            body = `<div class="bonds-drawer__list">${loose.map(e => `
                <div class="bonds-loose ${e.status && e.status !== "alive" ? `is-${e.status}` : ""} ${e.isNew ? "is-new" : ""}" data-loose="${esc(e.id)}" data-entry="${esc(e.id)}" role="button" tabindex="0">
                    <span class="bonds-loose__img"><img class="persona-fit" src="${esc(e.img)}" style="${esc(e.frame ?? "")}" alt="" draggable="false"></span>
                    <span class="bonds-loose__name">${esc(e.name ?? "???")}${e.title ? `<small>${esc(e.title)}</small>` : ""}</span>
                </div>`).join("")}</div>`;
        }
        const start = m.editable && !this.#bonds.sectors.length && m.folders.length
            ? `<button type="button" class="persona-button bonds-drawer__start" data-action="fromFolders"><i class="fa-solid fa-wand-magic-sparkles" inert></i><span>${esc(this.t("FromFolders"))}</span></button>`
            : "";
        const hint = m.editable && loose.length
            ? `<p class="bonds-drawer__tip">${esc(this.#bonds.sectors.length ? this.t("DragHint") : this.t("SectorFirst"))}</p>` : "";
        return `<aside class="bonds-drawer" data-drawer>
            <div class="bonds-drawer__head"><span class="persona-eyebrow">${esc(this.t("Unplaced"))}</span><span class="bonds-drawer__count">${loose.length}</span></div>
            ${start}${hint}${body}
        </aside>`;
    }

    #renderTimeline() {
        const m = this.#model;
        if (!m.moments.length && !m.isGM) return "";
        if (!m.moments.length) return `<footer class="bonds-timeline is-empty"><i class="fa-solid fa-clock-rotate-left" inert></i><span>${esc(this.t("NoMoments"))}</span></footer>`;
        const ticks = m.moments.map(moment => `
            <button type="button" class="bonds-tick ${m.momentId === moment.id ? "is-active" : ""}" data-action="moment" data-id="${esc(moment.id)}" title="${esc(moment.label)}">
                <span class="bonds-tick__dot"></span><span class="bonds-tick__label">${esc(moment.label)}</span>
            </button>`).join("");
        return `<footer class="bonds-timeline">
            <span class="persona-eyebrow">${esc(this.t("Timeline"))}</span>
            <div class="bonds-track">${ticks}
                <button type="button" class="bonds-tick bonds-tick--now ${!m.momentId ? "is-active" : ""}" data-action="moment" data-id=""><span class="bonds-tick__dot"></span><span class="bonds-tick__label">${esc(this.t("Now"))}</span></button>
            </div>
        </footer>`;
    }

    /* -------------------------------------------- */
    /*  Camera                                      */
    /* -------------------------------------------- */

    #applyCam() {
        const stage = this.host.querySelector("[data-stage]");
        if (!stage) return;
        stage.style.transform = `translate(${this.#cam.x}px, ${this.#cam.y}px) scale(${this.#cam.s})`;
        // Labels and markers keep a readable size whatever the zoom.
        stage.style.setProperty("--inv", String(1 / this.#cam.s));
    }

    fit() {
        const viewport = this.host.querySelector("[data-viewport]");
        if (!viewport) return;
        const { width, height } = viewport.getBoundingClientRect();
        if (!width || !height) return;
        const s = Math.min(width, height) / (G.size * 1.04);
        this.#cam = { s, x: (width - G.size * s) / 2, y: (height - G.size * s) / 2, auto: true };
        this.#applyCam();
    }

    #zoomAt(factor, clientX, clientY) {
        const viewport = this.host.querySelector("[data-viewport]");
        const rect = viewport.getBoundingClientRect();
        const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
        const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
        const s = Math.min(3, Math.max(0.25, this.#cam.s * factor));
        const k = s / this.#cam.s;
        this.#cam = { s, x: px - (px - this.#cam.x) * k, y: py - (py - this.#cam.y) * k, auto: false };
        this.#applyCam();
    }

    #toStage(clientX, clientY) {
        const rect = this.host.querySelector("[data-viewport]").getBoundingClientRect();
        return { x: (clientX - rect.left - this.#cam.x) / this.#cam.s, y: (clientY - rect.top - this.#cam.y) / this.#cam.s };
    }

    #onWheel = event => {
        if (!event.target.closest("[data-viewport]")) return;
        event.preventDefault();
        this.#zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
    };

    /* -------------------------------------------- */
    /*  Pointer: drag portraits, pan, link          */
    /* -------------------------------------------- */

    #onPointerDown = event => {
        if (event.button !== 0) return;
        if (event.target.closest(".bonds-pop")) return;
        const node = event.target.closest("[data-entry]");
        const viewport = event.target.closest("[data-viewport]");
        if (node && this.#model.editable && !this.#linkMode) {
            this.#gesture = { kind: "drag", id: node.dataset.entry, source: node, x0: event.clientX, y0: event.clientY, dragging: false };
        } else if (viewport && !event.target.closest("button, [data-action]")) {
            this.#gesture = { kind: "pan", x0: event.clientX, y0: event.clientY, cx: this.#cam.x, cy: this.#cam.y, moved: false };
        } else {
            return;
        }
        window.addEventListener("pointermove", this.#onPointerMove);
        window.addEventListener("pointerup", this.#onPointerUp);
        window.addEventListener("pointercancel", this.#onPointerCancel);
    };

    #onPointerMove = event => {
        const g = this.#gesture;
        if (!g) return;
        const dx = event.clientX - g.x0, dy = event.clientY - g.y0;
        if (g.kind === "pan") {
            if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            g.moved = true;
            this.#cam = { ...this.#cam, x: g.cx + dx, y: g.cy + dy, auto: false };
            this.#applyCam();
            this.host.querySelector("[data-viewport]")?.classList.add("is-panning");
            return;
        }
        if (!g.dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            g.dragging = true;
            g.ghost = this.#makeGhost(g.source);
            g.source.classList.add("is-lifted");
            this.host.querySelector(".bonds")?.classList.add("is-dragging");
        }
        g.ghost.style.left = `${event.clientX}px`;
        g.ghost.style.top = `${event.clientY}px`;
        g.target = this.#dropTarget(event, g.id);
        this.#highlight(g.target);
    };

    #onPointerUp = event => {
        const g = this.#gesture;
        this.#endGesture();
        if (!g) return;
        if (g.kind === "pan") return;
        if (!g.dragging) return; // a plain click: handled by #onClick
        g.ghost?.remove();
        g.source.classList.remove("is-lifted");
        this.host.querySelector(".bonds")?.classList.remove("is-dragging");
        this.#highlight(null);
        this.#suppressClick = true;
        setTimeout(() => { this.#suppressClick = false; }, 0);
        const target = this.#dropTarget(event, g.id);
        if (target.kind === "cell") this.#commit(place(this.#bonds, g.id, target.sector, target.ring, target.before));
        else if (target.kind === "out") this.#commit(unplace(this.#bonds, g.id));
        else if (g.stale) this.refresh();
    };

    #onPointerCancel = () => {
        const g = this.#gesture;
        this.#endGesture();
        if (g?.ghost) g.ghost.remove();
        g?.source?.classList.remove("is-lifted");
        this.host.querySelector(".bonds")?.classList.remove("is-dragging");
        this.#highlight(null);
        if (g?.stale) this.refresh();
    };

    #suppressClick = false;

    /** Link mode: a rubber band from the first portrait to the pointer. */
    #onHover = event => {
        if (!this.#linkMode || !this.#linkFrom) return;
        const rubber = this.host.querySelector("[data-rubber]");
        const from = this.#laid?.nodes.get(this.#linkFrom);
        if (!rubber || !from) return;
        const { x, y } = this.#toStage(event.clientX, event.clientY);
        rubber.setAttribute("d", linkPath(from, { x, y }, this.#radiusOf(this.#linkFrom) + 3, 0).d);
    };

    #endGesture() {
        window.removeEventListener("pointermove", this.#onPointerMove);
        window.removeEventListener("pointerup", this.#onPointerUp);
        window.removeEventListener("pointercancel", this.#onPointerCancel);
        this.host.querySelector("[data-viewport]")?.classList.remove("is-panning");
        this.#gesture = null;
    }

    #makeGhost(source) {
        const ghost = document.createElement("div");
        ghost.className = "persona bonds-ghost";
        const img = source.querySelector("img");
        ghost.innerHTML = `<img class="persona-fit" src="${esc(img?.getAttribute("src"))}" style="${esc(img?.getAttribute("style") ?? "")}" alt="">`;
        document.body.append(ghost);
        return ghost;
    }

    /** Over the drawer → unplace; over the wheel → hit test; elsewhere → nothing. */
    #dropTarget(event, id) {
        const drawer = this.host.querySelector("[data-drawer]")?.getBoundingClientRect();
        const inside = r => r && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
        if (inside(drawer)) return { kind: "out", drawer: true };
        const viewport = this.host.querySelector("[data-viewport]")?.getBoundingClientRect();
        if (!inside(viewport)) return { kind: "none" };
        const { x, y } = this.#toStage(event.clientX, event.clientY);
        const hit = hitTest(x, y, this.#laid, this.#bonds, this.#visible, id);
        // Dropping a not-yet-placed person past the rim does nothing.
        if (hit.kind === "out" && !this.#bonds.placements.some(p => p.id === id)) return { kind: "none" };
        return hit;
    }

    #highlight(target) {
        this.host.querySelectorAll(".bonds-cell.is-target").forEach(el => el.classList.remove("is-target"));
        this.host.querySelector("[data-drawer]")?.classList.toggle("is-target", target?.kind === "out");
        if (target?.kind === "cell") {
            this.host.querySelector(`.bonds-cell[data-cell="${CSS.escape(`${target.sector}|${target.ring}`)}"]`)?.classList.add("is-target");
        }
    }

    /* -------------------------------------------- */
    /*  Clicks                                      */
    /* -------------------------------------------- */

    #onClick = event => {
        if (this.#suppressClick) return;
        if (this.#gesture) return;
        const pop = this.host.querySelector(".bonds-pop");
        const inPop = event.target.closest(".bonds-pop");

        const actionEl = event.target.closest("[data-action]");
        const node = event.target.closest("[data-node]");
        const loose = event.target.closest("[data-loose]");

        if (pop && !pop.hidden && !inPop && !actionEl?.matches('[data-action="editLink"], [data-action="editSector"], [data-action="newSector"]')) {
            this.#closePop();
            if (!node) return;
        }

        if (actionEl) {
            const handler = this.#actions[actionEl.dataset.action];
            if (handler) {
                event.preventDefault();
                return handler(actionEl, actionEl.dataset.id, event);
            }
        }
        if (node && this.#linkMode) return this.#pickForLink(node.dataset.node);
        if (node?.dataset.entry || loose) return this.adapter.openCard((node ?? loose).dataset.entry);
    };

    #onKey = event => {
        if (event.key !== "Escape") return;
        if (!this.host.querySelector(".bonds-pop")?.hidden) { event.stopPropagation(); return this.#closePop(); }
        if (this.#linkMode) { event.stopPropagation(); this.#linkMode = false; this.#linkFrom = null; return this.#render(); }
    };

    #actions = {
        player: (_el, id) => this.adapter.selectPlayer(id),
        moment: (_el, id) => this.adapter.selectMoment(id || null),
        deleteMoment: (_el, id) => this.adapter.deleteMoment(id),
        recordMoment: () => this.adapter.recordMoment(),
        zoomIn: () => this.#zoomAt(1.2),
        zoomOut: () => this.#zoomAt(1 / 1.2),
        fit: () => this.fit(),
        linkMode: () => {
            this.#linkMode = !this.#linkMode;
            this.#linkFrom = null;
            this.#render();
        },
        newSector: el => this.#sectorPop(null, el),
        editSector: (el, id) => this.#sectorPop(id, el),
        editLink: (el, id) => this.#linkPop(id, el),
        fromFolders: () => this.#commit(fromFolders(this.#bonds, this.#model.folders)),
        // Popover actions
        popClose: () => this.#closePop(),
        swatch: el => {
            el.closest(".bonds-pop").querySelectorAll(".bonds-swatch").forEach(s => s.classList.toggle("is-on", s === el));
            const input = el.closest("form")?.querySelector('[name="color"]');
            if (input) input.value = el.dataset.color;
        },
        sectorMove: el => {
            const id = el.closest("[data-sector-form]").dataset.sector;
            this.#commit(moveSector(this.#bonds, id, Number(el.dataset.step)));
            this.#closePop();
        },
        sectorDelete: el => {
            const id = el.closest("[data-sector-form]").dataset.sector;
            this.#commit(removeSector(this.#bonds, id));
            this.#closePop();
        },
        linkType: el => {
            const { a, b } = el.closest("[data-link-form]").dataset;
            this.#commit(setLink(this.#bonds, a, b, el.dataset.type));
            this.#closePop();
        },
        linkFlip: el => {
            const form = el.closest("[data-link-form]");
            const link = this.#bonds.links.find(l => l.id === form.dataset.link);
            if (link) this.#commit(setLink(this.#bonds, link.b, link.a, link.type));
            this.#closePop();
        },
        linkDelete: el => {
            this.#commit(removeLink(this.#bonds, el.closest("[data-link-form]").dataset.link));
            this.#closePop();
        }
    };

    #pickForLink(id) {
        if (!this.#linkFrom) {
            this.#linkFrom = id;
            return this.#render();
        }
        if (this.#linkFrom === id) {
            this.#linkFrom = null;
            return this.#render();
        }
        const a = this.#linkFrom;
        this.#linkFrom = null;
        this.#render();
        const pa = this.#laid.nodes.get(a), pb = this.#laid.nodes.get(id);
        const mid = linkPath(pa, pb).mid;
        this.#linkPop(null, null, { a, b: id, at: mid });
    }

    /* -------------------------------------------- */
    /*  Popovers                                    */
    /* -------------------------------------------- */

    #openPop(html, anchor) {
        const root = this.host.querySelector(".bonds");
        const pop = this.host.querySelector(".bonds-pop");
        pop.innerHTML = html;
        pop.hidden = false;
        const rootRect = root.getBoundingClientRect();
        let x, y;
        if (anchor instanceof Element) {
            const r = anchor.getBoundingClientRect();
            x = r.left + r.width / 2 - rootRect.left;
            y = r.bottom - rootRect.top + 8;
        } else {
            const viewport = this.host.querySelector("[data-viewport]").getBoundingClientRect();
            x = viewport.left - rootRect.left + this.#cam.x + anchor.x * this.#cam.s;
            y = viewport.top - rootRect.top + this.#cam.y + anchor.y * this.#cam.s + 18;
        }
        const w = pop.offsetWidth, h = pop.offsetHeight;
        x = Math.max(8, Math.min(rootRect.width - w - 8, x - w / 2));
        if (y + h > rootRect.height - 8) y = Math.max(8, y - h - 40);
        pop.style.left = `${x}px`;
        pop.style.top = `${y}px`;
        pop.querySelector("input[type=text]")?.focus();
    }

    #closePop() {
        const pop = this.host.querySelector(".bonds-pop");
        if (!pop) return;
        pop.hidden = true;
        pop.innerHTML = "";
    }

    #sectorPop(id, anchor) {
        const sector = id ? this.#bonds.sectors.find(s => s.id === id) : null;
        const color = sector?.color ?? SECTOR_COLORS[this.#bonds.sectors.length % SECTOR_COLORS.length];
        const index = sector ? this.#bonds.sectors.indexOf(sector) : -1;
        const html = `
        <form class="bonds-form" data-sector-form data-sector="${esc(id ?? "")}">
            <span class="persona-eyebrow">${esc(sector ? this.t("EditSector") : this.t("NewSector"))}</span>
            <input type="text" name="label" maxlength="60" value="${esc(sector?.label ?? "")}" placeholder="${esc(this.t("SectorPlaceholder"))}" autocomplete="off">
            <input type="hidden" name="color" value="${color}">
            <div class="bonds-swatches">${SECTOR_COLORS.map(c => `<button type="button" class="bonds-swatch ${c === color ? "is-on" : ""}" data-action="swatch" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("")}</div>
            <div class="bonds-form__row">
                ${sector ? `
                    <button type="button" class="persona-mini persona-mini--icon" data-action="sectorMove" data-step="-1" ${index <= 0 ? "disabled" : ""} title="${esc(this.t("MoveLeft"))}" aria-label="${esc(this.t("MoveLeft"))}"><i class="fa-solid fa-rotate-left" inert></i></button>
                    <button type="button" class="persona-mini persona-mini--icon" data-action="sectorMove" data-step="1" ${index >= this.#bonds.sectors.length - 1 ? "disabled" : ""} title="${esc(this.t("MoveRight"))}" aria-label="${esc(this.t("MoveRight"))}"><i class="fa-solid fa-rotate-right" inert></i></button>
                    <button type="button" class="persona-mini persona-mini--icon bonds-danger" data-action="sectorDelete" title="${esc(this.t("DeleteSector"))}" aria-label="${esc(this.t("DeleteSector"))}"><i class="fa-solid fa-trash" inert></i></button>` : ""}
                <span class="bonds-form__spacer"></span>
                <button type="button" class="persona-mini" data-action="popClose">${esc(this.t("Cancel"))}</button>
                <button type="submit" class="persona-button">${esc(sector ? this.t("Save") : this.t("Create"))}</button>
            </div>
        </form>`;
        this.#openPop(html, anchor);
    }

    #linkPop(linkId, anchor, fresh = null) {
        const link = linkId ? this.#bonds.links.find(l => l.id === linkId) : null;
        const a = link?.a ?? fresh?.a, b = link?.b ?? fresh?.b;
        if (!a || !b) return;
        const name = id => {
            if (id === SELF) return this.#model.self.name;
            const party = this.#model.party.find(p => p.id === id);
            if (party) return party.name;
            return this.#model.entries.find(e => e.id === id)?.name ?? "???";
        };
        const html = `
        <div class="bonds-form" data-link-form data-link="${esc(link?.id ?? "")}" data-a="${esc(a)}" data-b="${esc(b)}">
            <span class="persona-eyebrow">${esc(name(a))} <i class="fa-solid fa-arrow-right-long" inert></i> ${esc(name(b))}</span>
            <div class="bonds-types">${LINK_TYPES.map(t => `
                <button type="button" class="bonds-type ${link?.type === t.id ? "is-on" : ""}" data-action="linkType" data-type="${t.id}" style="--c:${t.color}">
                    <i class="${t.icon}" inert></i><span>${esc(this.t(`Type.${t.id}`))}</span>
                </button>`).join("")}</div>
            ${link ? `<div class="bonds-form__row">
                ${LINK_TYPES.find(t => t.id === link.type)?.directed ? `<button type="button" class="persona-mini" data-action="linkFlip"><i class="fa-solid fa-right-left" inert></i><span>${esc(this.t("Flip"))}</span></button>` : ""}
                <span class="bonds-form__spacer"></span>
                <button type="button" class="persona-mini bonds-danger" data-action="linkDelete"><i class="fa-solid fa-trash" inert></i><span>${esc(this.t("DeleteLink"))}</span></button>
            </div>` : ""}
        </div>`;
        this.#openPop(html, anchor ?? fresh.at);
    }

    #onSubmit = event => {
        const form = event.target.closest("[data-sector-form]");
        if (!form) return;
        event.preventDefault();
        const label = form.querySelector('[name="label"]').value.trim();
        const color = form.querySelector('[name="color"]').value;
        if (!label) return form.querySelector('[name="label"]').focus();
        const id = form.dataset.sector;
        this.#closePop();
        if (id) this.#commit(updateSector(this.#bonds, id, { label, color }));
        else this.#commit(addSector(this.#bonds, { label, color }).bonds);
    };

    /* -------------------------------------------- */

    /** Shows the change at once, then saves it. */
    #commit(bonds) {
        if (!this.#model.editable) return;
        this.#bonds = normalizeBonds(bonds);
        this.#model = { ...this.#model, bonds: this.#bonds };
        this.#render();
        Promise.resolve(this.adapter.saveBonds(this.#bonds)).catch(error => {
            console.error("persona | saving bonds failed", error);
            this.refresh();
        });
    }
}
