// src/data/achievements.ts

// Define UserStats type/interface based on the stats object in UserProfile
// This is needed for type safety on trigger.stat
export interface UserStats {
  gamesPlayed: number;
  gamesWon: number;
  duelsWon: number;
  spellsCast: number;
  grimoiresCollected: number;
  wordsTypedInTyphoon: number;
  perfectQuizzes: number;
}

export interface Achievement {
  id: string; // Unique ID for the achievement, e.g., 'FIRST_WIN', 'SPELL_MASTER_1'
  name: string; // Display name, e.g., "Première Victoire"
  description: string; // Description, e.g., "Gagner votre première partie."
  iconUrl: string; // URL to the achievement icon (placeholder for now)
  trigger: {
    stat: keyof UserStats; // The specific stat that triggers this achievement
    value: number; // The value the stat must reach
  };
}

export const ALL_ACHIEVEMENTS: Achievement[] = [
  {
    id: 'FIRST_GAME_PLAYED',
    name: "Baptême du Feu",
    description: "Jouer votre première partie.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/default_icon.png", // Placeholder
    trigger: {
      stat: 'gamesPlayed',
      value: 1,
    },
  },
  {
    id: 'FIRST_WIN',
    name: "Première Victoire",
    description: "Gagner votre première partie.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/first_win.png", // Placeholder
    trigger: {
      stat: 'gamesWon',
      value: 1,
    },
  },
  {
    id: 'SPELL_NOVICE',
    name: "Apprenti Sorcier",
    description: "Lancer 10 sorts.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/spell_novice.png", // Placeholder
    trigger: {
      stat: 'spellsCast',
      value: 10,
    },
  },
  {
    id: 'SPELL_ADEPT',
    name: "Sorcier Adepte",
    description: "Lancer 50 sorts.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/spell_adept.png", // Placeholder
    trigger: {
      stat: 'spellsCast',
      value: 50,
    },
  },
  {
    id: 'TYPHOON_PARTICIPANT',
    name: "Plume Agile",
    description: "Taper 100 mots dans Hangeul Typhoon.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/typhoon_participant.png", // Placeholder
    trigger: {
      stat: 'wordsTypedInTyphoon',
      value: 100,
    },
  },
  {
    id: 'TYPHOON_PRODIGY_1',
    name: "Prodige du Typhoon",
    description: "Gagner 1 duel Hangeul Typhoon.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/typhoon_prodigy_1.png", // Placeholder
    trigger: {
      stat: 'duelsWon',
      value: 1,
    },
  },
  {
    id: 'QUIZ_MASTER_1',
    name: "Cerveau Vif",
    description: "Réussir 1 quiz parfaitement.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/quiz_master_1.png", // Placeholder
    trigger: {
      stat: 'perfectQuizzes',
      value: 1,
    },
  },
  {
    id: 'GRIMOIRE_COLLECTOR_1',
    name: "Collectionneur de Grimoires (Niveau 1)",
    description: "Collecter 5 grimoires au total.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/grimoire_collector_1.png", // Placeholder
    trigger: {
      stat: 'grimoiresCollected',
      value: 5,
    },
  },
  {
    id: 'FIVE_GAMES_WON',
    name: "Vétéran Émérite",
    description: "Gagner 5 parties.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/default_icon.png", // Placeholder
    trigger: {
      stat: 'gamesWon',
      value: 5,
    },
  },
  {
    id: 'FIFTY_GAMES_PLAYED',
    name: "Habitué des Arènes",
    description: "Jouer 50 parties.",
    iconUrl: "gs://korean-party-dev.appspot.com/icons/achievements/default_icon.png", // Placeholder
    trigger: {
      stat: 'gamesPlayed',
      value: 50,
    },
  }
];

// Ensure UserStats matches the structure of the `stats` object in `UserProfile` from `src/types.ts`.
// The `id` for achievements should be unique and preferably in a format like 'SPELL_MASTER_1' as per the issue,
// I've used a mix but will ensure they are descriptive strings.
// Icon URLs are placeholders; actual URLs would be needed. Using gs:// paths as an example if they are stored in Cloud Storage.
