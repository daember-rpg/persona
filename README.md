# Persona (Alpha)

The people and places of your story, revealed when you choose. Players keep a gallery of everyone they have met, with cards and notes; the GM shows cards to players like handouts and plays full-screen videos for the whole table. System-agnostic, Foundry VTT V13/V14.

Third module of the Triad suite (Triad · First Strike · Persona). Works on its own as a window, or as a tab in Triad's tray.

## Access
- **Scene control**: masks button in the Token controls.
- **Keybinding**: `Alt+P` (editable in Configure Controls).
- **Triad**: a masks tab in the tray (setting *Show as a Triad tab*). A dot appears when a player has something new.
- API: `game.modules.get("persona").api` → `open()`, `close()`, `toggle()`, `openCard(id)`, `playVideo(path, title, subtitle)`, `stopVideo()`.

## GM: the Director
- **Add** people and places by dragging an **Actor** (name + portrait), a **Journal entry or page** (name + text + first image page) or a **Scene** (place) onto the panel, or with **+**.
- **Reveal in layers**: Face → Name → Story → Secret. Each row shows the state of every layer (green = everyone, gold with a count = some players, crossed eye = hidden). Click it to open the **reveal grid**: one eye per layer and player, plus an *Everyone* column, and *Show everything to everyone* / *Hide from everyone*. Showing a layer also shows the ones above it; hiding one hides the ones below.
- Everything starts **hidden**. Once revealed, it stays in that player's gallery.
- **Folders**: groups (Khaledyn's elves, the champions of Kurdrax, a city, a chapter…) with an icon, created in the editor. With no filter, the panel shows one collapsible folder per group, then *No group*. Players see the same folders with what they know.
- **People and places**: link a person to the places where they live or appear (or, from a place, pick its people). The place's card shows *People here*; a person's card lists their places. Players only see the links to what they know.
- **Portrait from the Journal**: with no image set, the first image of the linked Journal page is used. Pictures inside the story are hidden on the card, since the portrait already shows them.
- **Framing**: in the editor, drag the picture and use the zoom slider to choose exactly what players see; the same framing is used in the gallery, the rows, the links and the card.
- **Journal stays the source**: link a page and the card's story follows it (copied into the entry, so players don't need Journal permissions). Journal secret blocks stay GM-only. Turn off *Update the story…* to write your own text.
- **Show (handout)**: *Show* on a row (or *Show to* on the card) opens that card on the screens of everyone or one player, like a handout. Their face and name are revealed to them first, so the card stays in their gallery.
- **Video**: give an entry an mp4/webm and press *Video*, or the film button to play any file. Full screen, title card, synced for everyone from the server clock (late joiners land at the right moment). Pause, restart, stop for everyone.

## Players: the gallery
- People and places they know, with **New** marks and a notice when the GM reveals something. An eye marks things only they know.
- **Card** (X, Esc or click outside to close): portrait, name, title, groups, story, secret (when uncovered), *Watch again* for linked videos (just for them).
- **Notes**: *My notes* (private, saved as you type) and *Party notes* (shared, with author; authors and the GM can delete).

## Requirements
- **socketlib** for party notes written by players (the GM's client saves them). Everything else works without it.
- A GM online for party notes.

## Data
World settings (GM writes): `entries`, `groups`, `video`, `sharedNotes`, `handout`. Per user (flags): `seen`, `notes`. Note that, as with any Foundry module, world settings reach every client, so a determined player could read hidden entries from the console.

## Structure
```
scripts/
  main.js        hooks, scene control, keybinding, Triad dock, live updates
  constants.js   MODULE_ID and defaults
  settings.js    settings registration (changes broadcast as "persona.changed")
  store.js       entries, groups, reveal rules (pure), handouts, per-user state
  relay.js       socketlib relay for party notes
  view-data.js   template contexts (read-only)
  entries.js     create from drops, Journal sync
  panel.js       the panel view (window or Triad tab)
  card.js        person/place card overlay
  editor.js      GM entry editor
  video.js       synced full-screen video
  toasts.js      reveal notices
templates/       panel, card, editor + partials
styles/          persona.css (Embermark)
lang/            en, pt-BR
```

## Credits
Inspired by the idea behind **Cast & Scene** by Dungeon Maxter. Persona is an independent, ground-up implementation; no Cast & Scene code or assets are used.
