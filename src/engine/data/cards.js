// Card content. Texts are original wording; effects are implemented in engine/cards.js.
// Action cards: a top effect (play on your turn) and a combat effect (needs Tactics).

export const TOP_EFFECTS = {
  ideas2: { timing: 'free', text: 'Gain 2 Ideas.' },
  food2: { timing: 'free', text: 'Gain 2 Food.' },
  wood2: { timing: 'free', text: 'Gain 2 Wood.' },
  ore2: { timing: 'free', text: 'Gain 2 Ore.' },
  gold2: { timing: 'free', text: 'Gain 2 Gold.' },
  mood2: { timing: 'free', text: 'Gain 2 Mood tokens.' },
  culture2: { timing: 'free', text: 'Gain 2 Culture tokens.' },
  bounty: { timing: 'free', text: 'Gain 1 Food, 1 Wood and 1 Ore.' },
  prosperity: { timing: 'free', text: 'Gain 1 Gold and 1 Idea.' },
  reforms: { timing: 'free', text: 'Gain 1 Mood token and 1 Culture token.' },
  inspire: { timing: 'free', text: 'Raise the Mood of one of your cities by 1 step.' },
  diplomacy: { timing: 'free', text: 'Draw 1 Objective card.' },
  scouts: { timing: 'free', text: 'Draw 1 Action card and gain 1 Idea.' },
  espionage: { timing: 'free', text: 'Take 1 resource of your choice from the opponent (if they have it).' },
  quick_advance: { timing: 'action', text: 'As an Action: gain an Advance for just 1 Food.' },
  mass_levy: { timing: 'action', text: 'As an Action: recruit 1 free Infantry in each of up to 2 of your cities.' },
  settlers_call: { timing: 'action', text: 'As an Action: place 1 free Settler in one of your cities.' },
  city_boom: { timing: 'action', text: 'As an Action: Construct a Building in one city, paying only 1 Wood.' },
  forced_march: { timing: 'free', text: 'Take a Move Units action without spending an action.' },
  grand_festival: { timing: 'action', text: 'As an Action: raise the Mood of up to 2 of your cities by 1 step each.' },
  trade_caravan: { timing: 'action', text: 'As an Action: gain Gold equal to the number of your cities.' },
};

export const COMBAT_EFFECTS = {
  wedge: { name: 'Wedge Formation', side: 'attacker', domain: 'land', text: 'Attacker: +3 CV this round.' },
  high_ground: { name: 'High Ground', side: 'defender', domain: 'land', text: 'Defender: +3 CV this round.' },
  rally: { name: 'Rally', side: 'any', domain: 'any', text: '+2 CV this round.' },
  stand_firm: { name: 'Stand Firm', side: 'any', domain: 'any', text: 'Cancel 1 hit against you this round.' },
  ambush: { name: 'Ambush', side: 'any', domain: 'any', text: 'Enemy gets -3 CV this round.' },
  extra_die: { name: 'Skirmishers', side: 'any', domain: 'land', text: 'Roll 1 extra die this round (needs an Army unit).' },
  siege_engines: { name: 'Siege Engines', side: 'attacker', domain: 'land', text: 'Attacker: enemy Fortress bonuses do not apply this round.' },
  phalanx: { name: 'Phalanx', side: 'any', domain: 'land', text: '+1 CV per Infantry you have in the battle (max +4).' },
  naval_ram: { name: 'Ramming Speed', side: 'any', domain: 'sea', text: 'Naval battle: +3 CV this round.' },
};

const A = (id, name, top, combat) => ({ id, name, top, combat });

// 21 distinct cards, two copies each = 42 cards.
export const ACTION_CARD_TYPES = [
  A('windfall', "Scholars' Windfall", 'ideas2', 'wedge'),
  A('harvest', 'Bountiful Harvest', 'food2', 'high_ground'),
  A('timber', 'Timber Contract', 'wood2', 'rally'),
  A('ore_ship', 'Ore Shipment', 'ore2', 'stand_firm'),
  A('subsidy', 'Royal Subsidy', 'gold2', 'ambush'),
  A('festival', 'Public Festival', 'mood2', 'extra_die'),
  A('patronage', 'Cultural Patronage', 'culture2', 'siege_engines'),
  A('provisions', 'Provisions Cart', 'bounty', 'phalanx'),
  A('speech', 'Rousing Speech', 'inspire', 'naval_ram'),
  A('envoys', 'Envoys', 'diplomacy', 'stand_firm'),
  A('study', 'Study Group', 'scouts', 'high_ground'),
  A('spies', 'Espionage', 'espionage', 'ambush'),
  A('learning', 'Rapid Learning', 'quick_advance', 'wedge'),
  A('levy', 'Mass Levy', 'mass_levy', 'phalanx'),
  A('pioneers', 'Pioneers', 'settlers_call', 'extra_die'),
  A('boom', 'City Boom', 'city_boom', 'siege_engines'),
  A('march', 'Forced March', 'forced_march', 'naval_ram'),
  A('grand_fest', 'Grand Festival', 'grand_festival', 'rally'),
  A('caravan', 'Trade Caravan', 'trade_caravan', 'stand_firm'),
  A('prosper', 'Prosperity', 'prosperity', 'wedge'),
  A('reform', 'Reforms', 'reforms', 'high_ground'),
];

export const ACTION_CARDS = {};
ACTION_CARD_TYPES.forEach((c) => {
  ACTION_CARDS[c.id] = c;
});
export const ACTION_DECK_LIST = ACTION_CARD_TYPES.flatMap((c) => [c.id, c.id]);

// ---------------------------------------------------------------- Objectives
// kind 'status' = checked in the Status Phase; 'event' = completed right after the triggering event.
const O = (id, name, kind, text) => ({ id, name, kind, text });

export const OBJECTIVES = {
  large_civ: O('large_civ', 'Large Civilization', 'status', 'You own at least 6 cities.'),
  science_lead: O('science_lead', 'Science Lead', 'status', 'More of your cities contain an Academy than any other player\'s cities.'),
  coastal_lead: O('coastal_lead', 'Coastal Culture', 'status', 'More of your cities contain a Port than any other player\'s cities.'),
  advanced_culture: O('advanced_culture', 'Advanced Culture', 'status', 'You have at least 6 Advances, and more than the other player.'),
  religious_fervor: O('religious_fervor', 'Religious Fervor', 'status', 'More of your cities contain a Temple than any other player\'s cities.'),
  city_planner: O('city_planner', 'City Planner', 'status', 'You own every Advance in Construction.'),
  eureka: O('eureka', 'Eureka!', 'status', 'You have at least 5 Ideas (spend 2 to complete).'),
  happy_population: O('happy_population', 'Happy Population', 'status', 'You own at least 4 Happy cities.'),
  education_lead: O('education_lead', 'Education', 'status', 'You own every Advance in Education.'),
  optimized_storage: O('optimized_storage', 'Optimized Storage', 'status', 'You have at least 3 Food, 3 Wood and 3 Ore.'),
  wealth: O('wealth', 'Wealth', 'status', 'You have at least 5 Gold (spend 2 to complete).'),
  ore_supplies: O('ore_supplies', 'Ore Supplies', 'status', 'You have at least 5 Ore (spend 2 to complete).'),
  wood_supplies: O('wood_supplies', 'Wood Supplies', 'status', 'You have at least 5 Wood (spend 2 to complete).'),
  food_supplies: O('food_supplies', 'Food Supplies', 'status', 'You have at least 5 Food (spend 2 to complete).'),
  architecture: O('architecture', 'Architecture', 'status', 'Your cities contain all four Building types in your color.'),
  goal_focused: O('goal_focused', 'Goal Focused', 'status', 'You own more complete Advance categories than the other player.'),
  colony: O('colony', 'Colony', 'status', 'You own a city at least 5 spaces from your starting city.'),
  culture_focus: O('culture_focus', 'Culture Focus', 'status', 'You own every Advance in Culture.'),
  consulate: O('consulate', 'Consulate', 'status', 'At least 2 enemy cities contain Buildings in your color.'),
  science_focus: O('science_focus', 'Science Focus', 'status', 'You own every Advance in Science.'),
  trade_focus: O('trade_focus', 'Trade Focus', 'status', 'You own every Advance in Economy.'),
  metropolis: O('metropolis', 'Metropolis', 'status', 'You own a city of size 5.'),
  seafarers: O('seafarers', 'Seafarers', 'status', 'You own every Advance in Seafaring.'),
  government: O('government', 'Government', 'status', 'You own all four Advances of one Government.'),
  expansionist: O('expansionist', 'Expansionist', 'status', 'At least 4 of your cities are not adjacent to any other city.'),

  draft_obj: O('draft_obj', 'Mobilization', 'event', 'You recruited with Draft in two Recruit actions in one turn.'),
  conqueror: O('conqueror', 'Conqueror', 'event', 'Immediately after capturing an enemy city that was defended by an Army unit or a Fortress.'),
  warmonger: O('warmonger', 'Warmonger', 'event', 'Eliminate at least 3 enemy Army units in a single land battle (barbarians count).'),
  general: O('general', 'General', 'event', 'Win a land battle against at least 2 Army units without losing any of yours.'),
  great_battle: O('great_battle', 'Great Battle', 'event', 'Fight a land battle with at least 6 Army units on both sides combined.'),
  defiance: O('defiance', 'Defiance', 'event', 'Win a battle against the other player despite having fewer Army units.'),
  sea_blockade: O('sea_blockade', 'Sea Blockade', 'status', 'At least 2 of your Ships are on an enemy Port\'s sea space.'),
  naval_assault: O('naval_assault', 'Naval Assault', 'event', 'Immediately after capturing an enemy city with Army units that landed from a Ship.'),
  large_fleet: O('large_fleet', 'Large Fleet', 'status', 'You have at least 4 Ships, or at least 2 and more than the other player.'),
  large_army: O('large_army', 'Large Army', 'status', 'You have at least 4 more Army units than the other player.'),
  fortifications: O('fortifications', 'Fortifications', 'status', 'More of your cities contain a Fortress than any other player\'s cities.'),
  standing_army: O('standing_army', 'Standing Army', 'status', 'At least 4 of your cities each contain one of your Army units. Not with Military Might.'),
  militarized: O('militarized', 'Militarized', 'status', 'You own every Advance in Warfare.'),
  bold: O('bold', 'Bold', 'event', 'Win a battle against a player with more Warfare Advances, or despite having fewer Army units.'),
  threat: O('threat', 'Threat', 'status', 'At least 4 of your Army units stand next to enemy cities.'),
  legendary_battle: O('legendary_battle', 'Legendary Battle', 'event', 'Attack a city of size 5+ holding a Wonder with at least 3 Army units.'),
  scavenger: O('scavenger', 'Scavenger', 'event', 'Destroy an enemy Settler or Ship in battle.'),
  aggressor: O('aggressor', 'Aggressor', 'event', 'Win a land battle as attacker, eliminating at least 2 Army units.'),
  barbarian_conquest: O('barbarian_conquest', 'Barbarian Conquest', 'event', 'Immediately after capturing a barbarian city defended by at least 2 Army units.'),
  military_might: O('military_might', 'Military Might', 'status', 'You have at least 12 Army units and Ships combined. Not with Standing Army.'),
};

// Each card: development objective (top) + military objective (bottom). Only one may be completed.
export const OBJECTIVE_CARD_LIST = [
  ['large_civ', 'draft_obj'], ['science_lead', 'conqueror'], ['coastal_lead', 'warmonger'],
  ['advanced_culture', 'warmonger'], ['religious_fervor', 'general'], ['city_planner', 'great_battle'],
  ['eureka', 'defiance'], ['happy_population', 'conqueror'], ['education_lead', 'sea_blockade'],
  ['optimized_storage', 'naval_assault'], ['wealth', 'large_fleet'], ['ore_supplies', 'large_army'],
  ['wood_supplies', 'fortifications'], ['food_supplies', 'standing_army'], ['architecture', 'militarized'],
  ['goal_focused', 'bold'], ['colony', 'threat'], ['culture_focus', 'legendary_battle'],
  ['consulate', 'great_battle'], ['science_focus', 'naval_assault'], ['trade_focus', 'scavenger'],
  ['metropolis', 'general'], ['seafarers', 'aggressor'], ['government', 'barbarian_conquest'],
  ['government', 'aggressor'], ['expansionist', 'military_might'],
].map(([dev, mil], i) => ({ id: `ob${i + 1}`, dev, mil }));

export const OBJECTIVE_CARDS = Object.fromEntries(OBJECTIVE_CARD_LIST.map((c) => [c.id, c]));

// -------------------------------------------------------------------- Events
// icon: gold_mine | exhausted | spawn | move | null
const E = (id, name, icon, text) => ({ id, name, icon, text });

export const EVENT_CARD_LIST = [
  E('good_year', 'Good Year', 'gold_mine', 'Gain 2 Food.'),
  E('fantastic_year', 'Fantastic Year', 'gold_mine', 'Gain 3 Gold.'),
  E('awesome_year', 'Awesome Year', null, 'Gain 1 Food, 1 Wood, 1 Ore and 1 Idea.'),
  E('population_boom', 'Population Boom', 'spawn', 'Place a Settler in each of up to 2 of your cities of size 2 or more.'),
  E('plague', 'Plague', null, 'Lose 2 Food and lower the Mood of your largest city 1 step. Sanitation ignores this.'),
  E('epidemic', 'Epidemic', 'move', 'Lose 1 Infantry and 1 Settler (if you have them). Sanitation ignores this.'),
  E('famine', 'Famine', 'exhausted', 'Lose 2 Food; for each Food you lack, lower a city\'s Mood. Irrigation ignores this.'),
  E('flood', 'Flood', 'exhausted', 'Each of your cities next to the Sea lowers its Mood 1 step (Myths may prevent each).'),
  E('earthquake', 'Earthquake', null, 'Each of your cities next to a Mountain becomes Angry (Myths may prevent each).'),
  E('volcano', 'Volcano', 'spawn', 'Destroy your smallest city next to a Mountain (not your last city) and gain 2 VP.'),
  E('civil_war', 'Civil War', 'move', 'Each of your Angry cities loses all Army units standing in it.'),
  E('migration', 'Migration', null, 'Place 1 Settler in one of your cities and gain 1 Food.'),
  E('uprising', 'Uprising', 'spawn', 'Pay 2 Mood tokens, or your largest non-Angry city becomes Angry (Myths may prevent).'),
  E('era_of_stability', 'Era of Stability', null, 'Each of your Angry cities becomes Neutral.'),
  E('flourishing_trade', 'Flourishing Trade', 'move', 'Gain Gold equal to your Ports (at least 1).'),
  E('scientific_trade', 'Scientific Trade', null, 'Gain 1 Idea, plus 1 for each of your Academies.'),
  E('reformation', 'Reformation', null, 'Gain 1 Mood token, plus 1 more if you have a Temple.'),
  E('solar_eclipse', 'Solar Eclipse', null, 'The next land battle ends after one round; its winner scores 1 VP.'),
];
export const EVENT_CARDS = Object.fromEntries(EVENT_CARD_LIST.map((e) => [e.id, e]));
