// The "How to play" window: a short manual for the rules and the interface.
import { C, TXT } from './theme.js';
import { Choice } from './modals.js';
import { Modal, txt } from './widgets.js';

// '# ' starts a heading, '• ' a bullet; anything else is a paragraph.
export const TOPICS = [
  {
    id: 'goal',
    title: 'Goal & scoring',
    body: [
      'The game lasts six Ages unless you choose another length, from 4 to 12 Ages, on the title screen before you start. There you also choose how many computer opponents you face, from 1 to 3. Each Age has three rounds in which every player takes a turn, followed by a Status Phase. After the Status Phase of the last Age, the player with the most Victory Points (VP) wins.',
      '# Where Victory Points come from',
      '• 1 VP for every city and 1 VP for every building (Academy, Fortress, Market, Port, Temple).',
      '• ½ VP for every Advance you have researched.',
      '• 2 VP for every Objective card you have completed.',
      '• 4 VP for every Wonder you have built (the Great Pyramid is worth 5). If a Wonder\'s city is captured, its points are shared between the builder and the new owner; the Great Pyramid always stays with its builder.',
      '• Bonus VP from some Events and cards.',
      '# Ties',
      'The builder of the Great Pyramid wins a tie. After that, the player with more points from cities and buildings wins, then Advances, Objectives, Wonders and Events.',
      'Hover over a player\'s VP badge to see the breakdown at any time.',
    ],
  },
  {
    id: 'turn',
    title: 'Your turn',
    body: [
      'On your turn you may take up to 3 actions, then press End Turn. Unused actions are lost. Some cards and abilities are free and do not use up an action. Turns pass clockwise: you are Blue, and the computers are Red, Yellow and Green.',
      '# What an action can be',
      '• Advance: research a new Advance for 2 Food (Ideas or Gold can replace Food).',
      '• Collect: gather resources from a city and the spaces around it. A city with a Port may also take 1 Gold or 1 Mood token from one adjacent Sea space.',
      '• Construct: build an Academy, Fortress, Market, Port or Temple (1 Food, 1 Wood and 1 Ore). Each needs its own Advance; the Market needs Bartering.',
      '• Recruit: train Infantry (1 Food, 1 Ore), Cavalry (1 Food, 1 Wood), Elephants (2 Food), Settlers (2 Food) or Ships (2 Wood). Cavalry and Elephants need a city with a Market, Ships a city with a Port.',
      '• Wonder: build a Wonder from your hand in a Happy city.',
      '• Happiness: spend Mood tokens to raise the Mood of a city.',
      '• Influence: spend Culture to win over a building in a city of another player.',
      '• Found a city: a Settler settles the land it stands on.',
      '• Move: move up to 3 groups of units (explore, attack, sail).',
      '• Play an Action card or use an Ability from the Cards and Abilities buttons.',
    ],
  },
  {
    id: 'map',
    title: 'Map & units',
    body: [
      'The board grows with the number of players: ten regions of four spaces for 2 players, fifteen for 3 and eighteen for 4, always surrounded by a ring of Sea. Larger boards are scaled down to fit the window. Face-down regions (shown with "?") are revealed when one of your land units steps next to them or a Ship sails beside them. You choose how the new region is turned.',
      '# Units',
      '• Infantry, Cavalry and Elephants are Army units. They fight, and can only move once you have researched Tactics. At most 4 Army units may share a space, and you have 16 Infantry, 4 Cavalry and 4 Elephants.',
      '• Settlers found cities. They cannot enter enemy spaces without Army units.',
      '• Ships sail through connected Sea spaces, carry up to 2 land units each and stop when they meet an enemy Ship. To board, select land units next to your Ship and click its space. To land, select the Ship\'s space, set the number of Ships to 0 and click a land space beside it.',
      '# Moving',
      '• Select your units, then click a highlighted space. One Move action lets up to 3 groups move; each group moves one space (two with Roads).',
      '• Forest: units that enter cannot attack that turn. Mountain: units that enter must stop there.',
      '• Units that fought cannot move again that turn.',
      '• Some Action cards give a free Move outside your 3 actions: Forced March (3 groups), Scouting Report (1 Army group, up to 2 spaces, ignoring the Forest and Mountain penalties; a 2-space step can neither explore nor attack), Blitz Move (1 Army group) and Sailing Fleet (2 Ship groups). A group a card does not cover starts a normal Move action.',
    ],
  },
  {
    id: 'combat',
    title: 'Combat',
    body: [
      'Move Army units into a space that holds enemy units or an enemy city to attack. Battles are fought in rounds until one side is wiped out or the attacker retreats.',
      '# Each round',
      '• Both sides roll one die for every unit in the battle and add up the faces. Infantry faces add +1 for each Infantry you have, and Cavalry faces add +2 for each Cavalry you have.',
      '• An Elephant face does not add its value to the total, but it cancels one enemy hit, for each Elephant you have (a face only works for an Elephant that is in the battle, and each Elephant works once per round).',
      '• Every full 5 points make one hit, and each hit destroys one enemy unit. When you have a mix of Infantry, Cavalry and Elephants, you choose which of them are lost.',
      '• A Fortress gives its defender an extra die and cancels 1 hit in round 1. Warships cancel 1 hit in the first round of a naval battle.',
      '• With Tactics you may play an Action card for its combat effect before each round.',
      '• If both sides survive, the attacker may retreat to the space they came from.',
      '# The battle window',
      '• Each round you fight in opens a window where both sides\' dice are rolled onto a table, and then the Combat value, the hits and the losses are explained step by step.',
      '• Click Show result, or press Space or Enter, to skip the roll; Continue (or Space or Enter again) closes the window. At Instant animation speed only a short message is shown.',
      '# Capturing a city',
      '• When all defenders are gone, Army units that attacked take the city. The captor gains Gold equal to the city\'s size (+1 if it was Happy, only 1 if it was Angry). A Barbarian city is worth just 1 Gold whatever its size.',
      '• Beating a group of Barbarian units earns 1 more Gold, whether you attacked them or they attacked you.',
      '• The captured city becomes Angry. The old owner places a free Settler in one of the remaining cities.',
    ],
  },
  {
    id: 'cities',
    title: 'Cities & Mood',
    body: [
      'A city\'s size is 1 plus its buildings and Wonders. It can never exceed 5, or the number of cities you own.',
      '# Activating a city',
      '• Collect, Construct, Recruit, Wonder, Happiness and Influence all activate a city. The first activation of a city each turn is free.',
      '• Every further activation in the same turn lowers that city\'s Mood one step: Happy, then Neutral, then Angry.',
      '• An Angry city can be activated only once per turn and cannot Construct.',
      '• A city can collect or recruit as many things as its capacity: its size, plus 1 if it is Happy (an Angry city only 1).',
      '# Mood',
      '• Spend Mood tokens in the Happiness dialog to raise a city\'s Mood.',
      '• Events, Influence attempts and Wonders can change Mood too.',
      '# Founding cities',
      '• A Settler founds a city on land that is not Barren or exhausted, with no enemy units on it. It costs 1 action.',
      '• You may own at most 7 cities.',
    ],
  },
  {
    id: 'cards',
    title: 'Advances, cards & Wonders',
    body: [
      '# Advances',
      '• There are 12 categories of 4 Advances. The top Advance of a category must be researched first.',
      '• The three Governments (Democracy, Autocracy, Theocracy) each need a prerequisite Advance, and you may only follow one Government at a time.',
      '• Every third Advance you research triggers an Event card for you. The tracker on your player card shows how many are left.',
      '# Cards',
      '• Action cards: the top half is played during your turn (free or for 1 action); the lower half is a combat effect that needs Tactics.',
      '• Three Action cards are played together with another action instead of on their own: Mass Collection (Collect from 2 more spaces), Forced Labor (a Building costs 1 resource less) and Cultural Assimilation (Influence range +1). Tick them in the Collect, Construct or Influence window.',
      '• Objective cards: each shows a Development and a Military goal. Reaching a goal earns 2 VP. Some are checked at the end of an Age, others complete during play.',
      '• Wonder cards (from Engineering and Monuments): build the Wonder in a Happy city if you can pay its cost and own the required Advance.',
      '# Resources',
      '• Food, Wood, Ore, Ideas, Gold, Mood and Culture are kept as tokens. Food is limited to 2 until you research Storage; everything else is limited to 7.',
    ],
  },
  {
    id: 'events',
    title: 'Events & Barbarians',
    body: [
      'Events come from a shared deck. Most affect only the player who drew the card; some affect every player. An icon in the corner of a card is resolved first.',
      '• Some Events last until the end of the round: Drought, Locusts and the Dark Age (every paid Advance costs 1 more Idea) affect everybody, and hired mercenaries leave. A corrupt city cannot Collect until another action activates it.',
      '# Barbarians',
      '• Barbarians are armies with their own Settlements, controlled by the game. They appear through Events and some Action cards.',
      '• Spawn: a Barbarian Settlement and an Infantry appear about two spaces from the cities of the player who drew the Event and at least two spaces from the other players\' cities. Another Infantry joins a Barbarian city of that player\'s choice, or a Cavalry or an Elephant if that city already has an Infantry.',
      '• Move: Barbarian armies within 2 spaces of that player\'s cities each step one space closer to the nearest city and fight whatever they find there. That player chooses the order, and the route when there is a tie. Then every Barbarian city within 2 spaces of those cities gains an Infantry. The player may choose some of those cities that already have an Infantry to get a Cavalry or an Elephant instead.',
      '• Barbarian units and cities block Collecting in their space. Attack them by moving into them.',
      '• Beating a group of Barbarian units earns 1 Gold, and capturing a Barbarian city earns 1 more.',
      '• A city the Barbarians capture becomes theirs, and its owner receives a free Settler in another city.',
    ],
  },
  {
    id: 'status',
    title: 'Status Phase',
    body: [
      'After round 3 of every Age all players go through the Status Phase, one after the other in turn order, step by step:',
      '• 1. Complete Objectives: Objective cards you fulfil now are scored.',
      '• 2. Free Advance: choose any Advance you can research, for free.',
      '• 3. Draw new cards: 1 Action card and 1 Objective card.',
      '• 4. Raze a city (optional): remove one of your size 1 cities for 1 Gold. You keep at least one city.',
      '• 5. Change Government (optional): pay 1 Culture and 1 Mood token to switch to another Government you qualify for.',
      '• 6. First player: the player with the most Mood and Culture tokens decides who goes first in the next Age (the owner of the Great Lighthouse always decides).',
      'After the Status Phase of the last Age the game ends and the highest score wins.',
    ],
  },
  {
    id: 'tips',
    title: 'Interface tips',
    body: [
      '• Left-click a city or one of your units to select it. The panel on the right shows what you can do with it. Right-click also selects.',
      '• With units selected, set how many of each type go with the +/- buttons, then click a highlighted space: green to move, red to attack, yellow to explore and blue to sail or board.',
      '• Hover over almost anything (resources, tokens, buildings, spaces, buttons) for an explanation. Disabled buttons tell you why.',
      '• Advance, Cards and Abilities at the bottom open their own windows. Log shows the full history, Overview on a player card lists that player\'s Advances, Wonders and score.',
      '• Esc closes the top window or cancels your selection.',
      '• The game is saved automatically after every action. Menu lets you restart, go back to the title screen and change the animation speed.',
    ],
  },
];

function layout(scene, lines, width, size) {
  const objs = [];
  let y = 0;
  for (const line of lines) {
    if (line.startsWith('# ')) {
      y += y ? 6 : 0;
      const t = txt(scene, 0, y, line.slice(2), { size: size + 1, bold: true, color: TXT.gold });
      objs.push(t);
      y += t.height + 4;
    } else if (line.startsWith('• ')) {
      const dot = txt(scene, 6, y, '•', { size, color: TXT.gold });
      const t = txt(scene, 22, y, line.slice(2), { size, wrap: width - 22 });
      objs.push(dot, t);
      y += t.height + 5;
    } else {
      const t = txt(scene, 0, y, line, { size, wrap: width });
      objs.push(t);
      y += t.height + 9;
    }
  }
  return { objs, height: y };
}

export function helpDialog(ctl, startId = 'goal') {
  const scene = ctl.scene;
  const w = 980;
  const h = 620;
  const modal = new Modal(scene, { title: 'How to play', w, h, closable: true });
  const listX = 22;
  const listW = 224;
  const bodyX = 272;
  const bodyY = 66;
  const bodyW = w - bodyX - 28;
  const bodyH = h - bodyY - 30;
  const body = scene.add.container(bodyX, bodyY);
  modal.add(body);

  const g = scene.add.graphics();
  g.lineStyle(1, C.border, 1);
  g.lineBetween(bodyX - 14, bodyY, bodyX - 14, h - 24);
  modal.add(g);

  const rows = [];
  const show = (id) => {
    rows.forEach(([tid, row]) => row.set(tid === id));
    body.removeAll(true);
    const topic = TOPICS.find((x) => x.id === id) || TOPICS[0];
    let made = null;
    for (const size of [14, 13, 12]) {
      if (made) made.objs.forEach((o) => o.destroy());
      made = layout(scene, topic.body, bodyW, size);
      if (made.height <= bodyH) break;
    }
    body.add(made.objs);
  };

  let y = bodyY;
  for (const topic of TOPICS) {
    const row = new Choice(scene, listX, y, listW, { id: topic.id, label: topic.title, size: 15, minH: 40, onClick: () => show(topic.id) });
    modal.add(row);
    rows.push([topic.id, row]);
    y += row.h + 6;
  }
  modal.add(txt(scene, listX, h - 54, 'Esc closes this window.\nHover over anything in the game\nfor a short explanation.', { size: 12, color: TXT.dim }));
  show(startId);
  return modal;
}
