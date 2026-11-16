// Leaders (Civilizations module): 3 per Civilization, 2 abilities each (source/leaders.md). A Leader is an Army Unit that is
// Recruited for 1 Culture and 1 Mood; only one may be in play, and a Leader that dies or is replaced is gone for the game.
// `kind` says how an ability is used: 'passive' (always on), 'action' (As an Action: it costs one of the 3 main actions) or
// 'free' (a Free Action). The rules for each ability live where the rule it changes lives (see src/engine/leaders.js).

const L = (id, name, civ, a, b) => ({
  id,
  name,
  civ,
  abilities: [
    { id: `${id}_a`, kind: a[0], text: a[1] },
    { id: `${id}_b`, kind: b[0], text: b[1] },
  ],
});
const P = (text) => ['passive', text];
const A = (text) => ['action', text];
const F = (text) => ['free', text];

export const LEADERS = Object.fromEntries([
  L('acamapichtli', 'Acamapichtli', 'aztecs',
    P('When Increasing City Size in his city, Captives may be spent 1:1 as any resource.'),
    P('May use Tribute Empire in cities he is in, by paying 1 Captive rather than 2 Mood tokens.')),
  L('ahuitzotl', 'Ahuitzotl', 'aztecs',
    P('His Army may cancel a Hit after a combat roll on Regions with no Aztec cities (once per battle).'),
    F('May sacrifice 2 Captives to Increase City Size in his city or build a Wonder in his city at no action cost (once per turn).')),
  L('marqzen', 'Marqzen', 'aztecs',
    P('After an Event (not the Event icon) reduces the Mood or the units in his city, he may reverse the Mood drop and take back any or all units.'),
    A('May move an adjacent enemy player Land unit 1 space to a revealed Land space not adjacent to Marqzen (once per turn; it may not result in a battle).')),

  L('hammurabi', 'Hammurabi', 'babylonia',
    P('Increase Happiness: may improve his city directly to Happy by spending 1 Culture token.'),
    P('It costs no Food or Wood when building a Fortress to increase city size in his city.')),
  L('nabopolassar', 'Nabopolassar', 'babylonia',
    P('His Army gets +2 CV against players with an equal or greater number of cities.'),
    P('After any of your cities is captured, place a free Infantry with Nabopolassar.')),
  L('nebuchadnezzar', 'Nebuchadnezzar II', 'babylonia',
    P('May build the Great Gardens in his city even if unrevealed (take it from the deck). The cost is reduced by 1 Culture token and any 2 resources.'),
    P('His Army gets +2 CV when attacking cities with Temples.')),

  L('hanno', 'Hanno', 'carthage',
    F('May move with a group of Ships if they have not moved that turn and are not moved again that turn (once per turn).'),
    P('His Ship gets +2 CV in naval battles.')),
  L('dido', 'Queen Dido', 'carthage',
    P('When with a founding unit, the unit can found a city at no activation cost.'),
    P('Her city gets +2 CV if attacked. After surviving a combat round, you may eliminate her to force the attack to cease. No VP are awarded for Dido this way.')),
  L('hannibal', 'Hannibal', 'carthage',
    P('He may reroll one combat die in the first combat round, and reroll it twice if his army has fewer units. The results of any rerolls must be kept.'),
    P('When Elephants are with him, his entire group may ignore the Mountain penalty when moving.')),

  L('boudica', 'Queen Boudica', 'celts',
    P('Her Army gets +2 CV against an army with more Warfare Advances.'),
    P('When she is with a Settler that founds a city, pay 1 Food to keep the Settler.')),
  L('viriatus', 'Viriatus', 'celts',
    P('After each combat round he survives against a player army: may pay 2 Mood tokens to force an enemy Army unit from the battle to move to an adjacent Land space with no cities, units or Leaders.'),
    P('May play Combat cards on behalf of Barbarians defending or attacking from settlements within 2 spaces of Viriatus.')),
  L('vercingetorix', 'Vercingetorix', 'celts',
    P('His Army gets +1 CV for each of your Settlers within 2 spaces.'),
    P('When building units in his city, you may deploy each of them directly on any revealed, adjacent Land space without enemy units, enemy cities or enemy Leaders.')),

  L('qin', 'Qin Shi Huang', 'china',
    P('May build the Great Wall in his city even if unrevealed (take it from the deck). The cost is reduced by 1 Culture token and any 2 resources.'),
    P('Pay 2 Culture tokens to cancel a hit from a combat roll (max 1 per battle).')),
  L('wu_zetian', 'Empress Wu Zetian', 'china',
    A('Activate her city to buy an Agriculture Advance for 1 Culture token or 1 Mood token.'),
    P('Her Army gets +2 CV each round in which it has the most units.')),
  L('sun_tzu', 'Sun Tzu', 'china',
    A('Activate a city he is in to buy a Warfare Advance for 1 Culture token or 1 Mood token instead of any Food.'),
    P('Gets 1 Culture token and 1 Mood token upon winning a battle against an army in one combat round (including Barbarians).')),

  L('ramses', 'Ramses II', 'egypt',
    P('Get 1 Culture token or 2 Ideas when building an Obelisk.'),
    P('His Army gets +2 CV against coastal cities and his Ships get +2 CV against Pirates.')),
  L('cleopatra', 'Cleopatra', 'egypt',
    P('The city she is in has +1 Cultural Influence Range.'),
    F('May pay and place 1 Culture token in her city (once per turn). To attack any city with tokens in it, the attacking player must first pay an equal amount of Culture tokens to remove them.')),
  L('imhotep', 'Imhotep', 'egypt',
    P('Get 1 Idea after his city is activated for any purpose other than Collect.'),
    P('It costs no Food or Wood when building an Observatory to increase city size in his city.')),

  L('leonidas', 'Leonidas', 'greece',
    P('Get a Culture token after using the Draft Advance in his city.'),
    P('In Land battles, gets +2 CV for each Army unit his army is outnumbered by.')),
  L('pericles', 'Pericles', 'greece',
    A('Activate the city he is in to buy an Education Advance for 1 Culture token or 1 Mood token instead of any Food.'),
    P('His Ship gets +2 CV in naval battles.')),
  L('alexander', 'Alexander the Great', 'greece',
    P('He may play As an Action cards at no action cost by activating his city and paying 1 Culture token.'),
    P('His Army gets +1 CV for every Region that you have a city on (except your starting Region).')),

  L('attila', 'Attila', 'huns',
    P('Size 1 cities he is in act as one size larger when collecting or building units, unless they are Angry.'),
    P('In the first combat round, one Cavalry unit in his army also gains the Elephant ability to cancel hits.')),
  L('rugila', 'Rugila', 'huns',
    P('After he captures a city, get 2 Gold if there are any opponent cities (including Barbarians) within 2 spaces.'),
    P('Barbarian cities become Happy when he attacks and captures them.')),
  L('bleda', 'Bleda', 'huns',
    P('His city acts as Happy on its first activation, regardless of Mood.'),
    P('Opponent Fortresses cannot cancel hits against his army.')),

  L('akbar', 'Akbar the Great', 'india',
    P('Pay 2 Ore prior to a combat roll to have each of Akbar\'s Elephants add +1 CV every round until they are eliminated.'),
    P('Get 1 Gold whenever you move Akbar into one of your cities.')),
  L('ashoka', 'Ashoka the Great', 'india',
    P('His city may reroll Cultural Influence attempts if it has a Temple or if it tries to influence a Temple (once per turn).'),
    P('Gets 1 Culture token when capturing a city, or 2 tokens if it has a Temple.')),
  L('maharaja', 'Maharaja Sri Gupta', 'india',
    F('Advance into a new category at no action cost by activating his city and paying 1 Culture token in addition to the resource cost.'),
    P('His Army adds 2 CV in any round in which he does not play a Combat card.')),

  L('suiko', 'Empress Suiko', 'japan',
    A('Revert an influenced piece in her city (except Obelisks). It does not count as a Cultural Influence attempt. A Free Action if you have State Religion.'),
    P('+2 CV if defending.')),
  L('go_toba', 'Emperor Go-Toba', 'japan',
    P('Before rolling your combat dice: pay 1 Ore to give Go-Toba\'s army +2 CV for the rest of the battle.'),
    P('After using an Academy or Observatory to increase city size in his city, you may advance at no action cost.')),
  L('jimmu', 'Emperor Jimmu', 'japan',
    P('Your cities with Fortresses get +2 CV every round if they are within 2 spaces of Jimmu.'),
    P('After Jimmu has fought a battle, you may pay 1 Culture token to reclaim an Action card he spent during the battle.')),

  L('wak', 'Wak Chanil Ajaw', 'maya',
    P('Her Army gets +2 CV when it is within 2 spaces of any Maya city.'),
    P('After capturing a city: may remove 1 non-settlement city piece in your color and then increase city size in the city at no action cost and no resource cost.')),
  L('siyaj_kak', 'Siyaj Kak', 'maya',
    P('His Army gets a CV bonus equal to the size of the city he attacks (first combat round only).'),
    P('After his city increases city size, you may make a Cultural Influence attempt from the city at no action cost.')),
  L('pakal', 'K\'inich Janaab\' Pakal', 'maya',
    P('When moving with Settlers only, he (and the group) may move 2 spaces per Move action (may be used together with Roads to ignore terrain).'),
    P('A Culture token may be spent as any 2 resources when increasing city size in his city.')),

  L('xerxes', 'Xerxes', 'persia',
    P('His Army has a stacking limit of 5 (it may not play Combat cards until he has 4 or fewer Army units).'),
    P('Wonders built in his city cost 2 fewer resources, Culture tokens, or a mix of both.')),
  L('darius', 'Darius', 'persia',
    P('Get 1 Mood token if his city succeeds a Cultural Influence attempt.'),
    F('May use 2 Culture tokens to increase city size in his city at no action cost (once per turn).')),
  L('cyrus', 'Cyrus the Great', 'persia',
    A('Activate his city to get 1 Culture or Mood token for each Region with at least one of your cities (up to the size of his current city).'),
    P('His Combat cards may count as +2 CV instead of their normal effect. Decide after cards are revealed but before any dice are rolled.')),

  L('ithobaal', 'Ithobaal', 'phoenicia',
    P('After he captures a city under his Cultural Influence, the city becomes Happy (after Spoils of War and Refugees).'),
    P('His Army gets +2 CV when it is within 2 spaces of one of your cities with a Temple.')),
  L('hiram', 'King Hiram', 'phoenicia',
    P('When he is with a Ship or a Settler, it can establish a trade route that does not count towards the 4 trade routes limit.'),
    A('Activate a city he is in to buy a Construction Advance for 1 Culture token or 1 Mood token instead of any Food.')),
  L('pygmalion', 'Pygmalion', 'phoenicia',
    P('One trade route traced from a Settler or a Ship he is with grants +1 Gold or +1 Culture token.'),
    P('If his city is attacked, cancel a received hit by paying 1 Culture token (once per battle). Reclaim the token if the battle is won.')),

  L('caesar', 'Gaius Julius Caesar', 'rome',
    F('Activate his city to perform an Increase Happiness (civic improvement) on it.'),
    P('After capturing a city, may pay 1 Gold to immediately build units (Recruit) at no action cost. Units built this way cannot be moved as part of the same Move action as the attack.')),
  L('augustus', 'Emperor Augustus', 'rome',
    A('Activate his city to draw an Action or Objective card, then discard one of the same type (once per turn).'),
    P('His Army gets +2 CV on Regions without your cities.')),
  L('sulla', 'Sulla', 'rome',
    P('His city cannot be the target of foreign Cultural Influence, and any Barbarian attack on cities within 2 spaces may be cancelled (even foreign cities).'),
    P('Adds +2 CV against Barbarians.')),

  L('ragnar', 'Ragnar Lodbrok', 'vikings',
    P('Gets +2 Gold when capturing a non-Angry city.'),
    P('His Army gets +2 CV when attacking from a Ship.')),
  L('eric', 'Eric the Red', 'vikings',
    A('While on a Ship, pay 1 Culture token and place it on his Region (max one per Region). Each counts as a 1 VP objective.'),
    F('Eric and any Land units on board Ships in the same space as him may move to an adjacent Land space.')),
  L('cnut', 'Cnut the Great', 'vikings',
    P('Scoring: his city awards 0.5 VP for every space it is away from the space of your starting city.'),
    A('Activate a Happy city he is in to use Taxation (if you have it) at no Mood cost.')),
].map((l) => [l.id, l]));

export const LEADER_ORDER = Object.keys(LEADERS);

/** The three Leaders of each Civilization, in card order. */
export const LEADERS_OF = {};
for (const l of Object.values(LEADERS)) (LEADERS_OF[l.civ] ||= []).push(l.id);

export const LEADER_RECRUIT_COST = { culture: 1, mood: 1 };
/** Victory Points a defeated enemy Leader card is worth to the player holding it. */
export const LEADER_CAPTURE_VP = 2;
/** The 1 VP "objective" Eric the Red scores for each Culture token on a Region. */
export const ERIC_TOKEN_VP = 1;
