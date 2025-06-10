/**
 * types.ts
 * Ce fichier contient les définitions de types et interfaces partagées
 * pour l'ensemble des Cloud Functions du projet Korean Party.
 */
import { SpellId } from "./spells";

// Représente l'état d'un joueur dans une partie
export interface Player {
  uid: string;
  displayName: string;
  position: number;
  mana: number;
  grimoires: number; // AJOUT : Nombre de grimoires collectés
  effects?: Array<{ // Added
    type: string; // e.g., 'SHIELDED', 'SKIP_TURN'
    duration: number;
    spellId?: SpellId; // Optional: to know which spell caused the effect
    [key: string]: any; // Optional: for future flexibility
  }>;
  skipNextTurn?: boolean; // Will be conceptually replaced by effects array
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
  turnState?: "AWAITING_ROLL" | "RESOLVING_TILE" | "ENDED"; // Added "ENDED" state
  lastDiceRoll?: number;
  board?: Tile[]; // AJOUT : Le plateau de jeu de la session
  grimoirePositions?: number[]; // Positions des grimoires sur le plateau
  winnerId?: string; // Pour stocker le gagnant à la fin
  // Pour notifier le client d'un sort lancé
  lastSpellCast?: {
    spellId: SpellId;
    casterId: string;
    targetId?: string; // Can be null for terrain spells like RUNE_TRAP
    options?: any; // For additional data like tileIndex for RUNE_TRAP
  };
  lastEventCard?: { // Added to store information about the last drawn event card
    title: string;
    description: string;
    // id?: string; // if needed to reference back to eventCards data
  };
  createdAt: FirebaseFirestore.Timestamp;
}

// Represents a member of a Guild
export interface GuildMember {
  uid: string;
  displayName: string;
}

// Represents a Guild
export interface Guild {
  id: string; // Document ID
  name: string; // Guild name, unique
  tag: string; // Guild tag, unique, short (e.g., 3-5 chars)
  leaderId: string; // UID of the player who is the leader
  members: GuildMember[]; // Array of guild members
  createdAt: FirebaseFirestore.Timestamp; // Server timestamp of creation
}

// It seems UserProfile is implicitly defined in src/index.ts's createProfileOnSignup.
// For clarity, and if other parts of the backend might benefit, we can add it here.
// Otherwise, we'll just assume 'users' documents have an optional 'guildId'.
// For now, let's add a UserProfile interface for completeness.
export interface UserProfile {
  email: string;
  pseudo: string;
  level: number;
  xp: number;
  manaCurrent: number;
  manaMax: number;
  fragments: { vocab: number; grammar: number; culture: number };
  createdAt: FirebaseFirestore.Timestamp;
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
