/**
 * Bonds — each player's relationship wheel, inspired by the "People" screen of Final Fantasy XVI.
 *
 * Pure data and geometry: no Foundry globals here, so the same code runs in the module,
 * in the standalone preview and in tests.
 *
 * A player's wheel (stored in their own user flags):
 *   { v, sectors: [{ id, label, color }], placements: [{ id, sector, ring }], links: [{ id, a, b, type }] }
 * - Slices are derived, never empty: by default a person sits in the slice of their Persona folder
 *   (the GM's tags), and a slice exists only while someone is in it.
 * - sectors: the player's own categories ("don't trust"…). A person moved into one keeps
 *   `placement.sector` = its id; otherwise `sector` is null (= their folder's slice).
 *   A category with nobody in it is dropped.
 * - placements: a known person (Persona entry id) at a distance ring (1 close … 3 distant).
 *   The order of the array is the order inside each slice and ring.
 * - links: a relation between two portraits. Node ids are entry ids, "self" or "u:<userId>" (party).
 *   `note`: one line of why ("owes us 50 gold"); `suspect`: the player thinks so but isn't sure.
 * Official links (GM, world data) use the same shape between two people, plus `hidden`.
 * Everything is an array so a Foundry flag update replaces it whole (objects would be merged).
 */

export const SELF = "self";
export const PARTY_PREFIX = "u:";

export const RINGS = [1, 2, 3];

export const STATUSES = ["alive", "dead", "missing"];

export const LINK_TYPES = [
    { id: "ally", icon: "fa-solid fa-handshake", color: "#8fa35a", directed: false },
    { id: "family", icon: "fa-solid fa-house", color: "#d9c79e", directed: false },
    { id: "love", icon: "fa-solid fa-heart", color: "#d0708f", directed: false },
    { id: "rival", icon: "fa-solid fa-bolt", color: "#c9a35a", directed: false },
    { id: "enemy", icon: "fa-solid fa-burst", color: "#d4553c", directed: false },
    { id: "serves", icon: "fa-solid fa-crown", color: "#d68a5c", directed: true },
    { id: "betrayed", icon: "fa-solid fa-heart-crack", color: "#a33a2a", directed: true }
];

/** Slice colours: Embermark tones, readable on the dark wheel. */
export const SECTOR_COLORS = ["#b4643e", "#74864a", "#4f7a8a", "#8a5a8f", "#c9a35a", "#c8452f", "#5d6b9a", "#857a65"];

/** Logical canvas, scaled to fit the window. */
export const GEOMETRY = {
    size: 1000,
    center: 500,
    selfRadius: 54,
    partyRadius: 132,
    partyBand: [92, 172],
    ringBands: [[180, 272], [272, 364], [364, 456]],
    labelRadius: 478,
    nodeArc: 74,          // arc length one portrait needs on its ring
    laneWidth: 70,        // extra depth a ring gains for each lane when it fills up
    minSector: 0.42,      // radians
    gap: 0.035            // radians between slices
};

const uid = () => Math.random().toString(36).slice(2, 12);
const clampRing = ring => Math.min(3, Math.max(1, Math.round(Number(ring) || 2)));

/* -------------------------------------------- */
/*  Normalizing                                 */
/* -------------------------------------------- */

export function emptyBonds() {
    return { v: 1, sectors: [], placements: [], links: [], pins: [], archived: [] };
}

export function normalizeBonds(raw) {
    const out = emptyBonds();
    if (!raw || typeof raw !== "object") return out;
    const sectors = [];
    const sectorIds = new Set();
    for (const s of Array.isArray(raw.sectors) ? raw.sectors : []) {
        if (!s?.id || sectorIds.has(s.id)) continue;
        sectorIds.add(s.id);
        sectors.push({
            id: String(s.id),
            label: String(s.label ?? "").slice(0, 60),
            color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : SECTOR_COLORS[sectors.length % SECTOR_COLORS.length]
        });
    }
    const placed = new Set();
    for (const p of Array.isArray(raw.placements) ? raw.placements : []) {
        if (!p?.id || placed.has(p.id)) continue;
        placed.add(p.id);
        out.placements.push({ id: String(p.id), sector: sectorIds.has(p.sector) ? String(p.sector) : null, ring: clampRing(p.ring) });
    }
    // Pinned people (shown first, starred) and archived ones (out of the way, kept for the timeline).
    out.archived = [...new Set((Array.isArray(raw.archived) ? raw.archived : []).map(String))].filter(id => !placed.has(id));
    out.pins = [...new Set((Array.isArray(raw.pins) ? raw.pins : []).map(String))];
    // A category exists only while someone is in it.
    const used = new Set(out.placements.map(p => p.sector).filter(Boolean));
    out.sectors = sectors.filter(s => used.has(s.id));
    const types = new Set(LINK_TYPES.map(t => t.id));
    const pairs = new Set();
    for (const l of Array.isArray(raw.links) ? raw.links : []) {
        if (!l?.a || !l?.b || l.a === l.b) continue;
        const key = [l.a, l.b].sort().join("|");
        if (pairs.has(key)) continue;
        pairs.add(key);
        out.links.push(normalizeLink(l, types));
    }
    return out;
}

function normalizeLink(l, types = new Set(LINK_TYPES.map(t => t.id))) {
    return {
        id: String(l.id ?? uid()),
        a: String(l.a),
        b: String(l.b),
        type: types.has(l.type) ? l.type : "ally",
        note: String(l.note ?? "").slice(0, 140),
        suspect: !!l.suspect
    };
}

/** The GM's official links: between two people, shown on every wheel that knows both. */
export function normalizeOfficial(raw) {
    const out = [];
    const pairs = new Set();
    for (const l of Array.isArray(raw) ? raw : Object.values(raw ?? {})) {
        if (!l?.a || !l?.b || l.a === l.b) continue;
        const key = [l.a, l.b].sort().join("|");
        if (pairs.has(key)) continue;
        pairs.add(key);
        out.push({ ...normalizeLink(l), suspect: false, hidden: !!l.hidden, official: true });
    }
    return out;
}

/* -------------------------------------------- */
/*  Edits (pure: each returns a new wheel)      */
/* -------------------------------------------- */

const copy = bonds => JSON.parse(JSON.stringify(normalizeBonds(bonds)));

/** A new category holding one person (a category never exists empty). */
export function createSector(bonds, entryId, { label, color } = {}, ring = 2) {
    const next = copy(bonds);
    const id = uid();
    next.sectors.push({ id, label: String(label ?? "").trim().slice(0, 60), color: color ?? SECTOR_COLORS[next.sectors.length % SECTOR_COLORS.length] });
    const was = next.placements.find(p => p.id === entryId);
    next.placements = next.placements.filter(p => p.id !== entryId);
    next.placements.push({ id: entryId, sector: id, ring: was?.ring ?? ring });
    return normalizeBonds(next);
}

export function updateSector(bonds, id, changes) {
    const next = copy(bonds);
    const sector = next.sectors.find(s => s.id === id);
    if (sector) {
        if (changes.label !== undefined) sector.label = String(changes.label).trim().slice(0, 60);
        if (changes.color) sector.color = changes.color;
    }
    return normalizeBonds(next);
}

/** Dissolves a category: its people go back to their folders' slices, same distance. */
export function removeSector(bonds, id) {
    const next = copy(bonds);
    for (const p of next.placements) if (p.sector === id) p.sector = null;
    return normalizeBonds(next);
}

/**
 * Puts a person at a ring, in a category (`sector` = its id) or in their folder's slice (null),
 * just before `beforeId`, or at the end. Moving inside the same cell reorders.
 */
export function place(bonds, entryId, sector, ring, beforeId = null) {
    const next = copy(bonds);
    if (sector && !next.sectors.some(s => s.id === sector)) sector = null;
    ring = clampRing(ring);
    const rest = next.placements.filter(p => p.id !== entryId);
    next.archived = next.archived.filter(id => id !== entryId);
    const item = { id: entryId, sector: sector ?? null, ring };
    const anchor = beforeId ? rest.findIndex(p => p.id === beforeId) : -1;
    if (anchor >= 0) rest.splice(anchor, 0, item);
    else rest.push(item);
    next.placements = rest;
    return normalizeBonds(next);
}

export function togglePin(bonds, entryId) {
    const next = copy(bonds);
    next.pins = next.pins.includes(entryId) ? next.pins.filter(id => id !== entryId) : [...next.pins, entryId];
    return normalizeBonds(next);
}

/** Archives someone: off the wheel and out of the "not placed" list, still in the timeline. */
export function archive(bonds, entryId) {
    const next = copy(bonds);
    next.placements = next.placements.filter(p => p.id !== entryId);
    next.archived = [...new Set([...next.archived, entryId])];
    next.pins = next.pins.filter(id => id !== entryId);
    return normalizeBonds(next);
}

export function restore(bonds, entryId) {
    const next = copy(bonds);
    next.archived = next.archived.filter(id => id !== entryId);
    return normalizeBonds(next);
}

export function unplace(bonds, entryId) {
    const next = copy(bonds);
    next.placements = next.placements.filter(p => p.id !== entryId);
    return normalizeBonds(next);
}

/**
 * Creates the link between two nodes, or updates it if they are already linked.
 * `extra`: { note, suspect } (kept as they were when omitted).
 */
export function setLink(bonds, a, b, type, extra = {}) {
    const next = copy(bonds);
    if (!a || !b || a === b) return next;
    const existing = next.links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    if (existing) {
        existing.type = type;
        // A directed link keeps the direction the player just drew.
        existing.a = a;
        existing.b = b;
        if (extra.note !== undefined) existing.note = extra.note;
        if (extra.suspect !== undefined) existing.suspect = extra.suspect;
    } else {
        next.links.push({ id: uid(), a, b, type, note: extra.note ?? "", suspect: !!extra.suspect });
    }
    return normalizeBonds(next);
}

/** Same as setLink, for the GM's official list (an array). */
export function setOfficial(list, a, b, type, extra = {}) {
    const next = normalizeOfficial(list).filter(l => !((l.a === a && l.b === b) || (l.a === b && l.b === a)));
    const was = normalizeOfficial(list).find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    next.push({ id: was?.id ?? uid(), a, b, type, note: extra.note ?? was?.note ?? "", hidden: extra.hidden ?? was?.hidden ?? false });
    return normalizeOfficial(next);
}

export function removeOfficial(list, id) {
    return normalizeOfficial(list).filter(l => l.id !== id);
}

export function removeLink(bonds, id) {
    const next = copy(bonds);
    next.links = next.links.filter(l => l.id !== id);
    return next;
}

/** Puts everyone not yet on the wheel in their folders' slices, on the given ring. */
export function placeAll(bonds, entryIds, ring = 2) {
    const next = copy(bonds);
    const placed = new Set(next.placements.map(p => p.id));
    const archived = new Set(next.archived);
    for (const id of entryIds) if (!placed.has(id) && !archived.has(id)) next.placements.push({ id, sector: null, ring });
    return normalizeBonds(next);
}

/** The slice key a placement lands in: its category, else its folder (tag), else "_none". */
export function sectorKeyOf(placement, tagOf) {
    return placement.sector ?? tagOf.get(placement.id) ?? NO_TAG;
}

export const NO_TAG = "_none";

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

/** Angle 0 is the top of the wheel, growing clockwise. */
export function polar(r, angle, g = GEOMETRY) {
    return { x: g.center + r * Math.sin(angle), y: g.center - r * Math.cos(angle) };
}

export function toPolar(x, y, g = GEOMETRY) {
    const dx = x - g.center;
    const dy = y - g.center;
    let angle = Math.atan2(dx, -dy);
    if (angle < 0) angle += Math.PI * 2;
    return { r: Math.hypot(dx, dy), angle };
}

const ringMid = (ring, g) => (g.ringBands[ring - 1][0] + g.ringBands[ring - 1][1]) / 2;

/**
 * Lays the wheel out.
 * @param bonds    a normalized wheel
 * @param visible  Set of entry ids this viewer may see (others are skipped, never drawn)
 * @param partyIds node ids of the other party members, in order
 * @param tags     { list: [{ key, label, color }] in the GM's folder order, tagOf: Map(entryId → key),
 *                   noneLabel } — the slices people fall into by default
 * @returns { sectors, nodes: Map(id → {x, y, angle, ring, sector}), self, party }
 */
export function layout(bonds, visible, partyIds = [], tags = {}, g = GEOMETRY) {
    const TAU = Math.PI * 2;
    const tagOf = tags.tagOf ?? new Map();
    const placements = bonds.placements.filter(p => visible.has(p.id)).map(p => ({ ...p, key: sectorKeyOf(p, tagOf) }));
    const present = new Set(placements.map(p => p.key));
    // Only slices with someone in them: folders in the GM's order, then the player's categories, then "no folder".
    const defs = [
        ...(tags.list ?? []).filter(t => present.has(t.key)).map(t => ({ id: t.key, label: t.label, color: t.color, custom: false })),
        ...bonds.sectors.filter(s => present.has(s.id)).map(s => ({ id: s.id, label: s.label, color: s.color, custom: true })),
        ...(present.has(NO_TAG) ? [{ id: NO_TAG, label: tags.noneLabel ?? "", color: "#857a65", custom: false }] : [])
    ];
    // A folder the viewer can't see as a tag still shows (its entries are known): fall back to "no folder".
    const known = new Set(defs.map(d => d.id));
    for (const p of placements) if (!known.has(p.key)) {
        p.key = NO_TAG;
        if (!known.has(NO_TAG)) { defs.push({ id: NO_TAG, label: tags.noneLabel ?? "", color: "#857a65", custom: false }); known.add(NO_TAG); }
    }

    const count = (key, ring) => placements.filter(p => p.key === key && p.ring === ring).length;
    const n = defs.length;
    const available = TAU - n * g.gap;
    const minSector = Math.min(g.minSector, (available / Math.max(1, n)) * 0.8);

    // Slice widths: room for the fullest ring, on a single lane; shrunk to fit when needed.
    const baseMid = k => (g.ringBands[k][0] + g.ringBands[k][1]) / 2;
    const needs = defs.map(d => Math.max(minSector, ...RINGS.map(ring => count(d.id, ring) * (g.nodeArc / baseMid(ring - 1)))));
    const total = needs.reduce((x, y) => x + y, 0);
    const widths = total <= available
        ? needs.map(w => w + (available - total) / Math.max(1, n))
        : needs.map(w => w * (available / total));

    const sectors = [];
    let cursor = n > 1 ? -widths[0] / 2 : -available / 2; // first slice centred at the top
    defs.forEach((d, i) => {
        const start = cursor + g.gap / 2;
        const end = start + widths[i];
        cursor = end + g.gap / 2;
        sectors.push({ ...d, index: i, start, end, mid: (start + end) / 2 });
    });

    // Rings grow with the campaign: when a slice can't hold a ring's people side by side, that
    // ring gets another lane and the wheel grows outward, instead of piling portraits up.
    const bands = [];
    const lanes = [];
    let edge = g.ringBands[0][0];
    for (let k = 0; k < 3; k++) {
        const base = g.ringBands[k][1] - g.ringBands[k][0];
        const laneR = edge + base / 2;
        let L = 1;
        for (const sector of sectors) {
            const perLane = Math.max(1, Math.floor(((sector.end - sector.start) * laneR) / g.nodeArc));
            L = Math.max(L, Math.ceil(count(sector.id, k + 1) / perLane));
        }
        const width = base + (L - 1) * g.laneWidth;
        bands.push([edge, edge + width]);
        lanes.push(L);
        edge += width;
    }
    const outer = bands[2][1];
    const geo = { ...g, ringBands: bands, labelRadius: outer + 22, outer, lanes };

    const nodes = new Map();
    for (const sector of sectors) {
        const span = sector.end - sector.start;
        for (const ring of RINGS) {
            const k = ring - 1;
            const cell = placements.filter(p => p.key === sector.id && p.ring === ring);
            if (!cell.length) continue;
            const [r0, r1] = bands[k];
            const laneDepth = (r1 - r0) / lanes[k];
            // Fill from the inside out, one lane at a time.
            let i = 0;
            for (let lane = 0; lane < lanes[k] && i < cell.length; lane++) {
                const r = r0 + (lane + 0.5) * laneDepth;
                const perLane = Math.max(1, Math.floor((span * r) / g.nodeArc));
                const row = cell.slice(i, i + perLane);
                i += row.length;
                const step = g.nodeArc / r;
                const used = Math.min(span * 0.94, row.length * step);
                // Odd lanes sit half a seat over, like an amphitheatre.
                const shift = lane % 2 && row.length * step < span * 0.94 - step / 2 ? step / 2 : 0;
                const first = sector.mid - used / 2 + shift;
                row.forEach((p, j) => {
                    const angle = first + (j + 0.5) * (used / row.length);
                    nodes.set(p.id, { ...polar(r, angle, g), angle, ring, sector: sector.id, r });
                });
            }
        }
    }

    const party = partyIds.map((id, i) => {
        const angle = partyIds.length === 1 ? Math.PI : (i / partyIds.length) * TAU + Math.PI / partyIds.length;
        const point = { ...polar(g.partyRadius, angle, g), angle, r: g.partyRadius, id };
        nodes.set(id, point);
        return point;
    });
    const self = { x: g.center, y: g.center, angle: 0, r: 0, id: SELF };
    nodes.set(SELF, self);

    return { sectors, nodes, party, self, g: geo };
}

const norm = a => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** True when `angle` lies inside a slice (both may wrap past the top). */
export function inSector(angle, sector) {
    const span = sector.end - sector.start;
    return norm(angle - sector.start) <= span;
}

/**
 * Where a drop lands: { kind: "cell", sector, ring, before } inside the wheel — `sector` is the
 * slice key under the pointer (null on an empty wheel), `before` the person the dropped one goes
 * in front of (null = the end) —, { kind: "out" } past the outer edge (take off the wheel),
 * or { kind: "none" } over the centre and party.
 */
export function hitTest(x, y, laid, draggedId = null) {
    const g = laid.g ?? GEOMETRY;
    const { r, angle } = toPolar(x, y, g);
    const outer = g.ringBands[2][1];
    if (r > outer + 24) return { kind: "out" };
    if (r < g.ringBands[0][0]) return { kind: "none" };
    const ring = r < g.ringBands[0][1] ? 1 : r < g.ringBands[1][1] ? 2 : 3;
    if (!laid.sectors.length) return { kind: "cell", sector: null, ring, before: null };
    let sector = laid.sectors.find(s => inSector(angle, s));
    if (!sector) {
        const dist = s => Math.min(Math.abs(norm(angle - s.start)), Math.abs(norm(s.start - angle)),
            Math.abs(norm(angle - s.end)), Math.abs(norm(s.end - angle)));
        sector = [...laid.sectors].sort((a, b) => dist(a) - dist(b))[0];
    }
    const rel = a => norm(a - sector.start);
    const target = rel(angle);
    let before = null;
    let best = Infinity;
    for (const [id, node] of laid.nodes) {
        if (id === draggedId || node.sector !== sector.id || node.ring !== ring) continue;
        const d = rel(node.angle);
        if (d > target && d < best) { best = d; before = id; }
    }
    return { kind: "cell", sector: sector.id, ring, before };
}

/* -------------------------------------------- */
/*  SVG path helpers                            */
/* -------------------------------------------- */

const f = n => Math.round(n * 10) / 10;

/** Annular wedge between two radii and two angles. */
export function wedgePath(r1, r2, a1, a2, g = GEOMETRY) {
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const p1 = polar(r2, a1, g), p2 = polar(r2, a2, g), p3 = polar(r1, a2, g), p4 = polar(r1, a1, g);
    return `M${f(p1.x)} ${f(p1.y)}A${r2} ${r2} 0 ${large} 1 ${f(p2.x)} ${f(p2.y)}L${f(p3.x)} ${f(p3.y)}A${r1} ${r1} 0 ${large} 0 ${f(p4.x)} ${f(p4.y)}Z`;
}

/** Open arc; reversed so text along it reads left-to-right on the lower half of the wheel. */
export function arcPath(r, a1, a2, g = GEOMETRY) {
    const mid = norm((a1 + a2) / 2);
    const bottom = mid > Math.PI / 2 && mid < Math.PI * 1.5;
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const s = polar(r, bottom ? a2 : a1, g), e = polar(r, bottom ? a1 : a2, g);
    return { d: `M${f(s.x)} ${f(s.y)}A${r} ${r} 0 ${large} ${bottom ? 0 : 1} ${f(e.x)} ${f(e.y)}`, bottom };
}

/**
 * A gentle curve between two portraits, bowed away from the centre so links don't cross the
 * self portrait, trimmed by each portrait's radius so arrowheads land on the rim.
 */
export function linkPath(p, q, rp = 0, rq = 0, g = GEOMETRY, bend = 0.5) {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if ((mx - g.center) * nx + (my - g.center) * ny < 0) { nx = -nx; ny = -ny; }
    // bend 0 = a straight line, 0.5 = the default gentle curve, 1 = a strong arc.
    const bow = Math.min(120, len * 0.36) * Math.max(0, Math.min(1, bend));
    const cx = mx + nx * bow, cy = my + ny * bow;
    const toward = (from, r) => {
        const vx = cx - from.x, vy = cy - from.y;
        const d = Math.hypot(vx, vy) || 1;
        return { x: from.x + (vx / d) * r, y: from.y + (vy / d) * r };
    };
    const s = toward(p, rp), e = toward(q, rq);
    // Midpoint of the quadratic curve, for the relation icon.
    const ix = 0.25 * s.x + 0.5 * cx + 0.25 * e.x, iy = 0.25 * s.y + 0.5 * cy + 0.25 * e.y;
    return { d: `M${f(s.x)} ${f(s.y)}Q${f(cx)} ${f(cy)} ${f(e.x)} ${f(e.y)}`, mid: { x: ix, y: iy } };
}

/** How a viewer likes links drawn (their own preference, kept per user). */
export const LINK_STYLE_DEFAULT = { shape: "curve", bend: 0.5, show: "always" };

export function normalizeLinkStyle(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
        shape: ["curve", "angular"].includes(r.shape) ? r.shape : LINK_STYLE_DEFAULT.shape,
        bend: Number.isFinite(Number(r.bend)) ? Math.max(0, Math.min(1, Number(r.bend))) : LINK_STYLE_DEFAULT.bend,
        show: ["always", "focus"].includes(r.show) ? r.show : LINK_STYLE_DEFAULT.show
    };
}

/**
 * Angular links, like a circuit or FFXVI's chart: out along the radius, around the wheel on a
 * ring just inside the nearer person, then out again. Links from the centre are a straight spoke.
 * Links therefore follow the wheel's own geometry instead of crossing it.
 */
export function angularPath(p, q, rp = 0, rq = 0, g = GEOMETRY) {
    const P = toPolar(p.x, p.y, g), Q = toPolar(q.x, q.y, g);
    // From the centre (or to it): one straight spoke.
    if (P.r < 1 || Q.r < 1) {
        const [c, o, ro, rc] = P.r < 1 ? [P, Q, rq, rp] : [Q, P, rp, rq];
        const s = polar(rc, o.angle, g), e = polar(o.r - ro, o.angle, g);
        const [a, b] = P.r < 1 ? [s, e] : [e, s];
        return { d: `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`, mid: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } };
    }
    // The ring to travel around: just inside whoever is nearer the centre, never inside the party band.
    const inner = Math.min(P.r, Q.r);
    const rm = inner > g.partyBand[1] + 20 ? Math.max(g.partyBand[1] + 6, inner - 36) : inner;
    let delta = Q.angle - P.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const leave = (pt, r) => (pt.r > rm ? pt.r - r : pt.r + (pt.r === rm ? 0 : r));
    const s = polar(P.r === rm ? P.r : leave(P, rp), P.angle, g);
    const e = polar(Q.r === rm ? Q.r : leave(Q, rq), Q.angle, g);
    const a1 = polar(rm, P.angle, g), a2 = polar(rm, Q.angle, g);
    // On the travel ring itself (e.g. two party members), trim along the arc instead.
    const startArc = P.r === rm ? polar(rm, P.angle + Math.sign(delta) * (rp / rm), g) : a1;
    const endArc = Q.r === rm ? polar(rm, Q.angle - Math.sign(delta) * (rq / rm), g) : a2;
    const sweep = delta > 0 ? 1 : 0;
    const large = Math.abs(delta) > Math.PI ? 1 : 0;
    const d = [
        P.r === rm ? `M${f(startArc.x)} ${f(startArc.y)}` : `M${f(s.x)} ${f(s.y)}L${f(a1.x)} ${f(a1.y)}`,
        Math.abs(delta) > 0.001 ? `A${f(rm)} ${f(rm)} 0 ${large} ${sweep} ${f(endArc.x)} ${f(endArc.y)}` : "",
        Q.r === rm ? "" : `L${f(e.x)} ${f(e.y)}`
    ].join("");
    const mid = Math.abs(delta) > 0.05 ? polar(rm, P.angle + delta / 2, g) : { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
    return { d, mid };
}

/* -------------------------------------------- */
/*  Timeline                                    */
/* -------------------------------------------- */

/**
 * What changed for one wheel between two moments (or a moment and now).
 * @returns {{ added: string[], removed: string[], closer: string[], farther: string[], died: string[], missing: string[], moves: Map }}
 */
export function diffWheels(before, after, statusBefore = {}, statusAfter = {}) {
    const a = new Map(normalizeBonds(before).placements.map(p => [p.id, p.ring]));
    const b = new Map(normalizeBonds(after).placements.map(p => [p.id, p.ring]));
    const out = { added: [], removed: [], closer: [], farther: [], died: [], missing: [], moves: new Map() };
    for (const [id, ring] of b) {
        if (!a.has(id)) out.added.push(id);
        else if (ring < a.get(id)) { out.closer.push(id); out.moves.set(id, [a.get(id), ring]); }
        else if (ring > a.get(id)) { out.farther.push(id); out.moves.set(id, [a.get(id), ring]); }
    }
    for (const id of a.keys()) if (!b.has(id)) out.removed.push(id);
    for (const [id, status] of Object.entries(statusAfter)) {
        const was = statusBefore[id] ?? "alive";
        if (status === "dead" && was !== "dead") out.died.push(id);
        else if (status === "missing" && was !== "missing") out.missing.push(id);
    }
    return out;
}
