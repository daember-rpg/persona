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
 *   entries: [{ id, name, title, img, frame, status, isNew, tag }], bonds,
 *   tags: [{ key, label, color }] (Persona folders, in the GM's order — the default slices),
 *   players: [{ id, name }], moments: [{ id, label, ts }], momentId,
 *   official: [{ id, a, b, type, note, hidden }] (GM links this viewer may see),
 *   changes: { newIds, statusIds, linkIds } | null (since the player last looked),
 *   inScene: [entryId] | null (people with a token on the current scene)
 * }
 */
import {
    GEOMETRY, LINK_TYPES, SECTOR_COLORS, RINGS, SELF,
    normalizeBonds, layout, hitTest, wedgePath, arcPath, linkPath, polar,
    createSector, updateSector, removeSector, place, unplace, setLink, removeLink, placeAll, NO_TAG,
    setOfficial, removeOfficial
} from "./model.js";

const G = GEOMETRY;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NODE_R = { self: 58, party: 38, entry: 31 };
const DRAG_THRESHOLD = 5;

export class BondsView {
    /** Pan and zoom of the stage; `auto` refits when the window is resized. */
    #cam = { s: 1, x: 0, y: 0, auto: true };
    #model = null;
    #bonds = null;
    #laid = null;
    #visible = new Set();
    #tagOf = new Map();
    #linkMode = false;
    /** The portrait shown in the inspector and in focus on the wheel. */
    #selected = null;
    #query = "";
    #hideDead = false;
    #sceneOnly = false;
    /** What this view saw last time, to animate what changes live (a reveal, a death). */
    #lastSeen = null;
    #moments = { arriving: new Set(), dying: new Set(), vanishing: new Set() };
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
        host.addEventListener("dblclick", this.#onDoubleClick);
        host.addEventListener("pointerover", this.#onOver);
        host.addEventListener("pointerout", this.#onOut);
        host.addEventListener("input", this.#onInput);
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
        this.host.removeEventListener("dblclick", this.#onDoubleClick);
        this.host.removeEventListener("pointerover", this.#onOver);
        this.host.removeEventListener("pointerout", this.#onOut);
        this.host.removeEventListener("input", this.#onInput);
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
        const previous = this.#model?.owner?.id;
        this.#model = this.adapter.getModel();
        this.#bonds = normalizeBonds(this.#model.bonds);
        // Another player's wheel (GM): a half-drawn link belongs to the old one.
        if (previous !== undefined && previous !== this.#model.owner?.id) this.#linkFrom = null;
        if (previous !== undefined && previous !== this.#model.owner?.id) this.#selected = null;
        if (!this.#model.editable) this.#linkMode = false;
        this.#diffLive();
        this.#render();
    }

    /**
     * Live moments while the window is open: someone just revealed to this player arrives with a
     * glow; someone who just died fades to grey on every open wheel. Only between two refreshes of
     * the same wheel in the present — never on first open, a player switch or a past moment.
     */
    #diffLive() {
        const m = this.#model;
        const now = { owner: m.owner?.id, past: !!m.momentId, status: new Map(m.entries.map(e => [e.id, e.status])) };
        const before = this.#lastSeen;
        this.#lastSeen = now;
        this.#moments = { arriving: new Set(), dying: new Set(), vanishing: new Set() };
        if (!before || before.owner !== now.owner || before.past || now.past) return;
        for (const [id, status] of now.status) {
            if (!before.status.has(id)) this.#moments.arriving.add(id);
            else if (before.status.get(id) !== status && status === "dead") this.#moments.dying.add(id);
            else if (before.status.get(id) !== status && status === "missing") this.#moments.vanishing.add(id);
        }
        const any = this.#moments.arriving.size || this.#moments.dying.size || this.#moments.vanishing.size;
        if (any) clearTimeout(this.#momentTimer), this.#momentTimer = setTimeout(() => {
            this.#moments = { arriving: new Set(), dying: new Set(), vanishing: new Set() };
            this.host.querySelectorAll(".is-arriving, .is-dying, .is-vanishing").forEach(el => el.classList.remove("is-arriving", "is-dying", "is-vanishing"));
        }, 4000);
    }

    #momentTimer = null;

    #liveClass(id) {
        return this.#moments.arriving.has(id) ? "is-arriving" : this.#moments.dying.has(id) ? "is-dying" : this.#moments.vanishing.has(id) ? "is-vanishing" : "";
    }

    #entryMap() {
        return new Map(this.#model.entries.map(e => [e.id, e]));
    }

    #render() {
        const m = this.#model;
        const entries = this.#entryMap();
        // "Hide the dead" only thins the wheel; they stay in the inspector and the timeline.
        const scene = new Set(m.inScene ?? []);
        if (this.#sceneOnly && !scene.size) this.#sceneOnly = false;
        this.#visible = new Set([...entries.keys()].filter(id => {
            if (id === this.#selected) return true;
            if (this.#hideDead && entries.get(id).status === "dead") return false;
            if (this.#sceneOnly && !scene.has(id)) return false;
            return true;
        }));
        this.#tagOf = new Map(m.entries.map(e => [e.id, e.tag ?? NO_TAG]));
        this.#laid = layout(this.#bonds, this.#visible, m.party.map(p => p.id), { list: m.tags ?? [], tagOf: this.#tagOf, noneLabel: this.t("NoFolder") });
        const placed = new Set(this.#bonds.placements.map(p => p.id));
        const loose = m.entries.filter(e => !placed.has(e.id));
        if (this.#selected && !this.#nodeInfo(this.#selected)) this.#selected = null;
        const pop = this.host.querySelector(".bonds-pop");
        const keepPop = pop && !pop.hidden ? pop.outerHTML : null;

        this.host.innerHTML = `
        <div class="bonds ${m.editable ? "is-editable" : "is-readonly"} ${this.#linkMode ? "is-linking" : ""} ${m.momentId ? "is-past" : ""} ${this.#bonds.links.length > 14 ? "is-dense" : ""}" tabindex="-1">
            ${this.#renderBar()}
            <div class="bonds-main">
                <div class="bonds-viewport" data-viewport>
                    <div class="bonds-stage" data-stage>
                        ${this.#renderSvg()}
                        <div class="bonds-layer">${this.#renderNodes(entries)}${this.#renderLinkMarkers()}</div>
                    </div>
                    ${this.#renderBanner() || this.#renderChanges(entries)}
                    ${this.#renderFinder(entries)}
                    ${this.#renderLegend()}
                    <div class="bonds-zoom">
                        <button type="button" class="persona-icon-btn" data-action="zoomIn" aria-label="${esc(this.t("ZoomIn"))}" title="${esc(this.t("ZoomIn"))}"><i class="fa-solid fa-plus" inert></i></button>
                        <button type="button" class="persona-icon-btn" data-action="zoomOut" aria-label="${esc(this.t("ZoomOut"))}" title="${esc(this.t("ZoomOut"))}"><i class="fa-solid fa-minus" inert></i></button>
                        <button type="button" class="persona-icon-btn" data-action="fit" aria-label="${esc(this.t("Fit"))}" title="${esc(this.t("Fit"))}"><i class="fa-solid fa-expand" inert></i></button>
                    </div>
                </div>
                ${this.#selected ? this.#renderInspector(loose) : this.#renderDrawer(loose)}
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
        this.#applyFocus(this.#selected);
        this.#filterLoose();
    }

    #renderBar() {
        const m = this.#model;
        const moment = m.momentId ? m.moments.find(x => x.id === m.momentId) : null;
        const players = m.isGM && m.players.length
            ? `<nav class="bonds-players" aria-label="${esc(this.t("Players"))}">${m.players.map(p => `
                <button type="button" class="bonds-player ${p.id === m.owner.id ? "is-active" : ""}" data-action="player" data-id="${esc(p.id)}" aria-pressed="${p.id === m.owner.id}" title="${esc(p.name)}${p.user ? ` (${esc(p.user)})` : ""}">
                    <span class="bonds-player__img"><img src="${esc(p.img)}" alt="" draggable="false"></span>
                    <span class="bonds-player__name">${esc(p.name)}</span>
                </button>`).join("")}</nav>`
            : "";
        const sub = moment ? this.adapter.t("PERSONA.Bonds.SubPast").replace("{label}", moment.label)
            : m.isGM && m.editable ? this.adapter.t("PERSONA.Bonds.SubGM").replace("{name}", m.owner.name)
            : m.editable ? this.t("SubPlayer") : "";
        const tools = m.isGM && m.players.length
            ? `<button type="button" class="persona-button bonds-tool bonds-tool--accent" data-action="recordMoment" title="${esc(this.t("RecordHint"))}"><i class="fa-solid fa-camera-retro" inert></i><span>${esc(this.t("Record"))}</span></button>`
            : "";
        return `
        <header class="bonds-bar">
            <div class="bonds-who">
                <span class="bonds-who__img"><img src="${esc(m.self.img)}" alt="" draggable="false"></span>
                <div class="bonds-who__text">
                    <h2>${esc(m.owner?.name ? this.adapter.t("PERSONA.Bonds.TitleOf").replace("{name}", m.owner.name) : this.t("Title"))}</h2>
                    ${sub ? `<p>${esc(sub)}</p>` : ""}
                </div>
            </div>
            ${players}
            <div class="bonds-bar__tools">${tools}</div>
        </header>`;
    }

    #renderSvg() {
        const m = this.#model;
        const laid = this.#laid;
        const C = G.center;
        const g = laid.g;
        const outer = g.ringBands[2][1];
        const inner = g.ringBands[0][0];
        const parts = [];

        // Gradients per slice colour, brightest near the party, fading outward.
        const defs = [`<radialGradient id="bonds-bg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3a2a22"/><stop offset="0.55" stop-color="#211d19"/><stop offset="1" stop-color="#14120f" stop-opacity="0"/></radialGradient>`];
        const colors = [...new Set(laid.sectors.map(s => s.color))];
        colors.forEach((color, i) => defs.push(`<radialGradient id="bonds-g${i}" gradientUnits="userSpaceOnUse" cx="${C}" cy="${C}" r="${outer}"><stop offset="${(inner / outer).toFixed(3)}" stop-color="${color}" stop-opacity="0.42"/><stop offset="0.7" stop-color="${color}" stop-opacity="0.16"/><stop offset="1" stop-color="${color}" stop-opacity="0.05"/></radialGradient>`));
        defs.push(`<pattern id="bonds-etch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 7h14M7 0v14" stroke="rgba(214,138,92,0.14)" stroke-width="1"/></pattern>`);
        for (const type of LINK_TYPES.filter(t => t.directed)) {
            defs.push(`<marker id="bonds-arrow-${type.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${type.color}"/></marker>`);
        }
        const gradient = color => `url(#bonds-g${colors.indexOf(color)})`;

        parts.push(`<circle cx="${C}" cy="${C}" r="${g.labelRadius + 16}" fill="url(#bonds-bg)"/>`);
        // Fine radial grid, like an astrolabe.
        const spokes = [];
        for (let a = 0; a < 360; a += 6) {
            const p = polar(inner, a * Math.PI / 180), q = polar(outer, a * Math.PI / 180);
            spokes.push(`M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
        }
        parts.push(`<path class="bonds-grid" d="${spokes.join("")}"/>`);
        for (const r of [inner, g.ringBands[0][1], g.ringBands[1][1], outer]) parts.push(`<circle class="bonds-ring" cx="${C}" cy="${C}" r="${r}"/>`);

        // Slices: a wedge per ring (drop targets), divider arcs, the label along the rim.
        for (const s of laid.sectors) {
            parts.push(`<path class="bonds-sector" d="${wedgePath(inner, outer, s.start, s.end)}" fill="${gradient(s.color)}" stroke="${s.color}"/>`);
            for (const ring of RINGS) {
                const [r1, r2] = g.ringBands[ring - 1];
                parts.push(`<path class="bonds-cell" data-cell="${esc(s.id)}|${ring}" d="${wedgePath(r1, r2, s.start, s.end)}"/>`);
            }
            for (const r of [g.ringBands[0][1], g.ringBands[1][1]]) {
                parts.push(`<path class="bonds-divider" d="${arcPath(r, s.start, s.end).d}" stroke="${s.color}"/>`);
            }
            const arc = arcPath(g.labelRadius, s.start, s.end);
            // Narrow slices (a campaign with many folders) shorten their label to fit the arc.
            const fits = Math.max(3, Math.floor(((s.end - s.start) * g.labelRadius) / 15));
            const full = s.label || this.t("Unnamed");
            const label = full.length > fits ? `${full.slice(0, Math.max(2, fits - 1)).trimEnd()}…` : full;
            parts.push(`<path id="bonds-arc-${esc(s.id)}" d="${arc.d}" fill="none"/>`);
            parts.push(`<text class="bonds-sector-label" ${m.editable && s.custom ? `data-action="editSector" data-id="${esc(s.id)}"` : ""} fill="${s.color}" dy="${arc.bottom ? 12 : 0}"><textPath href="#bonds-arc-${esc(s.id)}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
        }
        if (!laid.sectors.length) {
            parts.push(`<circle class="bonds-empty-ring" cx="${C}" cy="${C}" r="${(inner + outer) / 2}"/>`);
            parts.push(`<text class="bonds-empty-text" x="${C}" y="${C - (inner + outer) / 2 - 12}" text-anchor="middle">${esc(m.editable ? this.t("EmptyWheel") : this.t("EmptyWheelReadOnly"))}</text>`);
        }

        // The party ring and the centre.
        parts.push(`<circle class="bonds-party-band" cx="${C}" cy="${C}" r="${(G.partyBand[0] + G.partyBand[1]) / 2}" stroke-width="${G.partyBand[1] - G.partyBand[0]}"/>`);
        parts.push(`<circle class="bonds-ring bonds-ring--party" cx="${C}" cy="${C}" r="${G.partyBand[1]}"/>`);
        parts.push(`<circle class="bonds-ring bonds-ring--self" cx="${C}" cy="${C}" r="${G.partyBand[0]}"/>`);
        // The party needs no caption: an engraved band, and a gold thread the companions sit on.
        parts.push(`<circle class="bonds-party-etch" cx="${C}" cy="${C}" r="${(G.partyBand[0] + G.partyBand[1]) / 2}" stroke-width="${G.partyBand[1] - G.partyBand[0] - 6}" fill="none" stroke="url(#bonds-etch)"/>`);
        if (m.party.length) parts.push(`<circle class="bonds-party-thread" cx="${C}" cy="${C}" r="${G.partyRadius}"/>`);

        // Links between portraits.
        const links = [];
        for (const link of this.#allLinks()) {
            const geo = this.#linkGeometry(link);
            if (!geo) continue;
            const type = LINK_TYPES.find(t => t.id === link.type) ?? LINK_TYPES[0];
            const cls = `${link.suspect ? "is-suspect" : ""} ${link.official ? "is-official" : ""} ${link.hidden ? "is-hidden" : ""}`;
            // Official links: a dark casing under the line, like an inked seal.
            if (link.official) links.push(`<path class="bonds-link-casing ${cls}" data-a="${esc(link.a)}" data-b="${esc(link.b)}" d="${geo.d}"/>`);
            links.push(`<path class="bonds-link bonds-link--${type.id} ${cls}" data-a="${esc(link.a)}" data-b="${esc(link.b)}" d="${geo.d}" stroke="${type.color}" ${type.directed ? `marker-end="url(#bonds-arrow-${type.id})"` : ""}/>`);
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
        const changed = new Set([...(m.changes?.newIds ?? []), ...(m.changes?.statusIds ?? [])]);
        const picked = id => [this.#linkFrom === id ? "is-picked" : "", this.#selected === id ? "is-selected" : "", changed.has(id) ? "is-changed" : ""].join(" ");

        out.push(`<button type="button" class="bonds-node bonds-node--self ${picked(SELF)}" data-node="${SELF}" style="left:${G.center}px;top:${G.center}px">
            <span class="bonds-node__img"><img src="${esc(m.self.img)}" alt="" draggable="false"></span><span class="bonds-node__name">${esc(m.self.name)}</span></button>`);
        for (const p of m.party) {
            const pos = laid.nodes.get(p.id);
            out.push(`<button type="button" class="bonds-node bonds-node--party ${pos.y < G.center - 1 ? "is-upper" : ""} ${picked(p.id)}" data-node="${esc(p.id)}" style="left:${pos.x}px;top:${pos.y}px">
                <span class="bonds-node__img"><img src="${esc(p.img)}" alt="" draggable="false"></span><span class="bonds-node__name">${esc(p.name)}</span></button>`);
        }
        for (const placement of this.#bonds.placements) {
            const entry = entries.get(placement.id);
            const pos = laid.nodes.get(placement.id);
            if (!entry || !pos) continue;
            const color = sectors.get(placement.sector)?.color ?? SECTOR_COLORS[0];
            out.push(this.#entryNode(entry, `left:${pos.x}px;top:${pos.y}px;--c:${color}`, `${picked(entry.id)} ${this.#liveClass(entry.id)}`));
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
            <span class="bonds-node__img"><img class="persona-fit" src="${esc(entry.img)}" style="${esc(entry.frame ?? "")}" alt="" draggable="false"></span>${mark}
            <span class="bonds-node__name">${esc(name)}${entry.title ? `<small>${esc(entry.title)}</small>` : ""}${statusText ? `<small class="bonds-node__status">${esc(statusText)}</small>` : ""}</span></button>`;
    }

    #renderLinkMarkers() {
        return this.#allLinks().map(link => {
            const geo = this.#linkGeometry(link);
            if (!geo) return "";
            const type = LINK_TYPES.find(t => t.id === link.type) ?? LINK_TYPES[0];
            const label = [this.t(`Type.${type.id}`), link.suspect ? this.t("Suspected") : "", link.official ? this.t("Official") : "", link.note].filter(Boolean).join(" — ");
            const badge = link.suspect ? `<span class="bonds-marker__badge">?</span>` : link.official ? `<span class="bonds-marker__badge is-seal"><i class="fa-solid fa-stamp" inert></i></span>` : "";
            return `<button type="button" class="bonds-marker ${link.suspect ? "is-suspect" : ""} ${link.official ? "is-official" : ""} ${link.hidden ? "is-hidden" : ""}" ${this.#canEditLink(link) ? `data-action="editLink"` : ""} data-id="${esc(link.id)}" data-a="${esc(link.a)}" data-b="${esc(link.b)}" style="left:${geo.mid.x}px;top:${geo.mid.y}px;--c:${type.color}" title="${esc(label)}" aria-label="${esc(label)}"><i class="${type.icon}" inert></i>${badge}</button>`;
        }).join("");
    }

    /** The player's links plus the GM's official ones this viewer may see. */
    #allLinks() {
        return [...this.#bonds.links, ...(this.#model.official ?? []).map(l => ({ ...l, official: true, suspect: false }))];
    }

    #canEditLink(link) {
        const m = this.#model;
        if (m.momentId) return false;
        return link.official ? m.isGM : m.editable;
    }

    /** "Since you last looked": new people, deaths and disappearances, new official links. */
    #renderChanges(entries) {
        const c = this.#model.changes;
        if (!c) return "";
        const people = [...new Set([...c.newIds, ...c.statusIds])].map(id => entries.get(id)).filter(Boolean);
        const parts = [];
        if (c.newIds.length) parts.push(this.adapter.t(c.newIds.length === 1 ? "PERSONA.Bonds.ChangeNew1" : "PERSONA.Bonds.ChangeNew").replace("{n}", c.newIds.length));
        const deaths = c.statusIds.filter(id => entries.get(id)?.status === "dead").length;
        const other = c.statusIds.length - deaths;
        if (deaths) parts.push(this.adapter.t(deaths === 1 ? "PERSONA.Bonds.ChangeDead1" : "PERSONA.Bonds.ChangeDead").replace("{n}", deaths));
        if (other) parts.push(this.adapter.t(other === 1 ? "PERSONA.Bonds.ChangeStatus1" : "PERSONA.Bonds.ChangeStatus").replace("{n}", other));
        if (c.linkIds.length) parts.push(this.adapter.t(c.linkIds.length === 1 ? "PERSONA.Bonds.ChangeLinks1" : "PERSONA.Bonds.ChangeLinks").replace("{n}", c.linkIds.length));
        if (!parts.length) return "";
        return `<div class="bonds-changes">
            <div class="bonds-changes__text"><b>${esc(this.t("SinceLast"))}</b><span>${esc(parts.join(", "))}</span></div>
            ${people.length ? `<div class="bonds-changes__faces">${people.slice(0, 6).map(e => `
                <button type="button" class="bonds-changes__face ${e.status && e.status !== "alive" ? `is-${e.status}` : ""}" data-action="select" data-id="${esc(e.id)}" title="${esc(e.name ?? "???")}"><img class="persona-fit" src="${esc(e.img)}" style="${esc(e.frame ?? "")}" alt=""></button>`).join("")}${people.length > 6 ? `<span class="bonds-changes__more">+${people.length - 6}</span>` : ""}</div>` : ""}
            <button type="button" class="persona-mini" data-action="ackChanges">${esc(this.t("GotIt"))}</button>
        </div>`;
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
            const from = this.#nodeInfo(this.#linkFrom)?.name ?? "";
            return `<div class="bonds-banner bonds-banner--link"><i class="fa-solid fa-link" inert></i><span>${esc(this.adapter.t("PERSONA.Bonds.LinkPickTarget").replace("{name}", from))}</span>
                <button type="button" class="persona-mini" data-action="cancelLink">${esc(this.t("Cancel"))}</button></div>`;
        }
        return "";
    }

    /** Find someone on a big wheel, and thin it out by hiding the dead. */
    #renderFinder(entries) {
        const placed = this.#bonds.placements.filter(p => entries.has(p.id));
        const scene = (this.#model.inScene ?? []).filter(id => entries.has(id));
        if (placed.length < 8 && !scene.length) return "";
        const dead = placed.length >= 8 ? placed.filter(p => entries.get(p.id).status === "dead").length : 0;
        return `<div class="bonds-finder">
            ${scene.length ? `<button type="button" class="persona-mini bonds-scene ${this.#sceneOnly ? "is-on" : ""}" data-action="toggleScene" aria-pressed="${this.#sceneOnly}" title="${esc(this.t("InSceneHint"))}"><i class="fa-solid fa-map-location-dot" inert></i><span>${esc(this.adapter.t("PERSONA.Bonds.InScene").replace("{n}", scene.length))}</span></button>` : ""}
            ${placed.length >= 8 ? `<label class="bonds-search bonds-search--wheel"><i class="fa-solid fa-magnifying-glass" inert></i>
                <input type="search" name="bondsFind" placeholder="${esc(this.t("FindOnWheel"))}" autocomplete="off"></label>
            <div class="bonds-finder__results" data-find-results hidden></div>` : ""}
            ${dead ? `<button type="button" class="persona-mini ${this.#hideDead ? "is-on" : ""}" data-action="toggleDead" aria-pressed="${this.#hideDead}"><i class="fa-solid ${this.#hideDead ? "fa-eye" : "fa-skull"}" inert></i><span>${esc(this.#hideDead ? this.adapter.t("PERSONA.Bonds.ShowDead").replace("{n}", dead) : this.adapter.t("PERSONA.Bonds.HideDead").replace("{n}", dead))}</span></button>` : ""}
        </div>`;
    }

    #onFind(value) {
        const box = this.host.querySelector("[data-find-results]");
        if (!box) return;
        const q = value.trim().toLowerCase();
        const placed = new Set(this.#bonds.placements.map(p => p.id));
        const hits = q ? this.#model.entries.filter(e => placed.has(e.id) && (e.name ?? "").toLowerCase().includes(q)).slice(0, 8) : [];
        box.hidden = !hits.length;
        box.innerHTML = hits.map(e => `<button type="button" data-action="findGo" data-id="${esc(e.id)}"><img src="${esc(e.img)}" alt=""><span>${esc(e.name)}</span></button>`).join("");
    }

    /** Moves the camera so a portrait sits in the middle of the view. */
    #centerOn(id) {
        const node = this.#laid?.nodes.get(id);
        const viewport = this.host.querySelector("[data-viewport]");
        if (!node || !viewport) return;
        const { width, height } = viewport.getBoundingClientRect();
        const s = Math.max(this.#cam.s, Math.min(width, height) / 700);
        this.#cam = { s, x: width / 2 - node.x * s, y: height / 2 - node.y * s, auto: false };
        this.#applyCam();
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
            const scene = new Set(m.inScene ?? []);
            loose = [...loose].sort((a, b) => scene.has(b.id) - scene.has(a.id));
            body = `<div class="bonds-drawer__list">${loose.map(e => `
                <div class="bonds-loose ${e.status && e.status !== "alive" ? `is-${e.status}` : ""} ${e.isNew ? "is-new" : ""} ${this.#liveClass(e.id)}" data-loose="${esc(e.id)}" data-entry="${esc(e.id)}" role="button" tabindex="0">
                    <span class="bonds-loose__img"><img class="persona-fit" src="${esc(e.img)}" style="${esc(e.frame ?? "")}" alt="" draggable="false"></span>
                    <span class="bonds-loose__name">${esc(e.name ?? "???")}${e.title ? `<small>${esc(e.title)}</small>` : ""}</span>
                    ${scene.has(e.id) ? `<span class="bonds-loose__scene" title="${esc(this.t("InSceneHint"))}"><i class="fa-solid fa-map-location-dot" inert></i></span>` : ""}
                </div>`).join("")}</div>`;
        }
        const start = m.editable && loose.length > 1
            ? `<button type="button" class="persona-button bonds-drawer__start" data-action="placeAll"><i class="fa-solid fa-wand-magic-sparkles" inert></i><span>${esc(this.t("PlaceAll"))}</span></button>`
            : "";
        const hint = m.editable && loose.length ? `<p class="bonds-drawer__tip">${esc(this.t("DragHint"))}</p>` : "";
        const search = loose.length > 6
            ? `<label class="bonds-search"><i class="fa-solid fa-magnifying-glass" inert></i><input type="search" name="bondsQuery" value="${esc(this.#query)}" placeholder="${esc(this.t("Search"))}" autocomplete="off"></label>` : "";
        // Shown while dragging a portrait: drop here to start a category of your own.
        const newCat = m.editable
            ? `<div class="bonds-newcat" data-new-sector><i class="fa-solid fa-folder-plus" inert></i><span>${esc(this.t("NewCategoryDrop"))}</span></div>`
            : "";
        const out = m.editable
            ? `<div class="bonds-takeoff"><i class="fa-solid fa-arrow-right-from-bracket" inert></i><span>${esc(this.t("TakeOffDrop"))}</span></div>`
            : "";
        return `<aside class="bonds-drawer" data-drawer>
            ${newCat}${out}
            <div class="bonds-drawer__head"><span class="persona-eyebrow">${esc(this.t("Unplaced"))}</span><span class="bonds-drawer__count">${loose.length}</span></div>
            ${search}${body}${start}${hint}
        </aside>`;
    }

    /** Name, portrait and kind of any node on the wheel (or a person not on it yet). */
    #nodeInfo(id) {
        if (!id) return null;
        const m = this.#model;
        if (id === SELF) return { id, kind: "self", name: m.self.name, img: m.self.img };
        const party = m.party.find(p => p.id === id);
        if (party) return { id, kind: "party", name: party.name, img: party.img };
        const entry = m.entries.find(e => e.id === id);
        return entry ? { id, kind: "entry", name: entry.name ?? "???", img: entry.img, entry } : null;
    }

    /** Everyone linked to `id`, and the links themselves. */
    #linksOf(id) {
        return this.#allLinks().filter(l => l.a === id || l.b === id);
    }

    #renderInspector(loose) {
        const m = this.#model;
        const info = this.#nodeInfo(this.#selected);
        const placement = this.#bonds.placements.find(p => p.id === info.id);
        const entry = info.entry;
        const editable = m.editable;

        // Where they sit: their category, else their folder.
        let place = "";
        if (info.kind === "self") place = this.t("You");
        else if (info.kind === "party") place = this.t("Party");
        else if (placement?.sector) place = this.#bonds.sectors.find(s => s.id === placement.sector)?.label ?? "";
        else place = (m.tags ?? []).find(t => t.key === entry?.tag)?.label ?? this.t("NoFolder");
        const status = entry?.status && entry.status !== "alive"
            ? `<span class="bonds-tag is-${entry.status}"><i class="${entry.status === "dead" ? "fa-solid fa-skull" : "fa-solid fa-question"}" inert></i>${esc(this.adapter.t(`PERSONA.Status.${entry.status}`))}</span>` : "";

        // Distance: one click instead of a drag. For someone off the wheel, it puts them on it.
        let distance = "";
        if (info.kind === "entry" && editable) {
            const ring = placement?.ring ?? 0;
            distance = `<div class="bonds-insp__block">
                <span class="bonds-insp__label">${esc(placement ? this.t("Distance") : this.t("PutOnWheel"))}</span>
                <div class="bonds-seg" role="group">${RINGS.map(r => `<button type="button" class="${ring === r ? "is-on" : ""}" data-action="setRing" data-ring="${r}" aria-pressed="${ring === r}">${esc(this.t(`Ring${r}`))}</button>`).join("")}</div>
            </div>`;
        } else if (info.kind === "entry" && placement) {
            distance = `<div class="bonds-insp__block"><span class="bonds-insp__label">${esc(this.t("Distance"))}</span><p class="bonds-insp__value">${esc(this.t(`Ring${placement.ring}`))}</p></div>`;
        }

        const links = this.#linksOf(info.id);
        const rows = links.map(l => {
            const other = this.#nodeInfo(l.a === info.id ? l.b : l.a);
            if (!other) return "";
            const type = LINK_TYPES.find(t => t.id === l.type) ?? LINK_TYPES[0];
            const outgoing = l.a === info.id;
            const label = type.directed ? this.t(`TypeDir.${type.id}.${outgoing ? "out" : "in"}`) : this.t(`Type.${type.id}`);
            const flags = [
                l.suspect ? `<span class="bonds-flag">${esc(this.t("Suspected"))}</span>` : "",
                l.official ? `<span class="bonds-flag is-official"><i class="fa-solid fa-stamp" inert></i>${esc(this.t("Official"))}</span>` : "",
                l.hidden ? `<span class="bonds-flag"><i class="fa-solid fa-eye-slash" inert></i>${esc(this.t("HiddenShort"))}</span>` : ""
            ].join("");
            return `<li class="bonds-bond ${l.suspect ? "is-suspect" : ""}" style="--c:${type.color}">
                <button type="button" class="bonds-bond__who" data-action="select" data-id="${esc(other.id)}">
                    <span class="bonds-bond__img"><img src="${esc(other.img)}" alt="" draggable="false"></span>
                    <span class="bonds-bond__text"><b>${esc(other.name)}</b><small><i class="${type.icon}" inert></i>${esc(label)}${flags}</small>${l.note ? `<em>${esc(l.note)}</em>` : ""}</span>
                </button>
                ${this.#canEditLink(l) ? `<button type="button" class="bonds-bond__edit" data-action="editLink" data-id="${esc(l.id)}" title="${esc(this.t("EditLink"))}" aria-label="${esc(this.t("EditLink"))}"><i class="fa-solid fa-pen" inert></i></button>` : ""}
            </li>`;
        }).join("");

        const actions = [];
        if (editable && (placement || info.kind !== "entry")) actions.push(`<button type="button" class="persona-button" data-action="startLink"><i class="fa-solid fa-link" inert></i><span>${esc(this.t("LinkTo"))}</span></button>`);
        if (entry) actions.push(`<button type="button" class="persona-button bonds-ghost-btn" data-action="openCard" data-id="${esc(entry.id)}"><i class="fa-solid fa-id-card" inert></i><span>${esc(this.t("OpenCard"))}</span></button>`);

        return `<aside class="bonds-drawer bonds-inspector" data-drawer>
            <button type="button" class="bonds-back" data-action="deselect"><i class="fa-solid fa-chevron-left" inert></i><span>${esc(loose.length ? this.adapter.t("PERSONA.Bonds.BackToList").replace("{n}", loose.length) : this.t("Close"))}</span></button>
            <div class="bonds-insp__head ${entry?.status && entry.status !== "alive" ? `is-${entry.status}` : ""}">
                <span class="bonds-insp__portrait ${info.kind}"><img class="persona-fit" src="${esc(info.img)}" style="${esc(entry?.frame ?? "")}" alt="" draggable="false"></span>
                <h3>${esc(info.name)}</h3>
                ${entry?.title ? `<p class="bonds-insp__title">${esc(entry.title)}</p>` : ""}
                <div class="bonds-insp__tags"><span class="bonds-tag">${esc(place)}</span>${status}</div>
            </div>
            ${distance}
            <div class="bonds-insp__block">
                <span class="bonds-insp__label">${esc(this.t("Bonds"))}${links.length ? ` <b>${links.length}</b>` : ""}</span>
                ${rows ? `<ul class="bonds-bonds">${rows}</ul>` : `<p class="bonds-insp__empty">${esc(editable && (placement || info.kind !== "entry") ? this.t("NoBondsYet") : this.t("NoBonds"))}</p>`}
            </div>
            <div class="bonds-insp__actions">${actions.join("")}</div>
            ${editable && placement ? `<button type="button" class="bonds-takeoff-btn" data-action="takeOff"><i class="fa-solid fa-arrow-right-from-bracket" inert></i><span>${esc(this.t("TakeOff"))}</span></button>` : ""}
            <div class="bonds-newcat" data-new-sector><i class="fa-solid fa-folder-plus" inert></i><span>${esc(this.t("NewCategoryDrop"))}</span></div>
        </aside>`;
    }

    /** Lights up a person and everyone linked to them; dims the rest. */
    #applyFocus(id) {
        const root = this.host.querySelector(".bonds");
        if (!root) return;
        root.classList.toggle("has-focus", !!id);
        const near = new Set(id ? [id] : []);
        if (id) for (const l of this.#linksOf(id)) { near.add(l.a); near.add(l.b); }
        root.querySelectorAll("[data-node]").forEach(el => el.classList.toggle("is-near", near.has(el.dataset.node)));
        root.querySelectorAll(".bonds-link, .bonds-marker").forEach(el => el.classList.toggle("is-near", !!id && (el.dataset.a === id || el.dataset.b === id)));
    }

    #onOver = event => {
        if (this.#gesture?.dragging || this.#linkMode) return;
        const node = event.target.closest?.("[data-node]");
        if (node) this.#applyFocus(node.dataset.node);
    };

    #onOut = event => {
        if (this.#gesture?.dragging || this.#linkMode) return;
        const node = event.target.closest?.("[data-node]");
        if (node && !node.contains(event.relatedTarget)) this.#applyFocus(this.#selected);
    };

    #onInput = event => {
        if (event.target.name === "bondsFind") return this.#onFind(event.target.value);
        if (event.target.name !== "bondsQuery") return;
        this.#query = event.target.value;
        this.#filterLoose();
    };

    /** Filters the off-wheel list in place (no redraw, so typing keeps focus). */
    #filterLoose() {
        const q = this.#query.trim().toLowerCase();
        this.host.querySelectorAll("[data-loose]").forEach(el => {
            el.hidden = !!q && !el.textContent.toLowerCase().includes(q);
        });
    }

    #select(id) {
        this.#selected = id;
        this.#render();
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
        // The wheel grows with the campaign: fit its real outer edge, labels included.
        const R = (this.#laid?.g?.labelRadius ?? G.labelRadius) + 34;
        // Keep a strip at the top for the finder and notices, so they never cover the top slice's name.
        const top = 52;
        const s = Math.min(width, height - top) / (2 * R);
        this.#cam = { s, x: width / 2 - G.center * s, y: top + (height - top) / 2 - G.center * s, auto: true };
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
        // Read the target while the drop zones are still shown.
        const target = this.#dropTarget(event, g.id);
        g.ghost?.remove();
        g.source.classList.remove("is-lifted");
        this.host.querySelector(".bonds")?.classList.remove("is-dragging");
        this.#highlight(null);
        this.#suppressClick = true;
        setTimeout(() => { this.#suppressClick = false; }, 0);
        if (target.kind === "cell") this.#commit(place(this.#bonds, g.id, target.category, target.ring, target.before));
        else if (target.kind === "out") this.#commit(unplace(this.#bonds, g.id));
        else if (target.kind === "new") this.#sectorPop(null, this.host.querySelector(".bonds-drawer__head"), g.id);
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

    /**
     * Over "new category" → create one; over the drawer → take off the wheel; over the wheel →
     * a ring and slice. Dropping on another folder's slice keeps the person in their own folder's
     * slice (folders are the GM's tags); a category of the player's own takes anyone.
     */
    #dropTarget(event, id) {
        const inside = el => {
            const r = el?.getBoundingClientRect();
            return r && r.width && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
        };
        const placed = this.#bonds.placements.some(p => p.id === id);
        if (inside(this.host.querySelector("[data-new-sector]"))) return { kind: "new" };
        if (inside(this.host.querySelector("[data-drawer]"))) return placed ? { kind: "out" } : { kind: "none" };
        if (!inside(this.host.querySelector("[data-viewport]"))) return { kind: "none" };
        const { x, y } = this.#toStage(event.clientX, event.clientY);
        const hit = hitTest(x, y, this.#laid, id);
        if (hit.kind === "out") return placed ? hit : { kind: "none" };
        if (hit.kind !== "cell") return hit;
        const custom = hit.sector && this.#bonds.sectors.some(s => s.id === hit.sector);
        const own = this.#tagOf.get(id) ?? NO_TAG;
        const dest = custom ? hit.sector : own;
        // `before` only counts inside the slice the person really lands in.
        return { ...hit, category: custom ? hit.sector : null, dest, before: dest === hit.sector ? hit.before : null };
    }

    #highlight(target) {
        this.host.querySelectorAll(".bonds-cell.is-target").forEach(el => el.classList.remove("is-target"));
        this.host.querySelector("[data-drawer]")?.classList.toggle("is-target", target?.kind === "out");
        this.host.querySelector("[data-new-sector]")?.classList.toggle("is-target", target?.kind === "new");
        if (target?.kind === "cell") {
            const cell = this.host.querySelector(`.bonds-cell[data-cell="${CSS.escape(`${target.dest}|${target.ring}`)}"]`)
                ?? this.host.querySelector(`.bonds-cell[data-cell="${CSS.escape(`${target.sector}|${target.ring}`)}"]`);
            cell?.classList.add("is-target");
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

        if (pop && !pop.hidden && !inPop && !actionEl?.matches('[data-action="editLink"], [data-action="editSector"]')) {
            this.#closePop();
            if (!node && !loose) return;
        }

        if (actionEl) {
            const handler = this.#actions[actionEl.dataset.action];
            if (handler) {
                event.preventDefault();
                return handler(actionEl, actionEl.dataset.id, event);
            }
        }
        if (node && this.#linkMode) return this.#pickForLink(node.dataset.node);
        if (node) return this.#select(node.dataset.node);
        if (loose) return this.#select(loose.dataset.entry);
        // A click on the empty wheel clears the selection.
        if (event.target.closest("[data-viewport]") && this.#selected && !this.#linkMode) return this.#select(null);
    };

    /** Double-click a person: their Persona card. */
    #onDoubleClick = event => {
        const el = event.target.closest("[data-entry]");
        if (el && !this.#linkMode) this.adapter.openCard(el.dataset.entry);
    };

    #onKey = event => {
        if (event.key !== "Escape") return;
        if (!this.host.querySelector(".bonds-pop")?.hidden) { event.stopPropagation(); return this.#closePop(); }
        if (this.#linkMode) { event.stopPropagation(); this.#linkMode = false; this.#linkFrom = null; return this.#render(); }
        if (this.#selected) { event.stopPropagation(); return this.#select(null); }
    };

    #actions = {
        player: (_el, id) => this.adapter.selectPlayer(id),
        moment: (_el, id) => this.adapter.selectMoment(id || null),
        deleteMoment: (_el, id) => this.adapter.deleteMoment(id),
        recordMoment: () => this.adapter.recordMoment(),
        zoomIn: () => this.#zoomAt(1.2),
        zoomOut: () => this.#zoomAt(1 / 1.2),
        fit: () => this.fit(),
        select: (_el, id) => this.#select(id),
        toggleDead: () => { this.#hideDead = !this.#hideDead; this.#render(); },
        toggleScene: () => { this.#sceneOnly = !this.#sceneOnly; this.#cam.auto = true; this.#render(); },
        ackChanges: () => this.adapter.ackChanges?.(),
        pickType: el => {
            const form = el.closest("[data-link-form]");
            form.querySelectorAll(".bonds-type").forEach(b => b.classList.toggle("is-on", b === el));
            form.querySelector('[name="type"]').value = el.dataset.type;
            form.querySelector('[type="submit"]').disabled = false;
        },
        findGo: (_el, id) => { this.#select(id); this.#centerOn(id); },
        deselect: () => this.#select(null),
        openCard: (_el, id) => this.adapter.openCard(id),
        startLink: () => {
            this.#linkMode = true;
            this.#linkFrom = this.#selected;
            this.#render();
        },
        cancelLink: () => {
            this.#linkMode = false;
            this.#linkFrom = null;
            this.#render();
        },
        setRing: el => {
            const id = this.#selected;
            const ring = Number(el.dataset.ring);
            const placement = this.#bonds.placements.find(p => p.id === id);
            if (placement?.ring === ring) return;
            this.#commit(place(this.#bonds, id, placement?.sector ?? null, ring, null));
        },
        takeOff: () => this.#commit(unplace(this.#bonds, this.#selected)),
        editSector: (el, id) => this.#sectorPop(id, el),
        editLink: (el, id) => this.#linkPop(id, el),
        placeAll: () => {
            const placed = new Set(this.#bonds.placements.map(p => p.id));
            this.#commit(placeAll(this.#bonds, this.#model.entries.filter(e => !placed.has(e.id)).map(e => e.id), 3));
        },
        // Popover actions
        popClose: () => this.#closePop(),
        swatch: el => {
            el.closest(".bonds-pop").querySelectorAll(".bonds-swatch").forEach(s => s.classList.toggle("is-on", s === el));
            const input = el.closest("form")?.querySelector('[name="color"]');
            if (input) input.value = el.dataset.color;
        },
        sectorDelete: el => {
            const id = el.closest("[data-sector-form]").dataset.sector;
            this.#commit(removeSector(this.#bonds, id));
            this.#closePop();
        },
        linkFlip: el => {
            const form = el.closest("[data-link-form]");
            const link = this.#allLinks().find(l => l.id === form.dataset.link);
            if (!link) return;
            if (link.official) this.adapter.saveOfficial(setOfficial(this.#model.officialAll ?? [], link.b, link.a, link.type));
            else this.#commit(setLink(this.#bonds, link.b, link.a, link.type));
            this.#closePop();
        },
        linkDelete: el => {
            const form = el.closest("[data-link-form]");
            const link = this.#allLinks().find(l => l.id === form.dataset.link);
            if (link?.official) this.adapter.saveOfficial(removeOfficial(this.#model.officialAll ?? [], link.id));
            else this.#commit(removeLink(this.#bonds, form.dataset.link));
            this.#closePop();
        }
    };

    #pickForLink(id) {
        if (!this.#linkFrom) {
            this.#linkFrom = id;
            return this.#render();
        }
        const a = this.#linkFrom;
        this.#linkFrom = null;
        this.#linkMode = false;
        this.#render();
        if (a === id) return;
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

    /** Name and colour of a category: a new one (for `entryId`, just dropped) or an existing one. */
    #sectorPop(id, anchor, entryId = null) {
        const sector = id ? this.#bonds.sectors.find(s => s.id === id) : null;
        const color = sector?.color ?? SECTOR_COLORS[(this.#bonds.sectors.length + 4) % SECTOR_COLORS.length];
        const who = entryId ? this.#model.entries.find(e => e.id === entryId)?.name ?? "???" : "";
        const html = `
        <form class="bonds-form" data-sector-form data-sector="${esc(id ?? "")}" data-entry="${esc(entryId ?? "")}">
            <span class="persona-eyebrow">${esc(sector ? this.t("EditSector") : this.t("NewSector"))}${who ? ` · ${esc(who)}` : ""}</span>
            <input type="text" name="label" maxlength="60" value="${esc(sector?.label ?? "")}" placeholder="${esc(this.t("SectorPlaceholder"))}" autocomplete="off">
            <input type="hidden" name="color" value="${color}">
            <div class="bonds-swatches">${SECTOR_COLORS.map(c => `<button type="button" class="bonds-swatch ${c === color ? "is-on" : ""}" data-action="swatch" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("")}</div>
            ${sector ? `<p class="bonds-form__hint">${esc(this.t("DissolveHint"))}</p>` : ""}
            <div class="bonds-form__row">
                ${sector ? `<button type="button" class="persona-mini bonds-danger" data-action="sectorDelete"><i class="fa-solid fa-folder-minus" inert></i><span>${esc(this.t("Dissolve"))}</span></button>` : ""}
                <span class="bonds-form__spacer"></span>
                <button type="button" class="persona-mini" data-action="popClose">${esc(this.t("Cancel"))}</button>
                <button type="submit" class="persona-button">${esc(sector ? this.t("Save") : this.t("Create"))}</button>
            </div>
        </form>`;
        this.#openPop(html, anchor);
    }

    #linkPop(linkId, anchor, fresh = null) {
        const m = this.#model;
        const link = linkId ? this.#allLinks().find(l => l.id === linkId) : null;
        const a = link?.a ?? fresh?.a, b = link?.b ?? fresh?.b;
        if (!a || !b) return;
        const name = id => this.#nodeInfo(id)?.name ?? "???";
        const people = ![a, b].some(id => id === SELF || m.party.some(p => p.id === id));
        // The GM can make a new link between two people "official": it shows on every wheel that knows both.
        const canOfficial = m.isGM && !link && people;
        const type = link?.type ?? "";
        const html = `
        <form class="bonds-form bonds-form--link" data-link-form data-link="${esc(link?.id ?? "")}" data-a="${esc(a)}" data-b="${esc(b)}" data-official="${link?.official ? "1" : ""}">
            <span class="persona-eyebrow">${esc(name(a))} <i class="fa-solid fa-arrow-right-long" inert></i> ${esc(name(b))}</span>
            <input type="hidden" name="type" value="${esc(type)}">
            <div class="bonds-types">${LINK_TYPES.map(t => `
                <button type="button" class="bonds-type ${type === t.id ? "is-on" : ""}" data-action="pickType" data-type="${t.id}" style="--c:${t.color}">
                    <i class="${t.icon}" inert></i><span>${esc(this.t(`Type.${t.id}`))}</span>
                </button>`).join("")}</div>
            <input type="text" name="note" maxlength="140" value="${esc(link?.note ?? "")}" placeholder="${esc(this.t("NotePlaceholder"))}" autocomplete="off">
            ${link?.official ? "" : `<label class="bonds-check"><input type="checkbox" name="suspect" ${link?.suspect ? "checked" : ""}><span><b>${esc(this.t("Suspected"))}</b>${esc(this.t("SuspectHint"))}</span></label>`}
            ${canOfficial ? `<label class="bonds-check"><input type="checkbox" name="official"><span><b><i class="fa-solid fa-stamp" inert></i> ${esc(this.t("Official"))}</b>${esc(this.t("OfficialHint"))}</span></label>` : ""}
            ${link?.official || canOfficial ? `<label class="bonds-check"><input type="checkbox" name="hidden" ${link?.hidden ? "checked" : ""}><span><b><i class="fa-solid fa-eye-slash" inert></i> ${esc(this.t("HiddenShort"))}</b>${esc(this.t("HiddenHint"))}</span></label>` : ""}
            <div class="bonds-form__row">
                ${link && LINK_TYPES.find(t => t.id === link.type)?.directed ? `<button type="button" class="persona-mini persona-mini--icon" data-action="linkFlip" title="${esc(this.t("Flip"))}" aria-label="${esc(this.t("Flip"))}"><i class="fa-solid fa-right-left" inert></i></button>` : ""}
                ${link ? `<button type="button" class="persona-mini persona-mini--icon bonds-danger" data-action="linkDelete" title="${esc(this.t("DeleteLink"))}" aria-label="${esc(this.t("DeleteLink"))}"><i class="fa-solid fa-trash" inert></i></button>` : ""}
                <span class="bonds-form__spacer"></span>
                <button type="button" class="persona-mini" data-action="popClose">${esc(this.t("Cancel"))}</button>
                <button type="submit" class="persona-button" ${type ? "" : "disabled"}>${esc(this.t("Save"))}</button>
            </div>
        </form>`;
        this.#openPop(html, anchor ?? fresh.at);
    }

    #onSubmit = event => {
        const linkForm = event.target.closest("[data-link-form]");
        if (linkForm) {
            event.preventDefault();
            const { a, b } = linkForm.dataset;
            const type = linkForm.querySelector('[name="type"]').value;
            if (!type) return;
            const note = linkForm.querySelector('[name="note"]').value.trim();
            const suspect = !!linkForm.querySelector('[name="suspect"]')?.checked;
            const hidden = !!linkForm.querySelector('[name="hidden"]')?.checked;
            const official = linkForm.dataset.official === "1" || !!linkForm.querySelector('[name="official"]')?.checked;
            this.#closePop();
            if (official) return this.adapter.saveOfficial(setOfficial(this.#model.officialAll ?? [], a, b, type, { note, hidden }));
            return this.#commit(setLink(this.#bonds, a, b, type, { note, suspect }));
        }
        const form = event.target.closest("[data-sector-form]");
        if (!form) return;
        event.preventDefault();
        const label = form.querySelector('[name="label"]').value.trim();
        const color = form.querySelector('[name="color"]').value;
        if (!label) return form.querySelector('[name="label"]').focus();
        const id = form.dataset.sector;
        const entryId = form.dataset.entry;
        this.#closePop();
        if (id) this.#commit(updateSector(this.#bonds, id, { label, color }));
        else if (entryId) this.#commit(createSector(this.#bonds, entryId, { label, color }));
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
