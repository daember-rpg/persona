/**
 * Settings. Shared state lives in hidden world settings (written by the GM, synced to every
 * client by Foundry); per-user state (notes, what you've seen) lives in the user's own flags.
 * Every change is broadcast locally as the "persona.changed" hook, which the UI listens to.
 */
import { MODULE_ID, DEFAULT_VIDEO } from "./constants.js";

const changed = key => value => Hooks.callAll(`${MODULE_ID}.changed`, key, value);

export function registerSettings() {
    const hidden = (key, def) => game.settings.register(MODULE_ID, key, {
        scope: "world",
        config: false,
        type: Object,
        default: def,
        onChange: changed(key)
    });
    hidden("entries", {});
    hidden("groups", {});
    hidden("video", foundry.utils.deepClone(DEFAULT_VIDEO));
    hidden("sharedNotes", {});
    hidden("handout", {});
    hidden("moments", {});
    hidden("officialLinks", {});

    game.settings.register(MODULE_ID, "dockInTriad", {
        name: "PERSONA.Settings.dockInTriad.Name",
        hint: "PERSONA.Settings.dockInTriad.Hint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true
    });
    game.settings.register(MODULE_ID, "videoVolume", {
        name: "PERSONA.Settings.videoVolume.Name",
        hint: "PERSONA.Settings.videoVolume.Hint",
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0.8,
        onChange: changed("videoVolume")
    });
    // Folders collapsed in the panel (per client).
    game.settings.register(MODULE_ID, "collapsed", {
        scope: "client",
        config: false,
        type: Object,
        default: {}
    });
    // Bonds: how this user likes links drawn (curve or angular, how much curves bend, when shown).
    game.settings.register(MODULE_ID, "bondsLinkStyle", {
        scope: "client",
        config: false,
        type: Object,
        default: { shape: "curve", bend: 0.5, show: "always" }
    });
    // Bonds: record a moment on the timeline without thinking about it.
    game.settings.register(MODULE_ID, "autoMoment", {
        name: "PERSONA.Settings.autoMoment.Name",
        hint: "PERSONA.Settings.autoMoment.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            off: "PERSONA.Settings.autoMoment.off",
            session: "PERSONA.Settings.autoMoment.session",
            combat: "PERSONA.Settings.autoMoment.combat",
            both: "PERSONA.Settings.autoMoment.both"
        },
        default: "session"
    });
    game.settings.register(MODULE_ID, "revealToasts", {
        name: "PERSONA.Settings.revealToasts.Name",
        hint: "PERSONA.Settings.revealToasts.Hint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });
}

export function getSetting(key) {
    return game.settings.get(MODULE_ID, key);
}

export function setSetting(key, value) {
    return game.settings.set(MODULE_ID, key, value);
}
