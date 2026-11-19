export const MODULE_ID = "persona";
export const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

/** Reveal layers, in order: a later layer always implies the earlier ones. */
export const LAYERS = ["face", "name", "summary", "secret"];

/** Audience token meaning "every player". */
export const ALL = "all";

export const KINDS = ["npc", "place", "document"];

/** Icons for a new group, with the name shown on hover (PERSONA.Group.Icons.<name>). */
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
