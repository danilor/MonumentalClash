# Monumental Clash

A turn-based civilization strategy game for your web browser. You lead a young civilization against a computer-controlled rival:
explore a hidden map, found and grow cities, research Advances, raise Wonders and fight for the most Victory Points before the last Age ends.

It runs completely offline and is built with [Phaser 3](https://phaser.io). Its rules adapt a published civilization board game
(called "the printed game" in this document) and follow the rulebook in [`source/rulebook.pdf`](source/rulebook.pdf).

![A game in Age V](docs/screenshot.png)

**Contents:** [About the game](#about-the-game) · [Run it](#run-it) · [How to play](#how-to-play) · [What has been implemented](#what-has-been-implemented) · [What is still to do](#what-is-still-to-do) · [For developers](#for-developers)

## About the game

You and the computer each begin with one city, one Settler, 2 Food and the Advances Farming and Mining, in your own region of a small hexagonal world:
ten regions of four spaces each, surrounded by a ring of Sea. Regions you have not seen are face-down until one of your units gets next to them.
Over a number of **Ages** you:

* explore the map and found new cities,
* collect Food, Wood, Ore, Ideas and Gold, and keep your cities happy,
* research Advances (48 in 12 categories) that unlock buildings, units and special powers,
* build Wonders and complete Objectives,
* defend yourself against the other civilization and the Barbarians, or attack them.

When the last Age ends, the player with the most **Victory Points (VP)** wins.

* **Players:** you (Blue) against the computer (Red). The Barbarians (purple) are played by the game.
* **Length:** 4 to 12 Ages, 6 by default. An Age is three rounds plus a Status Phase, so a default game is 18 turns for each player.
* **A turn:** up to 3 actions, then **End Turn**.
* **Content:** 48 Advances in 12 categories (three of them are Governments), 8 Wonders, 42 Action cards, 26 Objective cards and 18 Event cards.
* **Artwork:** drawn by the game itself when it starts, so there are no image or sound files to download and
  nothing to host except `dist/index.html` and `dist/game.js`.

> Monumental Clash is an unofficial fan project. It is not affiliated with or endorsed by the designers or publisher of the board game it adapts.

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

Everything below is also in the game: press **Rules** (top right of the board) or **How to play** (title screen and Menu).

### Starting a game

The title screen has four controls:

* **New game** starts a game at once. The first time, the how-to-play window opens over the map; press **Esc** to close it.
* **Continue game** appears when a saved game exists and carries on where you stopped. It shows the saved Age and round.
* **Game length** (**-** and **+**) sets how many Ages the next new game lasts, from 4 to 12 (6 by default). The choice is remembered. Restarting from the in-game Menu keeps the length of the game you were playing.
* **How to play** opens the rules window.

### The goal

Have the most **Victory Points (VP)** when the last Age ends. Hover over a player's VP badge at any time to see where the points come from.

* 1 VP for every city and 1 VP for every building (Academy, Fortress, Port, Temple).
* ½ VP for every Advance you have researched.
* 2 VP for every Objective card you have completed.
* 4 VP for every Wonder you have built (the Great Pyramid is worth 5). If the city of a Wonder is captured, its points are shared between the builder and the new owner; the Great Pyramid always stays with its builder.
* Bonus VP from some Events and cards.

A tie is won by the builder of the Great Pyramid; after that, by the player with more points from cities and buildings, then Advances, Objectives, Wonders and Events. The game also ends early if one player has no cities left.

### Ages, rounds and turns

* A game is a number of **Ages**. Each Age has **3 rounds**, and in every round both players take one turn. After round 3 comes the **Status Phase**.
* On your turn you may take up to **3 actions**, then press **End Turn**. Unused actions are lost. Some cards and abilities are free and do not use up an action.
* When you end your turn the computer plays its own, with each move shown on the map (you can speed this up in the Menu), and then it is your turn again.

### The screen

The window is 1280×720 and scales to fit the browser.

* **Top bar:** the Age and round, who goes first, whose turn it is, your remaining actions, and the **Log**, **Rules** and **Menu** buttons.
* **Left:** a card for each player (you in blue, the computer in red) with Victory Points, Government, resources and storage limits, Mood and Culture tokens, cities, Advances, Army, Settlers and Ships, cards in hand and the tracker for the next Event. **Overview** lists a player's Advances, Wonders, Objectives and score.
* **Centre:** the map.
* **Right:** what you have selected and what you can do with it, with a short list of recent events below.
* **Bottom:** **Advance**, **Cards** and **Abilities** open their windows, and **End Turn** ends your turn.

### What you can do on your turn

Each of these uses one action, except where noted:

* **Advance:** research a new Advance for 2 Food (Ideas or Gold can replace Food).
* **Found a city:** a Settler settles the land it stands on, if that land is not Barren or exhausted and has no enemy units on it. You can own at most 7 cities.
* **Collect:** gather resources from a city and the spaces around it. A city with a Port may also take 1 Gold or 1 Mood token from one adjacent Sea space.
* **Construct:** build an Academy, Fortress, Port or Temple for 1 Food, 1 Wood and 1 Ore. Each needs an Advance first: Writing for the Academy, Tactics for the Fortress, Fishing for the Port and Myths for the Temple.
* **Recruit:** train Infantry (1 Food, 1 Ore), Settlers (2 Food) or Ships (2 Wood; the city needs a Port).
* **Wonder:** build a Wonder from your hand in a Happy city.
* **Happiness:** spend Mood tokens to raise the Mood of a city.
* **Influence:** spend Culture to win over a building in a city of the other player.
* **Move:** move up to 3 groups of units to explore, attack or sail.
* **Action cards and Abilities:** play a card or use a power from the **Cards** and **Abilities** buttons (free or for one action, as it says).

Click a city or unit to see what it can do. Buttons that are not available say why.

### Map and units

* The board is ten regions of four spaces, surrounded by a ring of Sea. Face-down regions (shown with "?") are revealed when one of your land units steps next to them or a Ship sails beside them. You choose how the new region is turned.
* **Infantry** fight. They can only move once you have researched Tactics. At most 4 Army units may share a space.
* **Settlers** found cities. They cannot enter enemy spaces without Army units.
* **Ships** sail through connected Sea spaces, carry up to 2 land units each and stop when they meet an enemy Ship. To board, select land units next to your Ship and click its space. To land, select the Ship's space, set the number of Ships to 0 and click a land space beside it.
* **Barbarians** are armies and settlements (purple) controlled by the game. They appear through Events.
* To move, select your units, then click a highlighted space: **green** to move, **red** to attack, **yellow** to explore and **blue** to sail or board. One Move action lets up to 3 groups move; each group moves one space (two with Roads).
* Forest: units that enter cannot attack that turn. Mountain: units that enter must stop there. Units that fought cannot move again that turn.

### Combat

Move Army units into a space that holds enemy units or an enemy city to attack. A battle is fought in rounds until one side is wiped out or the attacker retreats. In every round:

* Both sides roll one die for every unit in the battle and add up the faces. In a land battle, every die that shows an Infantry mark adds +1, up to the number of Infantry you have in the fight.
* Every full 5 points make one hit, and each hit destroys one enemy unit.
* A Fortress gives its defender an extra die and cancels 1 hit in round 1. Warships cancel 1 hit in the first round of a naval battle.
* With Tactics you may play an Action card for its combat effect before each round.
* If both sides survive, the attacker may retreat to the space they came from.

When all the defenders are gone, the attacking Army units take the city. The captor gains Gold equal to the city's size (+1 if it was Happy, only 1 if it was Angry); a Barbarian city is worth just 1 Gold, and beating Barbarian units earns 1 more. The captured city becomes Angry, and the old owner places a free Settler in one of the remaining cities.

Battles you take part in are shown round by round. Each round opens a battle window in which both sides' dice are rolled onto a table, one after another, and then the Combat value, the hits and the losses are explained step by step. Click **Show result** (or press Space or Enter) to skip the roll, and **Continue** (or Space or Enter again) to close the window. When the animation speed is Instant, and for fights between the computer and the Barbarians, only a short message is shown.

### Cities and Mood

* A city's size is 1 plus its buildings and Wonders. It can never exceed 5, or the number of cities you own.
* A city can collect or recruit as many things as its capacity: its size, plus 1 if it is Happy (an Angry city only 1).
* Collect, Construct, Recruit, Wonder, Happiness and Influence **activate** a city. The first activation of a city each turn is free. Every further activation in the same turn lowers that city's **Mood** one step: Happy, then Neutral, then Angry. An Angry city can be activated only once per turn and cannot Construct.
* Spend Mood tokens with the Happiness action to raise a city's Mood. Events, Influence attempts and Wonders can change Mood too.

### Advances, cards and Wonders

* **Advances:** there are 12 categories of 4. The top Advance of a category must be researched first. The three Governments (Democracy, Autocracy and Theocracy) each need a prerequisite Advance, and you can follow only one Government at a time. Every third Advance you research triggers an Event card for you; the tracker on your player card shows how many are left.
* **Action cards:** the top half is played during your turn (free or for 1 action); the lower half is a combat effect that needs Tactics.
* **Objective cards:** each shows a Development goal and a Military goal. Reaching a goal earns 2 VP. Some are checked at the end of an Age, others complete during play.
* **Wonder cards** (from Engineering and Monuments): build the Wonder in a Happy city if you can pay its cost and own the required Advance. The eight Wonders are the Great Wall, Great Statue, Great Mausoleum, Great Arena, Great Library, Great Lighthouse, Great Pyramid and Great Gardens.
* **Resources:** Food, Wood, Ore, Ideas and Gold, plus Mood and Culture tokens. Food is limited to 2 until you research Storage; everything else is limited to 7.

### Events and Barbarians

* Events come from a shared deck. Most affect only the player who drew the card; some affect both players. An icon in the corner of a card is resolved first.
* **Barbarians** appear through Events and some Action cards. A Barbarian Settlement and an Infantry appear about two spaces from the cities of the player who drew the Event, and Barbarian armies near that player's cities step towards the nearest city and fight whatever they find there. That player chooses the order, and the route when there is a tie.
* Barbarian units and cities block Collecting in their space. Attack them by moving into them.
* A city the Barbarians capture becomes theirs, and its owner receives a free Settler in another city.

### The Status Phase

After round 3 of every Age both players go through the Status Phase, step by step:

1. **Complete Objectives:** Objective cards you fulfil now are scored.
2. **Free Advance:** choose any Advance you can research, for free.
3. **Draw new cards:** 1 Action card and 1 Objective card.
4. **Raze a city** (optional): remove one of your size 1 cities for 1 Gold. You keep at least one city.
5. **Change Government** (optional): pay 1 Culture and 1 Mood token to switch to another Government you qualify for.
6. **First player:** the player with more Mood and Culture tokens decides who goes first in the next Age (the owner of the Great Lighthouse always decides).

After the Status Phase of the last Age the game ends. A window shows both final scores with a breakdown, and lets you start a new game of the same length, look over the board or go back to the title screen.

### Controls

* **Left-click** a city or one of your units to select it (right-click also selects). With units selected, set how many of each type go with the **+** and **-** buttons, then click a highlighted space.
* **Hover** over almost anything (resources, tokens, buildings, spaces, buttons) for an explanation. Disabled buttons say why they are disabled.
* **Esc** closes the top window or cancels your selection.
* **Log** shows the full history of the game.
* **Menu** (top right) sets the animation speed (Normal, Fast or Instant), restarts the game or goes back to the title screen. The game saves itself after every action.

### Tips for a first game

* Found more cities early. Each city is worth a point, and a city can never grow past the number of cities you own.
* Research **Storage** soon: until then you can keep only 2 Food.
* **Tactics** lets your Infantry move and lets you build Fortresses.
* Watch the Mood of your cities. Activating the same city more than once in a turn makes its people unhappy, so spread the work around or keep Mood tokens ready.
* Every third Advance triggers an Event, and Events bring Barbarians, so do not leave your cities undefended.
* An Objective card is worth as much as four Advances, so read your Objectives when you draw them.

## What has been implemented

### The rules

The complete two-player base game, rule for rule (apart from the gaps listed under [What is still to do](#what-is-still-to-do)):

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

### The computer opponent

The computer lists the sensible actions available to it, plays each one out on a copy of the game (several times when dice
or unseen cards are involved, with everything it could not see reshuffled), and keeps the one that improves its position
most. It uses exactly the same rules interface as you do.

### The interface

* A title screen with **New game**, **Continue game**, the **Game length** selector (4 to 12 Ages) and **How to play**.
* A hexagonal map with generated terrain art and a symbol for every unit and building type, tinted with its owner's colour. Highlighted spaces (green, red, yellow, blue) show what the selected units can do.
* Player cards, a panel for the selected city or unit, a list of recent events, the full **Log**, and an **Overview** of each civilization with its score breakdown.
* Windows for researching Advances (the computer's Advances are marked), cards, Abilities, constructing and recruiting, Influence, and choosing how a newly explored region is turned.
* A round-by-round **battle** window in which the dice roll onto a table before the result is explained, and a **game over** window with the final scores.
* Explanations on hover for almost everything, and disabled buttons that say why they are disabled.
* Moves, turn banners and battles are animated, and the animation speed can be set to Normal, Fast or Instant.
* The game saves itself after every action; **Continue game** picks it up again.
* **Rules**, a written manual for every part of the game.

### Under the hood

* The rules engine has no dependency on Phaser, so the same code runs in the game, in the tests and in computer-vs-computer simulations. A game can be started from a fixed seed.
* Automated tests cover the rules, scoring, saving and loading, random play, computer-vs-computer games, the rule details listed above and a browser test that plays through the real game window.
* Development scripts for simulations, fuzzing and screenshots (see [For developers](#for-developers)).

### Recent changes

* **Selectable game length:** choose 4 to 12 Ages on the title screen (6 by default). The top bar shows "AGE V of 6", restarting keeps the length, and saved games from older versions open as 6-Age games.
* **Bigger map and clearer symbols:** the hexes are a little larger, the side panels were re-flowed so the whole board still fits, and the symbols for units, buildings and Wonders were redrawn.
* **New name:** the game is now called Monumental Clash (title screen, browser tab and package name).
* **Dice roll in battles:** the battle window rolls the dice onto a table before it explains the result. Show result, Space or Enter skips the roll; Instant animation speed still skips the window altogether.

## What is still to do

### Gaps compared with the printed game

These parts of the printed game are not in Monumental Clash yet:

- [ ] **More than two players.** There is only 1 human against 1 computer: no two-player hot-seat, no online play and no extra computer players.
- [ ] **The expansion content:** Civilizations, Leaders, Market, Obelisk, Observatory, Cavalry and Elephants, and the Pirates.
- [ ] **The exact printed cards.** The rulebook does not list every card, so the Action, Objective and Event cards and the Advance descriptions are original reconstructions
  written to match the mechanics in the rulebook. They do not match the printed cards one for one.
- [ ] **The strict turn rules.** You may press **End Turn** before using all 3 actions (the rulebook says you must perform 3), so you are never forced into a pointless or harmful action,
  and a player's last city cannot be razed in the Status Phase, which would end the game by accident. A "strict rules" option could bring back the printed behaviour.

### Ideas for the future

These are suggestions, not promises:

- [ ] **Difficulty levels** for the computer opponent (easier and harder), and different play styles.
- [ ] **Sound:** effects and music. The game is silent today.
- [ ] **Better artwork and animation:** the art is simple and generated in the browser; hand-made illustrations and animated fights on the map (only the dice roll is animated today) would help.
- [ ] **Touch and small screens:** the window is a fixed 1280×720 scaled to fit, and explanations appear on hover, which touch screens do not have.
- [ ] **Several save slots**, and exporting or importing a save. There is one autosave today, kept in the browser.
- [ ] **Undo** for actions that involve no dice or hidden cards.
- [ ] **Keyboard shortcuts** for common actions. Only Esc (and Space or Enter in the battle window) are used today.
- [ ] **A guided tutorial game** in addition to the written manual.
- [ ] **Accessibility options:** a colour-blind-friendly palette and larger text.
- [ ] **Translations.** The game is English only.
- [ ] **Statistics and replays** of finished games. The Log is the only record today.

## For developers

```
src/engine   the rules, with no dependency on Phaser. Actions are generators that ask questions through prompts.
src/ai       the computer opponent
src/ui       the Phaser scenes, dialogs and drawing code
test         the automated tests and development scripts
docs         the screenshot shown at the top of this file
source       the rulebook that the rules follow
dist         the built game (created by npm run build)
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
