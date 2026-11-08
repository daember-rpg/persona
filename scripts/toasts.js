/**
 * Small Embermark notices for players when the GM reveals something to them.
 * Clicking one opens the card.
 */
const MAX = 3;
const LIFETIME = 6000;

export class Toasts {
    #box = null;

    constructor({ openCard }) {
        this.openCard = openCard;
    }

    #ensure() {
        if (this.#box) return this.#box;
        const box = document.createElement("div");
        box.id = "persona-toasts";
        box.className = "persona persona-toasts";
        box.setAttribute("role", "status");
        box.addEventListener("click", event => {
            const toast = event.target.closest("[data-id]");
            if (!toast) return;
            this.openCard(toast.dataset.id);
            toast.remove();
        });
        document.body.append(box);
        this.#box = box;
        return box;
    }

    show({ id, img, label, name }) {
        const box = this.#ensure();
        box.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
        const toast = document.createElement("button");
        toast.type = "button";
        toast.className = "persona-toast";
        toast.dataset.id = id;
        toast.innerHTML = `<img alt="" draggable="false"><span><b></b><span></span></span>`;
        toast.querySelector("img").src = img;
        toast.querySelector("b").textContent = label;
        toast.querySelector("span > span").textContent = name;
        box.prepend(toast);
        while (box.children.length > MAX) box.lastElementChild.remove();
        setTimeout(() => {
            toast.classList.add("is-leaving");
            setTimeout(() => toast.remove(), 400);
        }, LIFETIME);
    }
}
