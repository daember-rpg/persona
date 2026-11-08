/**
 * Bonds — each player's relationship wheel, inspired by the "People" screen of Final Fantasy XVI.
 *
 * Pure data and geometry: no Foundry globals here, so the same code runs in the module,
 * in the standalone preview and in tests.
 *
 * A player's wheel (stored in their own user flags):
 *   { v, sectors: [{ id, label, color }], placements: [{ id, sector, ring }], links: [{ id, a, b, type }] }
 * - sectors: groups the player creates (a kingdom, "enemies", "don't trust"…), shown as slices.
 * - placements: a known person (Persona entry id) in a slice, at a distance ring (1 close … 3 distant).
 *   The order of the array is the order inside each slice and ring.
 * - links: a relation between two portraits. Node ids are entry ids, "self" or "u:<userId>" (party).
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
    nodeArc: 66,          // arc length one portrait needs on its ring
    minSector: 0.42,      // radians
    gap: 0.035            // radians between slices
};

const uid = () => Math.random().toString(36).slice(2, 12);
const clampRing = ring => Math.min(3, Math.max(1, Math.round(Number(ring) || 2)));

/* -------------------------------------------- */
/*  Normalizing                                 */
/* -------------------------------------------- */

export function emptyBonds() {
    return { v: 1, sectors: [], placements: [], links: [] };
}

export function normalizeBonds(raw) {
    const out = emptyBonds();
    if (!raw || typeof raw !== "object") return out;
    const sectorIds = new Set();
    for (const s of Array.isArray(raw.sectors) ? raw.sectors : []) {
        if (!s?.id || sectorIds.has(s.id)) continue;
        sectorIds.add(s.id);
        out.sectors.push({
            id: String(s.id),
            label: String(s.label ?? "").slice(0, 60),
            color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : SECTOR_COLORS[out.sectors.length % SECTOR_COLORS.length]
        });
    }
    const placed = new Set();
    for (const p of Array.isArray(raw.placements) ? raw.placements : []) {
        if (!p?.id || placed.has(p.id) || !sectorIds.has(p.sector)) continue;
        placed.add(p.id);
        out.placements.push({ id: String(p.id), sector: String(p.sector), ring: clampRing(p.ring) });
    }
    const types = new Set(LINK_TYPES.map(t => t.id));
    const pairs = new Set();
    for (const l of Array.isArray(raw.links) ? raw.links : []) {
        if (!l?.a || !l?.b || l.a === l.b) continue;
        const key = [l.a, l.b].sort().join("|");
        if (pairs.has(key)) continue;
        pairs.add(key);
        out.links.push({ id: String(l.id ?? uid()), a: String(l.a), b: String(l.b), type: types.has(l.type) ? l.type : "ally" });
    }
    return out;
}

/* -------------------------------------------- */
/*  Edits (pure: each returns a new wheel)      */
/* -------------------------------------------- */

const copy = bonds => normalizeBonds(JSON.parse(JSON.stringify(bonds ?? emptyBonds())));

export function addSector(bonds, { label, color } = {}) {
    const next = copy(bonds);
    const id = uid();
    next.sectors.push({ id, label: String(label ?? "").trim().slice(0, 60), color: color ?? SECTOR_COLORS[next.sectors.length % SECTOR_COLORS.length] });
    return { bonds: normalizeBonds(next), id };
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

/** Moves a slice one step around the wheel (-1 counter-clockwise, +1 clockwise). */
export function moveSector(bonds, id, step) {
    const next = copy(bonds);
    const i = next.sectors.findIndex(s => s.id === id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= next.sectors.length) return next;
    [next.sectors[i], next.sectors[j]] = [next.sectors[j], next.sectors[i]];
    return next;
}

/** Removes a slice; the people in it go back to the unplaced list. */
export function removeSector(bonds, id) {
    const next = copy(bonds);
    next.sectors = next.sectors.filter(s => s.id !== id);
    return normalizeBonds(next);
}

/**
 * Puts a person in a slice and ring, just before `beforeId` (another person in that cell),
 * or at the end. Moving inside the same cell reorders.
 */
export function place(bonds, entryId, sector, ring, beforeId = null) {
    const next = copy(bonds);
    if (!next.sectors.some(s => s.id === sector)) return next;
    ring = clampRing(ring);
    const rest = next.placements.filter(p => p.id !== entryId);
    const item = { id: entryId, sector, ring };
    const anchor = beforeId ? rest.findIndex(p => p.id === beforeId && p.sector === sector && p.ring === ring) : -1;
    if (anchor >= 0) rest.splice(anchor, 0, item);
    else rest.push(item);
    next.placements = rest;
    return normalizeBonds(next);
}

export function unplace(bonds, entryId) {
    const next = copy(bonds);
    next.placements = next.placements.filter(p => p.id !== entryId);
    return next;
}

/** Creates the link between two nodes, or changes its type if they are already linked. */
export function setLink(bonds, a, b, type) {
    const next = copy(bonds);
    if (!a || !b || a === b) return next;
    const existing = next.links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    if (existing) {
        existing.type = type;
        // A directed link keeps the direction the player just drew.
        existing.a = a;
        existing.b = b;
    } else {
        next.links.push({ id: uid(), a, b, type });
    }
    return normalizeBonds(next);
}

export function removeLink(bonds, id) {
    const next = copy(bonds);
    next.links = next.links.filter(l => l.id !== id);
    return next;
}

/**
 * Starts a wheel from the GM's Persona folders the player can see:
 * one slice per folder, its people on the middle ring.
 */
export function fromFolders(bonds, folders) {
    let next = copy(bonds);
    const placed = new Set(next.placements.map(p => p.id));
    folders.forEach(folder => {
        const result = addSector(next, { label: folder.label, color: SECTOR_COLORS[(next.sectors.length) % SECTOR_COLORS.length] });
        next = result.bonds;
        for (const id of folder.entryIds) {
            if (placed.has(id)) continue;
            placed.add(id);
            next = place(next, id, result.id, 2);
        }
    });
    return next;
}

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
 * @returns { sectors, nodes: Map(id → {x, y, angle, ring, sector}), self, party }
 */
export function layout(bonds, visible, partyIds = [], g = GEOMETRY) {
    const TAU = Math.PI * 2;
    const placements = bonds.placements.filter(p => visible.has(p.id));
    const count = (sector, ring) => placements.filter(p => p.sector === sector && p.ring === ring).length;

    // How wide each slice needs to be for its fullest ring.
    const needs = bonds.sectors.map(s => Math.max(g.minSector, ...RINGS.map(ring => count(s.id, ring) * (g.nodeArc / ringMid(ring, g)))));
    const n = bonds.sectors.length;
    const available = TAU - n * g.gap;
    const total = needs.reduce((a, b) => a + b, 0);
    const widths = total <= available
        ? needs.map(w => w + (available - total) / Math.max(1, n))
        : needs.map(w => w * (available / total));

    const sectors = [];
    let cursor = n > 1 ? -widths[0] / 2 : -available / 2; // first slice centred at the top
    bonds.sectors.forEach((s, i) => {
        const start = cursor + g.gap / 2;
        const end = start + widths[i];
        cursor = end + g.gap / 2;
        sectors.push({ ...s, index: i, start, end, mid: (start + end) / 2 });
    });

    const nodes = new Map();
    for (const sector of sectors) {
        for (const ring of RINGS) {
            const cell = placements.filter(p => p.sector === sector.id && p.ring === ring);
            const r = ringMid(ring, g);
            const span = sector.end - sector.start;
            const step = g.nodeArc / r;
            // Cluster in the middle of the slice, spreading out only when needed.
            const used = Math.min(span, cell.length * step);
            const first = sector.mid - used / 2;
            cell.forEach((p, i) => {
                const angle = first + (i + 0.5) * (used / cell.length);
                nodes.set(p.id, { ...polar(r, angle, g), angle, ring, sector: sector.id, r });
            });
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

    return { sectors, nodes, party, self };
}

const norm = a => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** True when `angle` lies inside a slice (both may wrap past the top). */
export function inSector(angle, sector) {
    const span = sector.end - sector.start;
    return norm(angle - sector.start) <= span;
}

/**
 * Where a drop lands: { kind: "cell", sector, ring, before } inside the wheel (`before`: the
 * person the dropped one goes in front of, or null for the end),
 * { kind: "out" } past the outer edge (unplace), or { kind: "none" } over the centre/party.
 */
export function hitTest(x, y, laid, bonds, visible, draggedId = null, g = GEOMETRY) {
    const { r, angle } = toPolar(x, y, g);
    const outer = g.ringBands[2][1];
    if (r > outer + 24) return { kind: "out" };
    if (r < g.ringBands[0][0]) return { kind: "none" };
    if (!laid.sectors.length) return { kind: "none" };
    const ring = r < g.ringBands[0][1] ? 1 : r < g.ringBands[1][1] ? 2 : 3;
    let sector = laid.sectors.find(s => inSector(angle, s));
    if (!sector) {
        // In a gap: the nearest slice edge.
        const dist = s => Math.min(Math.abs(norm(angle - s.start)), Math.abs(norm(s.start - angle)),
            Math.abs(norm(angle - s.end)), Math.abs(norm(s.end - angle)));
        sector = [...laid.sectors].sort((a, b) => dist(a) - dist(b))[0];
    }
    // Who it goes in front of, by angle.
    const cell = bonds.placements.filter(p => p.sector === sector.id && p.ring === ring && p.id !== draggedId && visible.has(p.id));
    const rel = a => norm(a - sector.start);
    const target = rel(angle);
    const before = cell.find(p => {
        const node = laid.nodes.get(p.id);
        return node && rel(node.angle) > target;
    });
    return { kind: "cell", sector: sector.id, ring, before: before?.id ?? null };
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
export function linkPath(p, q, rp = 0, rq = 0, g = GEOMETRY) {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if ((mx - g.center) * nx + (my - g.center) * ny < 0) { nx = -nx; ny = -ny; }
    const bow = Math.min(60, len * 0.18);
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
