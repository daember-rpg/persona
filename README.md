# Persona (Alpha)

The people and places of your story, revealed when you choose. Players keep a gallery of everyone they have met, with cards and notes, and arrange them on their own **Bonds** wheel; the GM shows cards to players like handouts and plays full-screen videos for the whole table, and hands out letters, decrees, notes and torn maps sealed with wax that players break open. System-agnostic, Foundry VTT V13/V14.

## Install
Manifest URL: `https://raw.githubusercontent.com/daember-rpg/persona/main/module.json`

Third module of the Triad suite (Triad · First Strike · Persona). Works on its own as a window, or as a tab in Triad's tray. Its look follows the suite's shared design (Triad 0.9 / Kronos): smoked glass, hairlines, pills and one gold thread for what matters now.

## Access
- **Scene control**: masks button in the Token controls.
- **Keybinding**: `Alt+P` (editable in Configure Controls).
- **Triad**: a masks tab in the tray (setting *Show as a Triad tab*). A dot appears when a player has something new.
- **Bonds**: the circle-nodes button in the panel header (in the window and in the Triad tab). Optional keybinding in Configure Controls.
- API: `game.modules.get("persona").api` → `open()`, `close()`, `toggle()`, `openCard(id)`, `openBonds(userId?)`, `playVideo(path, title, subtitle)`, `stopVideo()`.

## GM: the Director
- **Add** people and places by dragging an **Actor** (name + portrait), a **Journal entry or page** (name + text + first image page) or a **Scene** (place) onto the panel, or with **+**.
- **Reveal in layers**: Face → Name → Story → Secret. Each row shows the state of every layer (green = everyone, gold with a count = some players, crossed eye = hidden). Click it to open the **reveal grid**: one eye per layer and player, plus an *Everyone* column, and *Show everything to everyone* / *Hide from everyone*. Showing a layer also shows the ones above it; hiding one hides the ones below.
- **Arrange by drag and drop**: drag a row to reorder it, onto another row in a different folder to move it there, or onto a folder header to drop it in that folder (*No group* takes it out of the folder it came from). Drag folder headers to reorder folders. Players see the same order. (Off while searching.)
- Everything starts **hidden**. Once revealed, it stays in that player's gallery.
- **Folders**: groups (Khaledyn's elves, the champions of Kurdrax, a city, a chapter…) with a colour, created in the editor. The colour marks the group's folder, filter and card tags, and is the colour of its slice on every Bonds wheel (players can still recolour their own slice); click a group's dot in the editor to change it. With no filter, the panel shows one collapsible folder per group, then *No group*. Players see the same folders with what they know.
- **People and places**: link a person to the places where they live or appear (or, from a place, pick its people). The place's card shows *People here*; a person's card lists their places. Players only see the links to what they know.
- **Portrait from the Journal**: with no image set, the first image of the linked Journal page is used. Pictures inside the story are hidden on the card, since the portrait already shows them.
- **Framing**: in the editor, drag the picture and use the zoom slider to choose exactly what players see; the same framing is used in the gallery, the rows, the links and the card.
- **Journal stays the source**: link a page and the card's story follows it (copied into the entry, so players don't need Journal permissions). Journal secret blocks stay GM-only. Turn off *Update the story…* to write your own text.
- **Show (handout)**: *Show* on a row (or *Show to* on the card) opens that card on the screens of everyone or one player, like a handout. Their face and name are revealed to them first, so the card stays in their gallery.
- **Video**: give an entry an mp4/webm (saved as soon as you pick it) and press *Play for everyone* on its card, or the film button on its row; the eye on the card watches it alone first. The film button at the top plays any file. Full screen, title card, synced for everyone from the server clock (late joiners land at the right moment). Pause, restart, stop for everyone.

## Documents: letters, decrees, notes and torn maps
In-world papers the party can hold, read and keep — drawn on aged paper in the Embermark look, not shown as a plain card.
- **Create** one with **+** while the *Documents* filter is on (or pick *Document* in the editor), or drop a **Journal page** on the panel with the *Documents* filter on: its text becomes the document's text.
- **Paper**: *Letter* (a single sheet in an old printer's hand), *Decree* (ruled double border, a red initial, the title set in small capitals), *Note* (a torn scrap in a hurried hand) or *Torn map* (your picture with torn edges; the text becomes its caption). Each has a place and date line and a signature in script.
- **Wax seal**: on by default, in crimson, black, gold, green, blue or violet, with initials or a mark (crown, tower, skull, eye, dragon…) pressed in. The first time a player opens it, the letter arrives folded with the seal across the fold; they click the seal, it cracks and falls away in two halves, the folds open and the writing comes up. The broken seal stays by the signature, and the seal is broken for that player from then on. (The GM can *Seal it again* on their own screen to watch it once more.)
- **Hidden passage**: a part of the text only shown once you reveal it — after a check, a cipher solved, a candle held to the paper. Until then players can see smudged, unreadable lines where it sits (turn that off to keep it a surprise). When revealed, it surfaces in a different ink.
- **Who has it**: a document has two layers in the Director: *Has it* (the whole document) and *Hidden passage*. *Show* hands it to everyone or one player and opens it on their screens, sealed.
- **Party documents**: every document a player has lands in one folder at the top of their gallery, apart from the factions' folders, with a small paper showing whether it's still sealed. Notes (private and party) work as on cards.

## Bonds: each player's relationship wheel
Inspired by the *People* screen of Final Fantasy XVI. Drawn as an engraved astrolabe: hairline gold structure, faction colour as a lit arc on the rim, links as fine trails of light, portraits as medallions; the dial turns into place when the window opens.
- **One wheel per character of the story**: every player character sheet (type *character* owned by a player, or a player's assigned character) starts as its own character. A player with several characters switches between them with the chips at the top, and selecting one of their tokens opens that character's wheel (the GM: any player character's).
- **Same person, several sheets**: in *Characters* (GM), point a sheet at another character — the same hero in another reality, another class — and both sheets share one wheel. The centre shows the sheet in use; the inspector lists all of them.
- **Retire at the end of a chapter**: *Retire* in *Characters* keeps a character's wheel, read-only, under *Past characters* and takes them off the party ring; new characters start fresh. *Bring back* undoes it.
- **Centre**: the character. **Inner ring**: the rest of the party, always there and always close.
- **Slices come from the Persona folders**: drag a portrait onto the wheel and the person lands in their folder's slice (the GM's tags, in folder order; people without a folder go to *No folder*). The ring you drop on sets the distance: Close (inner), Known, Distant (outer). *Put everyone on the wheel* drops all the rest on the outer ring.
- **Name the slices your way**: click any slice's name to give it your own name and colour on your wheel ("Kurdrax" can be "The Burning Court" for you). Everyone else keeps their own, and the GM's folder isn't changed; *Use the folder's name* undoes it.
- **Categories of their own**: while dragging, drop on *create a category of your own* to start one ("don't trust", "owes us a favour"…) with a name and colour; drop anyone onto it to add them. Click its label to rename, recolour or dissolve it (people go back to their folders).
- **Never empty**: a slice or category with nobody in it disappears.
- **Take off**: drag a portrait back to the list (or past the rim).
- **Reading the wheel**: closer people have bigger portraits (distant ones smaller and dimmer); the rings' names are engraved along a spoke; each slice shows how many people it holds and glows under the pointer or when someone in it is in focus. Links from the centre are one continuous line that leaves straight out between the party portraits and bends toward its target once past the party band. Link icons sit next to the person they describe, never piled up or on a portrait, and stay small coloured beads until hovered or in focus.
- **Inspector**: click a portrait to select it. The side panel shows who they are, their distance (change it in one click — or put someone on the wheel without dragging), their bonds, *Link to someone*, *Open card* and *Take off the wheel*. Double-click opens the Persona card. Click the empty wheel or press Escape to deselect.
- **Focus**: hovering or selecting someone lights up them and everyone they're bound to, and dims the rest.
- **Links**: *Link to someone* in the inspector, then click the other portrait (people, party members or yourself) and pick ally, family, love, rival, enemy, serves or betrayed. Serves and betrayed have a direction (flip it from the link). With many links, their icons only show for the person in focus.
- **Notes and suspicions**: every link can carry one line of why ("owes us 50 gold") and be marked as a suspicion (dashed) until the player is sure.
- **Official links (GM)**: when the GM links two people, *Official* puts that link on every wheel that knows both of them, with a seal; players can't change it. *Hidden* keeps it to the GM until unticked.
- **Since you last looked**: when a player opens their wheel, a card lists new people, deaths and disappearances, and newly revealed official links; those portraits glow until they press *Got it*.
- **In scene**: filters the wheel to the people with a token on the current scene (matched by their linked Actor); they also come first in the off-wheel list.
- **Pins**: star someone in the inspector to keep them at the top of the list and marked on the wheel.
- **Archive**: people who left the story go to a folded *Archive* at the bottom of the list — off the wheel, still in the timeline. *Restore* brings them back.
- **What the party thinks**: the inspector shows where the other players keep the same person (distance only; never their notes or categories).
- **GM overview**: *Overview* shows every person the players know against every player — not revealed, not placed, or how close — with pins and link counts. Click a cell to open that player's wheel on that person.
- **Timeline that tells the story**: each moment lists what changed on that wheel since the one before (who joined, who died or went missing, who moved closer or farther), and those portraits are highlighted while looking back.
- **Moment prompts**: Persona never records a moment on its own. A world setting (off by default) can have it ask the GM — at the start of a session (the first login 6 hours after the last moment or question), after each combat, or both — with the name ready to edit or decline.
- **Save as image**: the image button saves the wheel as a PNG with every portrait and name, to share at the end of an arc.
- **Live moments**: with the wheel open, someone the GM just revealed flies into the list with an ember glow; someone who just died drains to grey with a pale flash before the skull sets in; someone who went missing blurs out. (Respects reduced motion.)
- **The party** sits on a gold thread inside an engraved band; names show on hover, like everyone else's.
- **Link style (per user)**: the curve button by the zoom controls sets how *your* links are drawn — curved, with a slider from straight to loose, or angular, following the rings of the wheel — and whether lines show always or only for the person in focus.
- **Built for a whole campaign**: when a ring fills up it gains another lane and the wheel grows outward instead of stacking portraits; narrow slices shorten their names; *Find on the wheel* centres and selects someone; *Hide the dead* thins out a long campaign.
- **Only what they know**: the wheel only offers people whose face was revealed to that player, with the name hidden until the name is revealed. Clicking a portrait opens the Persona card — never the Actor or its sheet.
- **Status**: the GM sets *Alive / Dead / Missing* in the entry editor. Dead people turn grey with a skull, missing ones fade with a question mark — on every wheel, the gallery and the card.
- **Party wheels**: *Party wheels* lets a player look at the wheels the rest of the party shares — read-only, showing only the people the viewer knows too (as the viewer knows them). Each player chooses in the link-style panel whether their wheel is shared (default) or only theirs.
- **Note privacy**: each link note is *Only me* (default) or *Everyone*; private notes never show on someone else's screen. The GM sees everything.
- **Editing**: players change only their own wheel. The GM can open and edit anyone's from the player chips (the player sees the changes live).
- **Timeline**: the GM presses *Record moment* (e.g. at the end of a session). It saves every wheel and every status at that point. Players click a moment on the timeline to see their wheel as it was then — who was still alive, who they hadn't met yet.

## Players: the gallery
- People and places they know, with **New** marks and a notice when the GM reveals something. An eye marks things only they know.
- **Card** (X, Esc or click outside to close): portrait, name, title, groups, story, secret (when uncovered), *Watch again* for linked videos (just for them).
- **Notes**: *My notes* (private, saved as you type) and *Party notes* (shared, with author; authors and the GM can delete).

## Requirements
- **socketlib** for party notes written by players (the GM's client saves them). Everything else works without it.
- A GM online for party notes.

## Data
World settings (GM writes): `entries`, `groups`, `video`, `sharedNotes`, `handout`, `moments`, `officialLinks`, `characters` (same-person links and retired characters). Per user (flags, written by the player): `seen`, `opened` (documents whose seal they broke), `notes`, `wheels` (one per character key; `bonds` from before 0.12 is read as the assigned character's wheel), `bondsSeen`. Note that, as with any Foundry module, world settings reach every client, so a determined player could read hidden entries from the console.

## Structure
```
scripts/
  main.js        hooks, scene control, keybinding, Triad dock, live updates
  constants.js   MODULE_ID and defaults
  settings.js    settings registration (changes broadcast as "persona.changed")
  store.js       entries, groups, reveal rules (pure), handouts, per-user state
  documents.js   papers, wax colours and marks, torn edges and the seal drawing (pure)
  relay.js       socketlib relay for party notes
  view-data.js   template contexts (read-only)
  entries.js     create from drops, Journal sync
  panel.js       the panel view (window or Triad tab)
  card.js        person/place card overlay
  editor.js      GM entry editor
  video.js       synced full-screen video
  toasts.js      reveal notices
  bonds/
    model.js     Bonds data and geometry (pure, no Foundry)
    view.js      the wheel (framework-free DOM, shared with the preview)
    app.js       Bonds window, Foundry adapter, moments
    characters.js  characters of the story: sheets, same person, retired; where each wheel lives
templates/       panel, card, editor + partials
styles/          persona.css (Embermark)
lang/            en
dev/             bonds-preview.html and panel-preview.html (standalone previews, not shipped; the panel preview has a Documents tab) and their build scripts
```

## Credits
Inspired by the idea behind **Cast & Scene** by Dungeon Maxter. Persona is an independent, ground-up implementation; no Cast & Scene code or assets are used.
