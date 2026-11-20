/**
 * The handout moment: when the GM shows someone to a player, the scene dims, a glass band opens on
 * a gold thread, the portrait slides in and the name writes itself. Click "Open card" (or anywhere)
 * to see the card, "Later" (or Esc) to keep it in the gallery for afterwards.
 */
const t = key => game.i18n.localize(key);
const escape = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

let current = null;

/** Plays the introduction; resolves to "open" or "later". */
export function playIntro({ img, frame = "", name, title = "", kicker = "", color = "#d4b25a" }) {
    current?.finish("later");
    return new Promise(resolve => {
        const root = document.createElement("div");
        root.className = "persona persona-intro";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label", name);
        root.style.setProperty("--accent", color);
        let i = 0;
        const letters = escape(name).split(" ").map(word =>
            `<span class="persona-intro__word">${[...word].map(ch => `<span style="--i:${i++}">${ch}</span>`).join("")}</span>`).join(" ");
        root.innerHTML = `
            <div class="persona-intro__dim"></div>
            <div class="persona-intro__band"></div>
            <div class="persona-intro__inner">
                <div class="persona-intro__portrait"><img class="persona-fit" src="${escape(img)}" style="${escape(frame)}" alt="" draggable="false"></div>
                <div class="persona-intro__text">
                    <div class="persona-intro__kicker"><span class="persona-dot" style="--dot: ${escape(color)}"></span><span class="persona-eyebrow">${escape(kicker)}</span></div>
                    <h1 class="persona-intro__name">${letters}</h1>
                    ${title ? `<p class="persona-intro__title">${escape(title)}</p>` : ""}
                    <div class="persona-intro__actions">
                        <button type="button" class="persona-button" data-intro="open">${t("PERSONA.Codex.OpenCard")}</button>
                        <button type="button" class="persona-mini" data-intro="later">${t("PERSONA.Codex.Later")}</button>
                    </div>
                </div>
            </div>`;
        const finish = choice => {
            if (root.classList.contains("is-out")) return;
            root.classList.add("is-out");
            document.removeEventListener("keydown", onKey, true);
            current = null;
            setTimeout(() => root.remove(), 500);
            resolve(choice);
        };
        const onKey = event => {
            if (event.key === "Escape") { event.stopPropagation(); finish("later"); }
            else if (event.key === "Enter") finish("open");
        };
        root.addEventListener("click", event => {
            const pick = event.target.closest("[data-intro]")?.dataset.intro;
            finish(pick ?? "open");
        });
        document.addEventListener("keydown", onKey, true);
        document.body.append(root);
        requestAnimationFrame(() => root.classList.add("is-in"));
        root.querySelector('[data-intro="open"]')?.focus({ preventScroll: true });
        current = { finish };
    });
}
