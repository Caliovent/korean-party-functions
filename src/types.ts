/**
 * types.ts
 * Ce fichier contient les définitions de types et interfaces partagées
 * pour l'ensemble des Cloud Functions du projet Korean Party.
 */
import { SpellId } from "./spells";
import * as admin from "firebase-admin";

// Représente l'état d'un joueur dans une partie

// Hangeul Typhoon Game Mechanics
export interface TyphoonBlock {
  id: string;
  text: string;
  vulnerableAt: admin.firestore.Timestamp;
  isDestroyed: boolean;
}

export interface Player {
  uid: string;
  displayName: string;
  position: number;
  mana: number;
  grimoires: Grimoire[];
  effects?: Array<{ // Added
    type: string; // e.g., 'SHIELDED', 'SKIP_TURN'
    duration: number;
    spellId?: SpellId; // Optional: to know which spell caused the effect
    [key: string]: unknown; // Optional: for future flexibility
  }>;
  skipNextTurn?: boolean; // Will be conceptually replaced by effects array
  groundHeight: number; // Hangeul Typhoon
  blocks: TyphoonBlock[]; // Hangeul Typhoon
}

export interface Grimoire {
  id: string;
  name: string;
  progress: number; // Progress towards completion
  target: number; // Target number of words to complete the grimoire
  // Additional properties can be added later, e.g., description, image URL
  // For now, we keep it simple
  // to focus on the core game mechanics.
//   description?: string; // Optional: description of the grimoire
//   imageUrl?: string; // Optional: URL to an image representing the grimoire
}


// Définition d'une case de jeu
export interface Tile {
  type: "MANA_GAIN" | "SAFE_ZONE" | "MINI_GAME_QUIZ" | "event"; // Added "event" type
  trap?: { // Added for RUNE_TRAP
    ownerId: string;
    spellId: SpellId; // To identify the trap type if multiple trap spells exist
  };
  // On pourra ajouter d'autres propriétés plus tard (ex: manaValue: 10)
}

export interface Game {
  id: string;
  name: string;
  hostId: string;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  currentPlayerId?: string;
  turnState?: "AWAITING_ROLL" | "MOVING" | "RESOLVING_TILE" | "ENDED";
  lastDiceRoll?: number | null;
  board?: Tile[]; // AJOUT : Le plateau de jeu de la session
  grimoirePositions?: number[]; // Positions des grimoires sur le plateau
  winnerId?: string; // Pour stocker le gagnant à la fin
  // Pour notifier le client d'un sort lancé
  lastSpellCast?: {
    spellId: SpellId;
    casterId: string;
    targetId?: string; // Can be null for terrain spells like RUNE_TRAP
    options?: Record<string, unknown>; // For additional data like tileIndex for RUNE_TRAP
  };
  lastEventCard?: {
    titleKey: string; // Corresponds to EventCard.titleKey
    descriptionKey: string; // Corresponds to EventCard.descriptionKey
    GfxUrl: string; // Corresponds to EventCard.GfxUrl
    type?: string; // Denormalized EventCard.type for easier client logic
  };
  createdAt: admin.firestore.Timestamp;
  // Effects array for spells like Memory Fog, Mana Shield
  effects?: Array<{
    type: string;
    duration: number;
    spellId?: SpellId;
    [key: string]: unknown;
  }>;
  skipNextTurn?: boolean;
  // Fields for Hangeul Typhoon mini-game
  groundHeight: number;
  blocks: TyphoonBlock[];
  // Guild related fields for the player object within a game context (if different from UserProfile)
  // guildId?: string;
  // guildTag?: string;
}

// Represents a member of a Guild within the Guild document
export interface GuildMemberDetail {
  role: string; // e.g., "master", "member", "officer"
  displayName: string;
  joinedAt: admin.firestore.Timestamp;
  // Potentially other stats specific to guild context later
}

// Represents a Guild
export interface Guild {
  id: string; // Document ID, should be same as the Firestore document ID
  name: string; // Guild name, unique
  tag: string; // Guild tag, unique, short (e.g., 3-5 chars)
  description: string; // Guild description
  emblem: string; // URL or identifier for the guild emblem
  leaderId: string; // UID of the player who is the leader (master)
  members: Record<string, GuildMemberDetail>; // Map of UID to GuildMemberDetail
  memberCount: number; // Current number of members in the guild
  createdAt: admin.firestore.Timestamp; // Server timestamp of creation
  // Consider adding:
  // maxMembers?: number;
  // recruitmentPolicy?: "open" | "invite_only";
}

// It seems UserProfile is implicitly defined in src/index.ts's createProfileOnSignup.
// For clarity, and if other parts of the backend might benefit, we can add it here.
// Otherwise, we'll just assume 'users' documents have an optional 'guildId'.
// For now, let's add a UserProfile interface for completeness.
export interface UserProfile {
  email: string;
  displayName: string;
  level: number;
  xp: number;
  manaCurrent: number;
  manaMax: number;
  fragments: { vocab: number; grammar: number; culture: number };
  createdAt: admin.firestore.Timestamp;
  guildId?: string; // Optional: ID of the guild the user belongs to
  totalExperience?: number; // Added for Grimoire Vivant
  wizardLevel?: number; // Added for Grimoire Vivant
  // Add the new stats object below
  stats: {
    gamesPlayed: number;
    gamesWon: number;
    duelsWon: number; // Nombre de duels "Hangeul Typhoon" gagnés
    spellsCast: number; // Nombre total de sorts lancés
    grimoiresCollected: number; // Nombre total de grimoires collectés à travers toutes les parties
    wordsTypedInTyphoon: number; // Nombre total de mots corrects tapés dans "Hangeul Typhoon"
    perfectQuizzes: number; // Nombre de mini-jeux de quiz réussis sans erreur
  };
  ownedCosmetics: string[]; // IDs of cosmetics owned by the user
  equippedCosmetics: { // IDs of equipped cosmetics per slot
    outfit: string | null;
    pet: string | null;
    spellEffect: string | null;
  };
}

// Request Payload Interface for Hangeul Typhoon Attack
export interface SendTyphoonAttackRequest {
  gameId: string;
  attackerPlayerId: string;
  targetPlayerId: string;
  attackWord: string;
}

// Response Payload Interfaces for Hangeul Typhoon Attack
export interface SendTyphoonAttackResponseBase {
  status: "success" | "failure";
  attackerPlayerId: string;
}

export interface SendTyphoonAttackSuccessResponse extends SendTyphoonAttackResponseBase {
  status: "success";
  message: string;
  targetPlayerId: string;
  destroyedBlockWord: string;
  targetGroundRiseAmount: number;
}

export interface SendTyphoonAttackFailureResponse extends SendTyphoonAttackResponseBase {
  status: "failure";
  reason: string;
  message: string;
  attackerPenaltyGroundRiseAmount: number;
}

export type SendTyphoonAttackResponse = SendTyphoonAttackSuccessResponse | SendTyphoonAttackFailureResponse;

// --- Quest System Types ---

/**
 * Describes a single objective within a quest.
 */
export interface QuestObjective {
  description: string; // e.g., "Réussir 3 mini-jeux sur le thème de la nourriture"
  type: string; // e.g., "minigame_food_completed", "collect_grimoire_X", "cast_spell_Y"
  target: number; // e.g., 3 (for 3 mini-games)
  // Optional: specific ID related to the objective, e.g. grimoireId if type is "collect_grimoire_X"
  targetId?: string;
}

/**
 * Represents a single item (e.g., word, concept) being learned by a user,
 * managed by the Spaced Repetition System (SRS).
 * Stored in `users/{userId}/spellMastery/{itemId}`.
 */
export interface SpellMasteryItem {
  id: string; // Document ID, should be the same as the Firestore document ID (e.g., a unique hash of the word or a UUID)
  userId: string; // The UID of the user this item belongs to

  // Core content
  word: string; // The Korean word or concept text
  translation: string; // Translation or definition of the word
  // Consider adding:
  // romanization?: string;
  // audioUrl?: string; // URL to an audio pronunciation
  // exampleSentence?: string;

  // SRS Algorithm fields (SM-2 like)
  masteryLevel: number; // Current level of mastery (e.g., 0-8). Higher means better known.
                        // Level 0 could mean "new" or "just failed".
  nextReviewDate: admin.firestore.Timestamp; // When this item should be reviewed next.
  lastReviewedDate?: admin.firestore.Timestamp; // When this item was last reviewed.
  easeFactor: number; // Factor determining how much the interval increases (e.g., starts at 2.5).
  interval: number; // The current interval in days (or other unit) before the next review.
                    // This is the interval that led to the current nextReviewDate.
  reviews: number; // Total number of times this item has been reviewed.
  lapses: number; // Number of times the user failed to recall this item after it was learned (masteryLevel > 0).

  // Optional: For grouping or categorization
  // category?: string; // e.g., "vocabulary", "grammar rule", "hanja"
  // tags?: string[];
}

/**
 * Describes the rewards for completing a quest.
 */
export interface QuestReward {
  xp?: number;
  mana?: number;
  // Potentially other types of rewards: items, currency, etc.
  // itemIds?: string[];
  // fragments?: { vocab?: number; grammar?: number; culture?: number };
}

/**
 * Defines the structure of a quest as stored in the `questDefinitions` collection.
 */
export interface QuestDefinition {
  id: string; // Document ID, same as the questId
  title: string;
  description: string;
  objectives: QuestObjective[];
  rewards: QuestReward;
  // Optional:
  // prerequisites?: { questIds?: string[]; level?: number }; // Quests or level required to start this one
  // isRepeatable?: boolean;
  // category?: string; // e.g., "daily", "main_story", "event"
}

/**
 * Base data for a player's quest entry (active or completed).
 */
export interface PlayerQuestBase {
  questId: string; // Reference to the QuestDefinition
  // title?: string; // Denormalized for easier display, but can be fetched from QuestDefinition
  // description?: string; // Denormalized
}

/**
 * Represents a quest currently active for a player.
 * Stored in `playerQuests/{userId}/activeQuests/{questId}`.
 */
export interface PlayerActiveQuest extends PlayerQuestBase {
  progress: number; // Current progress towards the objective's target
  currentStep: number; // For multi-step objectives within a single quest (0-indexed)
  startedAt: admin.firestore.Timestamp;
  // Optional: specific progress details if objectives are complex
  // objectiveProgress?: { [objectiveType: string]: number };
}

/**
 * Represents a quest completed by a player.
 * Stored in `playerQuests/{userId}/completedQuests/{questId}`.
 */
export interface PlayerCompletedQuest extends PlayerQuestBase {
  completedAt: admin.firestore.Timestamp;
  // Optional: Store how rewards were given, or if they were claimed separately
  // rewardsClaimed?: boolean;
}
