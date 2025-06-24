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
  lastEventCard?: { // Correspond à ce qui est stocké par resolveTileAction
    id?: string; // Optionnel, mais bon à avoir pour référence directe
    titleKey: string;
    descriptionKey: string;
    GfxUrl?: string; // Optionnel, si GfxUrl est ajouté à eventCardDataForFirestore
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
