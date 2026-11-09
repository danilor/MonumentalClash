# Monumental Clash

An offline, single-player browser strategy game: you play one human against one computer opponent.
It is built with [Phaser 3](https://phaser.io) and adapts the rules of a published civilization board game (the "printed game"
in this document), following the rulebook in [`source/rulebook.pdf`](source/rulebook.pdf).

All artwork is drawn by the game itself when it starts, so there are no image or sound files to download and
nothing to host except `dist/index.html` and `dist/game.js`.

> Monumental Clash is an unofficial fan project. It is not affiliated with or endorsed by the designers or publisher of the board game it adapts.

![A game in Age V](docs/screenshot.png)

## Run it

You need Node.js 22 or newer (developed on Node 24).

```
npm install
npm run build
```

Then open `dist/index.html` in a current desktop browser (tested with Microsoft Edge). It works straight from disk; no web server is needed.

For development, `npm start` serves the game at <http://localhost:8080> and rebuilds when a file changes.

The game saves itself after every action. Choose **Continue game** on the title screen to carry on.

## How to play

The window is 1280×720 and scales to fit. The short version, which is also in the game under **Rules**:

* A game lasts six Ages of three rounds each by default. On the title screen, **Game length** lets you choose anywhere from 4 to 12 Ages before you start a new game. Every turn you take up to **3 actions** and then press **End Turn**.
* Click one of your cities or units to select it; the panel on the right lists what it can do. With units selected,
  click a highlighted space to move (green), attack (red), explore (yellow) or sail and board (blue).
* **Advance**, **Cards** and **Abilities** at the bottom open the research window, your hand and the powers you have unlocked.
* Hover over almost anything for an explanation. Disabled buttons say why they are disabled.
* **Esc** closes the top window or cancels the current selection. **Menu** (top right) saves, restarts and changes the animation speed.
* After the Status Phase of the last Age the player with the most Victory Points wins. The game also ends early if one player has no cities left.

## What is in the game

The complete two-player base game, rule for rule:

* Setup, the hexagonal map of ten face-down Regions with an outer Sea ring, and exploring new Regions (you choose the orientation when the rules allow a choice).
* The Ages (6 by default, 4 to 12 if you choose), 3 rounds, 3 actions per turn and the full Status Phase: Objectives, free Advance, drawing cards, razing a city, changing Government and choosing the first player.
* Every main action: Advance, Found City, Collect, Construct, Recruit, Move, Influence, Increase Happiness, Wonder, Action cards.
* Resources, the Food limit, Culture and Mood tokens, city size and capacity, city Mood and the effects of activating a city more than once per turn.
* All 48 Advances in 12 categories, including the three Governments, and the 8 Wonders.
* Movement over Forest, Mountain, Roads, Ships with Navigation, carrying units, and stack limits.
* Combat with dice, hits, Fortresses, Warships, combat cards, retreats and sieges, plus capturing cities.
* Barbarians, Events and Event icons, Objective cards, the Great Pyramid tie-break and the final scoring.

Details that are easy to get wrong are covered too, each with its own regression test:

* Port cities may collect Gold or a Mood token from the Sea; Fishing gives Mood, Navigation gives Culture, Warships and Cartography give nothing.
* Changing Government costs 1 Culture token and 1 Mood token. Dogma's free Theocracy Advance is optional, and State Religion's free Food only applies to the first Temple of a turn.
* A city never grows past size 5, nor past the number of cities its owner holds. Monuments protect Wonder cities from enemy Influence only.
* The Great Library lends one Advance for the turn (its discounts and Food limit end with the turn). The Great Mausoleum lets its owner take the top discard instead of drawing.
* Barbarians: you choose the order in which their armies advance, a Barbarian city is worth a flat 1 Gold, and beating Barbarian units adds 1 more.
* Fanaticism only places its free Infantry in a city with room for it, and the owner of overloaded Ships decides which unit is left behind after a naval battle.

### Differences from the printed game

* Only 1 human against 1 computer.
* The game can be set to last from 4 to 12 Ages. The printed game always lasts 6.
* The *Civilizations* expansion content (Civilizations, Leaders, Market, Obelisk, Observatory, Cavalry, Elephants) and the Pirates are not included.
* The rulebook does not list every card. The Action, Objective and Event cards and the Advance descriptions are original reconstructions
  written for this project to match the mechanics in the rulebook. They do not match the printed cards one for one.
* You may press **End Turn** before using all 3 Main Actions (the rulebook says you must perform 3), so you are never forced into a pointless or harmful action.
* A player's last city cannot be razed in the Status Phase, which would end the game by accident.
* The artwork is simple and generated in the browser.

### The computer opponent

The computer lists the sensible actions available to it, plays each one out on a copy of the game (several times when dice
or unseen cards are involved, with everything it could not see reshuffled), and keeps the one that improves its position
most. It uses exactly the same rules interface as you do.

## For developers

```
src/engine   the rules, with no dependency on Phaser. Actions are generators that ask questions through prompts.
src/ai       the computer opponent
src/ui       the Phaser scenes, dialogs and drawing code
test         the automated tests and development scripts
```

* `npm test` runs the whole suite: rules scenarios, scoring, saving and loading, random-play fuzzing, computer-vs-computer games,
  regression tests for the rule details listed above (`test/fidelity.test.mjs`) and a browser smoke test. The browser test needs `npm run build` first and a Chrome or Edge install (set `BROWSER_PATH` if it is in an unusual place); it is skipped otherwise.
* `npm run simulate -- 6 1 --check` plays 6 computer-vs-computer games from seed 1 and checks the game state after every action. Add `--ages=N` (4 to 12) to change the game length.
* `node test/fuzz.mjs 1 50` plays 50 random games to look for rule violations (also accepts `--ages=N`).
* `node test/shot.mjs out.png "?seed=7"` takes a screenshot of the built game. A numeric `?seed=` in the address starts a game with that seed straight away.
* `?debug=textures` shows every generated texture.
* In the browser console `__game`, `__ctl` and `__phaser` give access to the game state, the controller and Phaser.

Browsers without a GPU (headless runs, software rendering) are slow for the first ten seconds or so because Phaser
holds back its clock while it starts up; this is not a bug and goes away on normal machines.
