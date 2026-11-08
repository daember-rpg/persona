/* Mock adapter for the Bonds preview: fake players, NPCs, reveals and one recorded moment. */
(() => {
    const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const avatar = (name, dark = false) => {
        const h = hue(name);
        const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="hsl(${h},45%,${dark ? 30 : 48}%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},40%,12%)"/></radialGradient></defs><rect width="120" height="160" fill="url(#g)"/><circle cx="60" cy="58" r="26" fill="hsla(${h},30%,85%,.22)"/><path d="M14 160c4-38 22-58 46-58s42 20 46 58z" fill="hsla(${h},30%,85%,.18)"/><text x="60" y="68" font-family="Cinzel,serif" font-size="26" font-weight="700" text-anchor="middle" fill="hsla(40,60%,92%,.92)">${initials}</text></svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    };

    const PLAYERS = [
        { id: "p1", name: "Ana", character: "Kaelen Vasthorn" },
        { id: "p2", name: "Bruno", character: "Mira Solenne" },
        { id: "p3", name: "Caio", character: "Thorne Ashgrave" },
        { id: "p4", name: "Duda", character: "Ysolde of the Reeds" }
    ];
    const ALLP = PLAYERS.map(p => p.id);

    const E = (id, name, title, opts = {}) => ({ id, name, title, img: avatar(name, opts.dark), status: opts.status ?? "alive", known: opts.known ?? ALLP, named: opts.named ?? opts.known ?? ALLP, group: opts.group ?? null, text: opts.text ?? "" });
    const ENTRIES = [
        E("e1", "Captain Ilsa Marrow", "Captain of the Embermark guard", { group: "Embermark" }),
        E("e2", "Lord Aldric Venn", "Regent of Embermark", { group: "Embermark" }),
        E("e3", "Sister Hesper", "Healer at the Ash Chapel", { group: "Embermark" }),
        E("e4", "Old Bram", "Innkeeper, The Copper Kettle", { group: "Embermark", status: "dead" }),
        E("e5", "Veyra the Hollow", "Voice of the Veiled Order", { group: "Veiled Order", dark: true }),
        E("e6", "Brother Calix", "Archivist of the Order", { group: "Veiled Order" }),
        E("e7", "Seren Duskmantle", "Envoy of the Order", { group: "Veiled Order", status: "missing" }),
        E("e8", "The Ashen King", "Lord of Kurdrax", { group: "Kurdrax", dark: true }),
        E("e9", "Gorrik Ironjaw", "Champion of Kurdrax", { group: "Kurdrax" }),
        E("e10", "Nyx", "Knife-for-hire", { group: "Kurdrax", known: ["p1", "p3"], named: ["p1"] }),
        E("e11", "Tamsin Reed", "Ysolde's sister", { known: ["p4", "p1"] }),
        E("e12", "Master Oduya", "Kaelen's old mentor", { known: ["p1"] }),
        E("e13", "Hollow Bell Witch", "Rumoured in the marshes", { known: ["p1", "p2"], named: [], dark: true }),
        E("e14", "Pell", "Street urchin, Lowmarket")
    ];

    const sample = () => ({
        v: 1,
        sectors: [
            { id: "s1", label: "Embermark", color: "#b4643e" },
            { id: "s2", label: "Veiled Order", color: "#8a5a8f" },
            { id: "s3", label: "Enemies", color: "#c8452f" },
            { id: "s4", label: "My people", color: "#74864a" }
        ],
        placements: [
            { id: "e1", sector: "s1", ring: 1 }, { id: "e2", sector: "s1", ring: 2 }, { id: "e3", sector: "s1", ring: 2 }, { id: "e4", sector: "s1", ring: 3 },
            { id: "e5", sector: "s2", ring: 2 }, { id: "e6", sector: "s2", ring: 3 }, { id: "e7", sector: "s2", ring: 1 },
            { id: "e8", sector: "s3", ring: 3 }, { id: "e9", sector: "s3", ring: 2 }, { id: "e10", sector: "s3", ring: 2 },
            { id: "e12", sector: "s4", ring: 1 }, { id: "e11", sector: "s4", ring: 2 }
        ],
        links: [
            { id: "l1", a: "self", b: "e12", type: "family" },
            { id: "l2", a: "e9", b: "e8", type: "serves" },
            { id: "l3", a: "e1", b: "e2", type: "ally" },
            { id: "l4", a: "self", b: "e9", type: "rival" },
            { id: "l5", a: "e7", b: "e5", type: "betrayed" },
            { id: "l6", a: "u:p2", b: "e3", type: "love" }
        ]
    });

    const fresh = () => ({
        role: "p1",
        entries: JSON.parse(JSON.stringify(ENTRIES)),
        wheels: { p1: sample(), p2: { v: 1, sectors: [], placements: [], links: [] }, p3: { v: 1, sectors: [{ id: "a", label: "Kurdrax", color: "#c8452f" }], placements: [{ id: "e9", sector: "a", ring: 1 }], links: [] }, p4: { v: 1, sectors: [], placements: [], links: [] } },
        moments: [],
        momentId: null,
        gmOwner: "p1"
    });
    let S = fresh();
    // One older moment: before Bram died and before the Order and Nyx were met.
    const older = sample();
    older.placements = older.placements.filter(p => !["e5", "e6", "e7", "e10"].includes(p.id));
    older.sectors = older.sectors.filter(s => s.id !== "s2");
    older.links = older.links.filter(l => !["l5"].includes(l.id));
    const seedMoments = () => [{ id: "m1", label: "Sessão 11", ts: 1, wheels: { p1: older }, statuses: { e4: "alive" } }, { id: "m2", label: "Sessão 12", ts: 2, wheels: { p1: sample() }, statuses: {} }];
    S.moments = seedMoments();

    let lang = "pt-BR";
    const t = key => key.split(".").reduce((o, k) => o?.[k], LANG[lang]) ?? key;

    const playerById = id => PLAYERS.find(p => p.id === id);
    const portrait = p => ({ id: `u:${p.id}`, name: p.character, img: avatar(p.character) });

    const adapter = {
        t,
        getModel() {
            const isGM = S.role === "gm";
            const ownerId = isGM ? S.gmOwner : S.role;
            const owner = playerById(ownerId);
            const moment = S.momentId ? S.moments.find(m => m.id === S.momentId) : null;
            const known = S.entries.filter(e => e.known.includes(ownerId));
            const groups = [...new Set(known.map(e => e.group).filter(Boolean))];
            return {
                isGM,
                editable: !isGM && !moment,
                owner: { id: owner.id, name: owner.character },
                self: { name: owner.character, img: avatar(owner.character) },
                party: PLAYERS.filter(p => p.id !== ownerId).map(portrait),
                entries: known.map(e => ({
                    id: e.id,
                    name: e.named.includes(ownerId) ? e.name : null,
                    title: e.named.includes(ownerId) ? e.title : "",
                    img: e.img, frame: "", status: moment?.statuses?.[e.id] ?? e.status,
                    isNew: !isGM && e.id === "e14"
                })),
                bonds: moment ? (moment.wheels[ownerId] ?? null) : S.wheels[ownerId],
                folders: groups.map(label => ({ label, entryIds: known.filter(e => e.group === label).map(e => e.id) })),
                players: PLAYERS.map(p => ({ id: p.id, name: `${p.name} · ${p.character}` })),
                moments: S.moments.map(m => ({ id: m.id, label: m.label, ts: m.ts })),
                momentId: moment?.id ?? null
            };
        },
        saveBonds(bonds) { S.wheels[S.role] = bonds; },
        openCard(id) {
            const e = S.entries.find(x => x.id === id);
            const ownerId = S.role === "gm" ? S.gmOwner : S.role;
            const named = S.role === "gm" || e.named.includes(ownerId);
            document.getElementById("pv-card-img").src = e.img;
            document.getElementById("pv-card-img").style.filter = e.status === "dead" ? "grayscale(1) brightness(.7)" : "";
            document.getElementById("pv-card-kind").textContent = t("PERSONA.Kind.npc") + (e.status !== "alive" ? ` · ${t(`PERSONA.Status.${e.status}`)}` : "");
            document.getElementById("pv-card-name").textContent = named ? e.name : "???";
            document.getElementById("pv-card-title").textContent = named ? e.title : "";
            document.getElementById("pv-card-text").textContent = lang === "en" ? "This is Persona's card (no Actor sheet). Click outside to close." : "Este é o cartão do Persona (nunca a ficha do ator). Clique fora para fechar.";
            document.getElementById("pv-card").hidden = false;
        },
        selectPlayer(id) { S.gmOwner = id; S.momentId = null; view.refresh(); },
        selectMoment(id) { S.momentId = id; view.refresh(); },
        recordMoment() {
            const label = prompt(t("PERSONA.Bonds.RecordHint"), t("PERSONA.Bonds.MomentDefault").replace("{n}", S.moments.length + 1));
            if (!label) return;
            S.moments.push({ id: `m${Date.now()}`, label, ts: Date.now(), wheels: JSON.parse(JSON.stringify(S.wheels)), statuses: Object.fromEntries(S.entries.map(e => [e.id, e.status])) });
            view.refresh();
        },
        deleteMoment(id) { S.moments = S.moments.filter(m => m.id !== id); S.momentId = null; view.refresh(); }
    };

    const role = document.getElementById("pv-role");
    role.innerHTML = PLAYERS.map(p => `<option value="${p.id}">${p.name} (${p.character})</option>`).join("") + `<option value="gm">Mestre (GM)</option>`;
    role.addEventListener("change", () => { S.role = role.value; S.momentId = null; view.refresh(); });
    document.getElementById("pv-lang").addEventListener("change", e => {
        lang = e.target.value;
        document.getElementById("pv-title").textContent = t("PERSONA.Bonds.Title");
        view.refresh();
    });
    document.getElementById("pv-reset").addEventListener("click", () => { const r = S.role; S = fresh(); S.moments = seedMoments(); S.role = r; view.refresh(); });
    document.getElementById("pv-card").addEventListener("click", () => { document.getElementById("pv-card").hidden = true; });

    const view = new BondsView(document.getElementById("bonds-root"), adapter);
    window.__bonds = { view, state: () => S };
})();
