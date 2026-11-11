// Advance definitions: 12 categories of 4, in board order (top Advance first).
// bonus: token gained when bought ('mood' = yellow border, 'culture' = blue border).
// text is a short rules summary written for this game.

const A = (id, name, bonus, text, extra = {}) => ({ id, name, bonus, text, ...extra });

export const ADVANCE_GROUPS = [
  {
    id: 'agriculture', name: 'Agriculture', gov: false, advances: [
      A('farming', 'Farming', null, 'Collect Food from Plains and Wood from Forests.'),
      A('storage', 'Storage', 'mood', 'Your Food limit rises from 2 to 7.'),
      A('irrigation', 'Irrigation', 'mood', 'Collect Food from Barren land. Ignore Famine events.'),
      A('husbandry', 'Husbandry', 'mood', 'When collecting, also gather from a Land space 2 away (two with Roads). Once per turn.'),
    ],
  },
  {
    id: 'construction', name: 'Construction', gov: false, advances: [
      A('mining', 'Mining', null, 'Collect Ore from Mountains.'),
      A('engineering', 'Engineering', null, 'Draw a Wonder card. Build Wonders by activating a Happy city.'),
      A('sanitation', 'Sanitation', 'mood', 'Recruit: pay 1 Mood token for 1 Settler. Ignore Plague and Epidemic.'),
      A('roads', 'Roads', 'culture', 'Pay 1 Food + 1 Ore per group moving to/from your city: go 2 spaces, ignore terrain penalties.'),
    ],
  },
  {
    id: 'seafaring', name: 'Seafaring', gov: false, advances: [
      A('fishing', 'Fishing', 'mood', 'Collect Food from one adjacent Sea space. Allows Ports.', { building: 'port' }),
      A('navigation', 'Navigation', 'culture', 'Ships may sail off one map edge and appear at the next Sea space.'),
      A('warships', 'Warships', null, 'Cancel 1 hit in round 1 of naval battles (and when landing straight into a battle).'),
      A('cartography', 'Cartography', null, 'Gain 1 Idea per Move action that moves a Ship (+1 Culture if you used Navigation).'),
    ],
  },
  {
    id: 'education', name: 'Education', gov: false, advances: [
      A('writing', 'Writing', 'culture', 'Draw 1 Action and 1 Objective card. Allows Academies.', { building: 'academy' }),
      A('public_education', 'Public Education', 'mood', 'Once per turn, collecting in a city with an Academy gives +1 Idea.'),
      A('free_education', 'Free Education', 'mood', 'After paying for an Advance with Gold/Ideas, pay 1 more Idea to gain 1 Mood token.'),
      A('philosophy', 'Philosophy', 'mood', 'Gain 1 Idea now, and 1 Idea for each Science Advance you get later.'),
    ],
  },
  {
    id: 'warfare', name: 'Warfare', gov: false, advances: [
      A('tactics', 'Tactics', 'culture', 'Army units may move. Use the combat side of Action cards. Allows Fortresses.', { building: 'fortress' }),
      A('siegecraft', 'Siegecraft', null, 'Attacking a Fortress: pay 2 Wood to cancel its extra die and/or 2 Ore to cancel its hit-cancel.'),
      A('steel_weapons', 'Steel Weapons', null, 'Before a land battle pay 1 Ore: +2 CV each round (+1 vs enemies with Steel Weapons).'),
      A('draft', 'Draft', 'culture', 'Recruit: pay 1 Mood token for 1 Infantry.'),
    ],
  },
  {
    id: 'spirituality', name: 'Spirituality', gov: false, advances: [
      A('myths', 'Myths', 'mood', 'Pay 1 Mood token per city to prevent an event Mood loss. Allows Temples.', { building: 'temple' }),
      A('rituals', 'Rituals', 'culture', 'Increase Happiness: any resources can replace Mood tokens 1 for 1.'),
      A('priesthood', 'Priesthood', null, 'Once per turn, research a Science Advance without paying resources.'),
      A('state_religion', 'State Religion', 'mood', 'Once per turn, a Temple costs no Food.'),
    ],
  },
  {
    id: 'economy', name: 'Economy', gov: false, advances: [
      A('bartering', 'Bartering', 'mood', 'Once per turn, discard a card to gain 1 Gold or 1 Culture (free action). Allows Markets.', { building: 'market' }),
      A('trade_routes', 'Trade Routes', null, 'Start of turn: +1 Food per trade route (Settler/Ship paired with an enemy city within 2). Max 4.'),
      A('taxation', 'Taxation', null, 'Action: pay 1 Mood token, gain Food/Wood/Ore equal to your city count. Once per turn.'),
      A('currency', 'Currency', 'culture', 'Gold may replace Food for Trade Routes and Taxation.'),
    ],
  },
  {
    id: 'culture', name: 'Culture', gov: false, advances: [
      A('arts', 'Arts', 'culture', 'Once per turn, pay 1 Culture token for a free Influence Culture action.'),
      A('sports', 'Circus & Sports', 'mood', 'Action: pay 1 or 2 Culture to raise one city\'s Mood 1 or 2 steps.'),
      A('monuments', 'Monuments', 'culture', 'Draw a Wonder card. Your cities with Wonders cannot be influenced.'),
      A('theaters', 'Theaters', 'mood', 'Once per turn, swap 1 Culture token for 1 Mood token, or the reverse.'),
    ],
  },
  {
    id: 'science', name: 'Science', gov: false, advances: [
      A('math', 'Math', 'culture', 'Engineering and Roads cost no resources.'),
      A('astronomy', 'Astronomy', 'culture', 'Navigation and Cartography cost no resources.'),
      A('medicine', 'Medicine', 'culture', 'After Recruit, regain 1 resource you spent.'),
      A('metallurgy', 'Metallurgy', 'culture', 'Collecting 2+ Ore: turn 1 Ore into 1 Gold. Steel Weapons is free against enemies without it.'),
    ],
  },
  {
    id: 'democracy', name: 'Democracy', gov: true, prereq: 'philosophy', advances: [
      A('voting', 'Voting', null, 'Free action: Increase Happiness, paying 1 extra Mood token in total.'),
      A('separation_of_power', 'Separation of Power', null, 'Opponents cannot boost Influence Culture against your Happy cities.'),
      A('civil_liberties', 'Civil Liberties', null, 'Action: gain 3 Mood tokens. Draft costs 2 Mood tokens.'),
      A('economic_liberty', 'Economic Liberty', null, 'Free action: pay 1 Mood token to Collect (your only Collect this turn).'),
    ],
  },
  {
    id: 'autocracy', name: 'Autocracy', gov: true, prereq: 'draft', advances: [
      A('nationalism', 'Nationalism', null, 'After a Recruit with Army/Ships, gain 1 Mood or Culture token.'),
      A('totalitarianism', 'Totalitarianism', null, 'Opponents cannot boost Influence Culture against your cities holding your Army units.'),
      A('absolute_power', 'Absolute Power', null, 'Once per turn, free action: pay 2 Mood tokens for an extra action.'),
      A('forced_labor', 'Forced Labor', null, 'Pay 1 Mood token: your Angry cities act as Neutral this turn.'),
    ],
  },
  {
    id: 'theocracy', name: 'Theocracy', gov: true, prereq: 'state_religion', advances: [
      A('dogma', 'Dogma', null, 'Building a Temple gives a free Theocracy Advance. Ideas limited to 2.'),
      A('devotion', 'Devotion', null, 'Opponents cannot boost Influence Culture against your cities with Temples.'),
      A('conversion', 'Conversion', null, '+1 to your Influence Culture roll; gain 1 Culture token on success.'),
      A('fanaticism', 'Fanaticism', null, '+2 CV in round 1 of battles in a city with a Temple; free Infantry if you lose.'),
    ],
  },
];

export const ADVANCES = {};
export const ADVANCE_GROUP_OF = {};
export const ADVANCE_ORDER = {};
export const GOVERNMENT_GROUPS = [];

ADVANCE_GROUPS.forEach((g) => {
  if (g.gov) GOVERNMENT_GROUPS.push(g.id);
  g.advances.forEach((a, i) => {
    a.group = g.id;
    a.index = i;
    ADVANCES[a.id] = a;
    ADVANCE_GROUP_OF[a.id] = g.id;
    ADVANCE_ORDER[a.id] = i;
  });
});

export const GROUPS = Object.fromEntries(ADVANCE_GROUPS.map((g) => [g.id, g]));
export const START_ADVANCES = ['farming', 'mining'];
export const SCIENCE_ADVANCES = GROUPS.science.advances.map((a) => a.id);
