export interface EventCard {
  id: string;
  title: string;
  description: string;
  effect: {
    type: "GIVE_MANA" | "MOVE_TO_TILE" | "SKIP_TURN" | "EXTRA_ROLL";
    value: number; // ex: 50 for GIVE_MANA, index de case pour MOVE_TO_TILE
  };
}

export const eventCards: EventCard[] = [
  {
    id: "EVENT_001",
    title: "Mana Surge",
    description: "A surge of mana flows through you!",
    effect: { type: "GIVE_MANA", value: 35 },
  },
  {
    id: "EVENT_002",
    title: "Unexpected Shortcut",
    description: "You discover an unexpected shortcut on the board.",
    effect: { type: "MOVE_TO_TILE", value: 15 }, // Assuming tile 15 is a beneficial location
  },
  {
    id: "EVENT_003",
    title: "Momentary Stumble",
    description: "You stumble and lose your next turn.",
    effect: { type: "SKIP_TURN", value: 1 }, // Value could represent number of turns to skip
  },
  {
    id: "EVENT_004",
    title: "Lucky Break",
    description: "You get a lucky break and roll again!",
    effect: { type: "EXTRA_ROLL", value: 1 }, // Value could represent number of extra rolls
  },
  {
    id: "EVENT_005",
    title: "Mana Drain",
    description: "An arcane anomaly drains some of your mana.",
    effect: { type: "GIVE_MANA", value: -25 }, // Negative value for losing mana
  },
  {
    id: "EVENT_006",
    title: "Mysterious Portal",
    description: "A mysterious portal transports you to a new location.",
    effect: { type: "MOVE_TO_TILE", value: 5 }, // Assuming tile 5
  },
  {
    id: "EVENT_007",
    title: "Sudden Gust of Wind",
    description: "A sudden gust of wind pushes you back a few spaces.",
    effect: { type: "MOVE_TO_TILE", value: -3 }, // Negative value for moving backwards
  },
];
