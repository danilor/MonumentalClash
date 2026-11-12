// Civilizations: 15 peoples with four unique Advances each (source/civ.md, rules as printed in the rulebook).
// A Civilization Advance is gained at once, from the player's own supply, when its trigger Advance is bought.
// trigger: an Advance id, or 'government' for the first Advance of any Government category.
// "Chemistry" in source/civ.md is not an Advance of this game; Fireworks comes with Metallurgy, the last Science Advance.

const C = (id, name, advances) => ({ id, name, advances });
const V = (id, name, trigger, text) => ({ id, name, trigger, text });

export const CIVS = Object.fromEntries(
  [
    C('aztecs', 'Aztecs', [
      V('captives', 'Captives', 'tactics', 'After winning a Land battle, keep up to 4 defeated Army units as Captives, worth 1/2 VP each at the end.'),
      V('human_sacrifice', 'Human Sacrifice', 'rituals', 'After drawing an Event, spend a Captive to cancel it and draw again. Free action: spend Captives as 1 Food, Mood or Culture each.'),
      V('aztec_gold', 'Aztec Gold', 'arts', 'Once per turn, 1 Ore collected from a Mountain may be taken as 1 Gold or 1 Culture.'),
      V('tribute_empire', 'Tribute Empire', 'government', 'Your cities Collect from spaces holding enemy or Barbarian cities within 2 spaces, whatever their Mood. Barbarian Armies there may be taken as Captives instead.'),
    ]),
    C('babylonia', 'Babylonia', [
      V('canals', 'Canals', 'engineering', 'A Collect that gathers exactly 1 Food in a city gives 1 extra Food, outside the Collect limit.'),
      V('code_of_laws', 'Code of Laws', 'writing', 'Draw an Action card after a successful Influence Culture if you hold 4 or fewer Action cards.'),
      V('star_catalogs', 'Star Catalogs', 'astronomy', 'Before an Event is drawn, gain 1 Idea or 1 Culture.'),
      V('ziggurats', 'Ziggurats', 'dogma', 'Dogma no longer limits your Ideas. Ideas pay for any resource when a Temple raises a city\'s size.'),
    ]),
    C('carthage', 'Carthage', [
      V('warbeasts', 'Warbeasts', 'husbandry', 'All your cities build Elephants. Elephant dice showing 1 or 2 may add their value to CV instead of cancelling a hit.'),
      V('hegemony', 'Hegemony', 'cartography', 'Action: a Ship Founds a city on an adjacent free Land space and is removed; its cargo goes ashore.'),
      V('pirate_allies', 'Pirate Allies', 'navigation', 'Your Ships and Land units may enter Pirate spaces and share them. A shared Pirate Ship counts as yours.'),
      V('mercenaries', 'Mercenaries', 'draft', 'Pay Gold instead of Mood for Draft. Port cities may Draft Ships.'),
    ]),
    C('celts', 'Celts', [
      V('tribal_warfare', 'Tribal Warfare', 'tactics', '+1 CV in Land battles against players for each Barbarian city within 2 spaces holding 2 or more Barbarian units.'),
      V('tribal_allies', 'Tribal Allies', 'draft', 'Once per turn, free action: spawn Barbarians like the Event icon. Or pay 1 Food per attacking Barbarian unit to cancel their attack.'),
      V('druidic_influence', 'Druidic Influence', 'priesthood', 'Influence Culture on Barbarian cities leaves a Culture token under them, worth 1 VP until captured.'),
      V('tribal_trade', 'Tribal Trade', 'trade_routes', 'Trade routes may be formed with Barbarian cities.'),
    ]),
    C('china', 'China', [
      V('rice_paddies', 'Rice Paddies', 'irrigation', '+1 extra Food from each Plains space with a Settler (and no city) you Collect from, up to 2 per Collect.'),
      V('sprawling', 'Sprawling', 'husbandry', 'After a Recruit that made a Settler, move any or all Settlers in your cities up to 1 space for free.'),
      V('fireworks', 'Fireworks', 'metallurgy', 'Pay 1 Ore before the first combat round to stop your opponent playing a Combat card that round.'),
      V('fighting_bands', 'Fighting Bands', 'government', 'Once per turn, free action: exchange any Settlers for Infantry and any Infantry for Settlers.'),
    ]),
    C('egypt', 'Egypt', [
      V('flood_plains', 'Flood Plains', 'irrigation', 'Collect Food or Wood from Barren spaces, and Found cities on them.'),
      V('architecture', 'Architecture', 'engineering', 'Mood replaces resources or Culture 1 for 1 when building Wonders or increasing city size.'),
      V('embalming', 'Embalming', 'rituals', 'After any battle, gain 1 Culture if you hold 4 or fewer.'),
      V('man_god', 'Man God', 'priesthood', 'Each Theocracy Advance also gives the power of the Autocracy Advance directly to its left (no VP).'),
    ]),
    C('greece', 'Greece', [
      V('formal_training', 'Formal Training', 'public_education', 'Gain 1 Idea whenever you Recruit in a city with an Academy.'),
      V('spartans', 'Spartans', 'draft', 'Pay Culture instead of Mood for Draft. Attackers cannot play Action cards in combat rounds where you have fewer Army units.'),
      V('hellenization', 'Hellenization', 'arts', 'Influence Culture from any city holding one of your Buildings, with a range equal to its size. Arts may cost 2 Mood instead of 1 Culture.'),
      V('city_states', 'City States', 'voting', 'Once per turn, when activating a city a second time, let another city of at least equal size and Mood count as activated instead.'),
    ]),
    C('huns', 'Huns', [
      V('nomads', 'Nomads', 'storage', 'During a Move, your non-Angry size-1 cities may move like units and gain 1 resource from the new space. Each move activates them.'),
      V('mounted_archers', 'Mounted Archers', 'husbandry', 'All your cities build Cavalry. Your Cavalry need not be lost before Infantry.'),
      V('raiders', 'Raiders', 'tactics', 'Enemy Settlers within 2 spaces of a Hun Army cannot Found cities or form trade routes without an Army or city.'),
      V('hunnic_tribes', 'Hunnic Tribes', 'government', 'When an Event makes the Barbarians move, pay 1 Gold or 1 Culture to choose the direction of each Barbarian army.'),
    ]),
    C('india', 'India', [
      V('indian_elephants', 'Indian Elephants', 'husbandry', 'All your cities build Elephants. Elephants may start trade routes unless in an Angry city.'),
      V('proselytism', 'Proselytism', 'state_religion', 'Settlers may Influence Culture at range 2; each other Settler in the space adds +1 range.'),
      V('prosperity', 'Prosperity', 'trade_routes', 'A trade route may give 1 Mood instead of Food or Gold, or 1 Culture when the target is under your influence.'),
      V('peace_and_poetry', 'Peace and Poetry', 'theaters', 'Once per turn, pay 1 Mood instead of 2 Food for an Advance.'),
    ]),
    C('japan', 'Japan', [
      V('pottery', 'Pottery', 'storage', 'Gain 1 Culture whenever a city collects at least 3 Food with a single Collect action.'),
      V('horsemanship', 'Horsemanship', 'husbandry', 'All your cities build Cavalry. In round 1 an Army with Cavalry may reroll 1 die for 1 Culture (free with Rituals).'),
      V('subterfuge', 'Subterfuge', 'tactics', 'Discard an Action card to cancel a non-combat Action card an opponent plays within 2 spaces of your cities or Army.'),
      V('shogunate', 'Shogunate', 'government', 'A card played "as an Action" may be played as a free action instead. Draft may pay 1 Mood to draw an Action card instead of an Infantry.'),
    ]),
    C('maya', 'Maya', [
      V('terracing', 'Terracing', 'irrigation', 'Collect Ore, Wood or Food from Mountain spaces. Settlers ignore Mountain penalties.'),
      V('stelas', 'Stelas', 'arts', 'Gain 1 Culture or 1 Idea when you raise a city\'s size with an Obelisk, Found a city or capture a city.'),
      V('ballcourts', 'Ballcourts', 'sports', 'Pay 1 Mood to treat a city as 1 size larger when Collecting or Recruiting. Once per turn, a Spirituality Advance costs 1 Food less.'),
      V('calendar', 'Calendar', 'astronomy', 'Free action: look at the top Event card, then pay 1 Culture to put it at the bottom of the deck, as often as you like.'),
    ]),
    C('persia', 'Persia', [
      V('persian_elephants', 'Elephants', 'husbandry', 'All your cities build Elephants. In round 1 each of your Elephants cancels the bonus of one enemy Cavalry.'),
      V('immortals', 'Immortals', 'draft', 'Before each combat round, spend up to 4 Culture for +1 CV each.'),
      V('zoroastrianism', 'Zoroastrianism', 'priesthood', 'Influence Culture on an enemy Army unit outside cities to turn it your colour, then battle the others there.'),
      V('banking', 'Banking', 'currency', 'At the start of your turn, gain 1 Gold or 1 Culture if you already hold any Gold.'),
    ]),
    C('phoenicia', 'Phoenicia', [
      V('city_independence', 'City Independence', 'fishing', 'Your Ports gain the Obelisk power and score 1 1/2 VP each. Your Government Advances score 0 VP.'),
      V('biremes', 'Biremes', 'warships', '+1 hit in round 1 of naval battles against opponents (Pirates too) who lack Warships.'),
      V('alphabet', 'Alphabet', 'writing', 'Up to 2 trade routes may each give 1 Culture or 2 Ideas instead of Food or Gold.'),
      V('cedars_and_dyes', 'Cedars and Dyes', 'trade_routes', 'Ships, and Port cities alone, may form trade routes with coastal cities up to 3 spaces away.'),
    ]),
    C('rome', 'Rome', [
      V('aqueducts', 'Aqueducts', 'engineering', 'Ignore Famine events. Sanitation costs no Food, or no action.'),
      V('imperial_roads', 'Imperial Roads', 'roads', 'Roads reach up to 4 spaces for a unit or group that starts and ends in one of your cities (still 1 Ore and 1 Food per group).'),
      V('slave_economy', 'Slave Economy', 'bartering', 'Mood pays for any resource when increasing city size. Gain 1 Gold and 1 Mood after winning any battle.'),
      V('provinces', 'Provinces', 'government', 'All your cities build Cavalry. A city you capture may be made Neutral, or Happy for 1 Culture.'),
    ]),
    C('vikings', 'Vikings', [
      V('shipcraft', 'Shipcraft', 'fishing', 'Moving Infantry and Settlers into an adjacent empty Sea space makes them Ships, and Ships beside Land turn back. Navigation costs no Food.'),
      V('longships', 'Longships', 'warships', 'Ships may move after a battle this turn and carry up to 3 Land units.'),
      V('runestones', 'Runestones', 'rituals', 'After a battle in which you lose 2 or more Army units, take an unused Obelisk as a completed 1 VP Objective.'),
      V('marauders', 'Marauders', 'trade_routes', 'When your Ships pair with adjacent opponent cities for trade routes, each of those cities\' owners loses 1 resource of their choice.'),
    ]),
  ].map((c) => [c.id, c]),
);

export const CIV_ORDER = Object.keys(CIVS);

export const CIV_ADVANCES = {};
export const CIV_OF_ADVANCE = {};
for (const c of Object.values(CIVS)) {
  c.advances.forEach((a, i) => {
    a.civ = c.id;
    a.index = i;
    CIV_ADVANCES[a.id] = a;
    CIV_OF_ADVANCE[a.id] = c.id;
  });
}

/** The Government Advances' category ids (a Civilization Advance may be triggered by any of them). */
export const GOVERNMENT_TRIGGER = 'government';
