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
    hidden("characters", {});

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
    // Players' gallery: "list" (codex rows) or "grid" (portrait tiles), per client.
    game.settings.register(MODULE_ID, "galleryLayout", {
        scope: "client",
        config: false,
        type: String,
        default: "list"
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
    // Bonds: offer to record a moment (the GM always decides; nothing is recorded on its own).
    // A new key, so worlds that had 0.13–0.16's automatic recording stop it after updating.
    game.settings.register(MODULE_ID, "momentPrompt", {
        name: "PERSONA.Settings.momentPrompt.Name",
        hint: "PERSONA.Settings.momentPrompt.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            off: "PERSONA.Settings.momentPrompt.off",
            session: "PERSONA.Settings.momentPrompt.session",
            combat: "PERSONA.Settings.momentPrompt.combat",
            both: "PERSONA.Settings.momentPrompt.both"
        },
        default: "off"
    });
    // Last time the GM was asked at login, so leaving and coming back doesn't ask again.
    game.settings.register(MODULE_ID, "momentPromptSeen", { scope: "world", config: false, type: Number, default: 0 });
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
