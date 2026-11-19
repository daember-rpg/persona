/**
 * In-world documents (letters, decrees, notes, torn maps): the choices the GM picks from,
 * and the pieces drawn for them. Pure: no Foundry calls, so the preview can use it too.
 */

/** Kinds of paper, in the order the editor offers them. */
export const PAPERS = [
    { id: "letter", icon: "fa-solid fa-envelope" },
    { id: "decree", icon: "fa-solid fa-scroll" },
    { id: "note", icon: "fa-solid fa-note-sticky" },
    { id: "map", icon: "fa-solid fa-map" }
];

/** Wax colours: a base, a highlight and a shadow for the relief. */
export const SEAL_COLORS = {
    crimson: ["#8a1712", "#c8392c", "#3d0806"],
    black: ["#1f1b19", "#4f4741", "#080706"],
    gold: ["#a67c22", "#e8c262", "#4d360c"],
    forest: ["#24461f", "#4f7d45", "#0e1f0c"],
    royal: ["#1f3170", "#4c64b4", "#0b1433"],
    violet: ["#552260", "#8f52a0", "#24092b"]
};

/** What's pressed into the wax: an initial (letters) or one of these marks (names: PERSONA.Doc.Marks.<last word>). */
export const SEAL_SIGILS = [
    "fa-solid fa-crown", "fa-solid fa-chess-rook", "fa-solid fa-skull", "fa-solid fa-eye",
    "fa-solid fa-dragon", "fa-solid fa-feather-pointed", "fa-solid fa-sun", "fa-solid fa-moon",
    "fa-solid fa-shield-halved", "fa-solid fa-khanda", "fa-solid fa-fire", "fa-solid fa-leaf"
];

/** A small seeded random number generator, so the same document always tears the same way. */
export function seeded(seed) {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
}

/**
 * A CSS clip-path polygon for torn paper. `edges` says which sides are torn ("tb", "trbl"…);
 * the others stay straight. `depth` is how far the tears bite, in %.
 */
export function tornClip(seed, edges = "trbl", depth = 2.2) {
    const rnd = seeded(seed);
    const pts = [];
    const steps = 22;
    const bite = () => (rnd() * depth).toFixed(2);
    const side = (torn, from, to) => {
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const along = (from.along + (to.along - from.along) * t).toFixed(2);
            pts.push(from.make(along, torn ? bite() : 0));
        }
    };
    side(edges.includes("t"), { along: 0, make: (a, d) => `${a}% ${d}%` }, { along: 100 });
    side(edges.includes("r"), { along: 0, make: (a, d) => `${100 - d}% ${a}%` }, { along: 100 });
    side(edges.includes("b"), { along: 100, make: (a, d) => `${a}% ${100 - d}%` }, { along: 0 });
    side(edges.includes("l"), { along: 100, make: (a, d) => `${d}% ${a}%` }, { along: 0 });
    return `polygon(${pts.join(", ")})`;
}

/** Which sides each paper tears on. */
export const TORN_EDGES = { letter: "", decree: "", note: "tb", map: "trbl" };

/** A slight tilt, so a pile of notes doesn't look stamped out. */
export function tiltOf(seed, paper) {
    const range = paper === "note" ? 3 : paper === "map" ? 1.6 : 0.6;
    return ((seeded(`${seed}:tilt`)() * 2 - 1) * range).toFixed(2);
}

/**
 * The wax: an irregular blob with a raised rim, as an inline SVG.
 * The mark (initial or icon) is laid over it in HTML so it can use the icon font.
 */
export function sealSvg(seed, color = "crimson") {
    const [base, light, dark] = SEAL_COLORS[color] ?? SEAL_COLORS.crimson;
    const rnd = seeded(`${seed}:seal`);
    const blob = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 46 + rnd() * 4 - (i % 5 === 0 ? 0 : rnd() * 2);
        blob.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
    }
    // Smooth closed curve through the points (Catmull-Rom → cubic Bézier).
    let d = `M${blob[0][0].toFixed(1)},${blob[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
        const p0 = blob[(i - 1 + n) % n], p1 = blob[i], p2 = blob[(i + 1) % n], p3 = blob[(i + 2) % n];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    // No <defs>: the same seal is drawn many times on a page (tiles, rows, the letter), and a gradient
    // whose definition sits in a hidden copy doesn't paint. Shading is layered flat circles instead.
    return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
<path d="${d}" fill="${base}"/>
<path d="${d}" fill="${dark}" opacity=".35" transform="translate(2.5 3) scale(.95)"/>
<circle cx="47" cy="46" r="40" fill="${base}"/>
<circle cx="44" cy="42" r="34" fill="${light}" opacity=".28"/>
<circle cx="41" cy="38" r="22" fill="${light}" opacity=".22"/>
<circle cx="51" cy="51" r="31" fill="${dark}" opacity=".55"/>
<circle cx="50" cy="50" r="29.5" fill="${base}"/>
<circle cx="47.5" cy="47" r="24" fill="${light}" opacity=".22"/>
<circle cx="54" cy="55" r="20" fill="${dark}" opacity=".22"/>
<circle cx="50" cy="50" r="29.5" fill="none" stroke="${light}" stroke-opacity=".45" stroke-width=".9"/>
<circle cx="50" cy="50" r="24.5" fill="none" stroke="${dark}" stroke-opacity=".55" stroke-width=".7" stroke-dasharray="1.2 1.6"/>
<ellipse cx="34" cy="27" rx="9" ry="3.6" fill="#fff" opacity=".28" transform="rotate(-34 34 27)"/>
<ellipse cx="68" cy="80" rx="7" ry="2.4" fill="#fff" opacity=".08" transform="rotate(-34 68 80)"/>
</svg>`;
}
