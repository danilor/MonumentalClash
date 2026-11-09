// Wonder cards: cost is paid in resources plus Culture tokens.
export const WONDERS = {
  great_wall: {
    id: 'great_wall', name: 'Great Wall', advance: 'siegecraft', vp: 4,
    cost: { food: 3, wood: 2, ore: 7, culture: 5 },
    text: 'Enemies attacking your Happy cities get -2 CV in round 1. Barbarians attacking your cities lose automatically.',
  },
  great_statue: {
    id: 'great_statue', name: 'Great Statue', advance: 'monuments', vp: 4,
    cost: { food: 3, wood: 4, ore: 5, culture: 5 },
    text: 'Draw an Objective card when built. Once per turn, discard an Objective card to gain an extra action.',
  },
  great_mausoleum: {
    id: 'great_mausoleum', name: 'Great Mausoleum', advance: 'priesthood', vp: 4,
    cost: { food: 4, wood: 4, ore: 4, culture: 5 },
    text: 'Draw Event and Action cards from the top of the discard pile if you wish. Your discards go to the bottom.',
  },
  great_arena: {
    id: 'great_arena', name: 'Great Arena', advance: 'sports', vp: 4,
    cost: { food: 3, wood: 4, ore: 5, culture: 5 },
    text: 'Culture and Mood tokens are interchangeable when spent (not for Wonders). Once per land battle pay 1 token for +1 CV.',
  },
  great_library: {
    id: 'great_library', name: 'Great Library', advance: 'philosophy', vp: 4,
    cost: { food: 3, wood: 6, ore: 3, culture: 5 },
    text: 'Once per turn, use one non-Government Advance you do not own until the end of your turn.',
  },
  great_lighthouse: {
    id: 'great_lighthouse', name: 'Great Lighthouse', advance: 'cartography', vp: 4,
    cost: { food: 3, wood: 5, ore: 4, culture: 5 },
    text: 'Activating its city lets you place a free Ship on any Sea space without an enemy Ship. You decide who is First Player.',
  },
  great_pyramid: {
    id: 'great_pyramid', name: 'Great Pyramid', advance: 'rituals', vp: 5,
    cost: { food: 2, wood: 3, ore: 7, culture: 5 },
    text: 'Worth 5 VP, never shared if captured. Wins ties for most VP.',
  },
  great_gardens: {
    id: 'great_gardens', name: 'Great Gardens', advance: 'irrigation', vp: 4,
    cost: { food: 5, wood: 5, ore: 2, culture: 5 },
    text: 'Its city may collect any resource (even Ideas/Gold) from Plains. Enemies entering a Plains space cannot attack it that turn.',
  },
};

export const WONDER_IDS = Object.keys(WONDERS);
