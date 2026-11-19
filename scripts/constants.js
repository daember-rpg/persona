export const MODULE_ID = "persona";
export const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

/** Reveal layers, in order: a later layer always implies the earlier ones. */
export const LAYERS = ["face", "name", "summary", "secret"];

/** Audience token meaning "every player". */
export const ALL = "all";

export const KINDS = ["npc", "place", "document"];

/**
 * A group's colour: shown on its folder, its filter, cards, and as its slice on every Bonds wheel.
 * Same palette (and order) as the Bonds slices, so worlds from before 0.18 keep their wheel colours.
 */
export const GROUP_COLORS = ["#b4643e", "#74864a", "#4f7a8a", "#8a5a8f", "#c9a35a", "#c8452f", "#5d6b9a", "#857a65"];

/** Icons groups were given before 0.18 (kept in the data, no longer chosen). */
export const GROUP_ICON_NAMES = {
    "fa-solid fa-city": "city", "fa-solid fa-landmark": "temple", "fa-solid fa-crown": "nobility", "fa-solid fa-hammer": "guild",
    "fa-solid fa-mask": "secret", "fa-solid fa-route": "journey", "fa-solid fa-bookmark": "chapter", "fa-solid fa-tree": "wilds",
    "fa-solid fa-dungeon": "dungeon", "fa-solid fa-ship": "sea", "fa-solid fa-scroll": "lore", "fa-solid fa-skull": "enemies"
};
export const GROUP_ICONS = Object.keys(GROUP_ICON_NAMES);

export const DEFAULT_VIDEO = {
    nonce: null,       // changes on every play, so a client can dismiss one showing locally
    path: "",
    title: "",
    subtitle: "",
    startedAt: 0,      // game.time.serverTime when playback (re)started
    offset: 0,         // seconds into the video at startedAt
    paused: false
};
