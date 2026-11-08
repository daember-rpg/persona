export const MODULE_ID = "persona";
export const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

/** Reveal layers, in order: a later layer always implies the earlier ones. */
export const LAYERS = ["face", "name", "summary", "secret"];

/** Audience token meaning "every player". */
export const ALL = "all";

export const KINDS = ["npc", "place"];

export const GROUP_ICONS = [
    "fa-solid fa-city", "fa-solid fa-landmark", "fa-solid fa-crown", "fa-solid fa-hammer",
    "fa-solid fa-mask", "fa-solid fa-route", "fa-solid fa-bookmark", "fa-solid fa-tree",
    "fa-solid fa-dungeon", "fa-solid fa-ship", "fa-solid fa-scroll", "fa-solid fa-skull"
];

export const DEFAULT_VIDEO = {
    nonce: null,       // changes on every play, so a client can dismiss one showing locally
    path: "",
    title: "",
    subtitle: "",
    startedAt: 0,      // game.time.serverTime when playback (re)started
    offset: 0,         // seconds into the video at startedAt
    paused: false
};
