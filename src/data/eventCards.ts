export interface EventCard {
  id: string; // Keep for local array key, will be document ID in Firestore
  titleKey: string;
  descriptionKey: string;
  GfxUrl: string;
  type: "BONUS_MANA" | "MALUS_MANA" | "QUIZ_CULTUREL" | "MOVE_RELATIVE" | "EXTRA_ROLL" | "SKIP_TURN_SELF";
  effectDetails: {
    manaAmount?: number; // For BONUS_MANA, MALUS_MANA
    moveAmount?: number; // For MOVE_RELATIVE
    quizId?: string; // For QUIZ_CULTUREL (future use)
    // EXTRA_ROLL and SKIP_TURN_SELF might not need details if their type is sufficient
  };
  rarity: "common" | "rare" | "epic";
}

export const eventCards: EventCard[] = [
  {
    id: "EVT001",
    titleKey: "event.mana_windfall.title",
    descriptionKey: "event.mana_windfall.desc",
    GfxUrl: "https://example.com/gfx/mana_windfall.png", // Placeholder GfxUrl
    type: "BONUS_MANA",
    effectDetails: { manaAmount: 20 },
    rarity: "common",
  },
  {
    id: "EVT002",
    titleKey: "event.mana_drain.title",
    descriptionKey: "event.mana_drain.desc",
    GfxUrl: "https://example.com/gfx/mana_drain.png", // Placeholder GfxUrl
    type: "MALUS_MANA",
    effectDetails: { manaAmount: -10 }, // Represents losing 10 mana
    rarity: "common",
  },
  {
    id: "EVT003",
    titleKey: "event.cultural_quiz.title",
    descriptionKey: "event.cultural_quiz.desc",
    GfxUrl: "https://example.com/gfx/cultural_quiz.png", // Placeholder GfxUrl
    type: "QUIZ_CULTUREL",
    effectDetails: { quizId: "CQ001" }, // No mechanical effect for now
    rarity: "common",
  },
  {
    id: "EVT004",
    titleKey: "event.lucky_break.title",
    descriptionKey: "event.lucky_break.desc",
    GfxUrl: "https://example.com/gfx/lucky_break.png", // Placeholder GfxUrl
    type: "EXTRA_ROLL",
    effectDetails: {},
    rarity: "rare",
  },
  {
    id: "EVT005",
    titleKey: "event.sudden_gust.title",
    descriptionKey: "event.sudden_gust.desc",
    GfxUrl: "https://example.com/gfx/sudden_gust.png", // Placeholder GfxUrl
    type: "MOVE_RELATIVE",
    effectDetails: { moveAmount: -3 }, // Move back 3 spaces
    rarity: "common",
  },
  {
    id: "EVT006",
    titleKey: "event.skip_turn.title",
    descriptionKey: "event.skip_turn.desc",
    GfxUrl: "https://example.com/gfx/skip_turn.png", // Placeholder GfxUrl
    type: "SKIP_TURN_SELF", // Current player skips their own next turn
    effectDetails: {},
    rarity: "common",
  },
];
