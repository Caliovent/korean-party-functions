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
}

// Définition d'une case de jeu
export interface Tile {
  type: "MANA_GAIN" | "SAFE_ZONE" | "MINI_GAME_QUIZ";
  // On pourra ajouter d'autres propriétés plus tard (ex: manaValue: 10)
}

export interface Game {
  id: string;
  name: string;
  hostId: string;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  currentPlayerId?: string;
  turnState?: "AWAITING_ROLL" | "RESOLVING_TILE";
  lastDiceRoll?: number;
  board?: Tile[]; // AJOUT : Le plateau de jeu de la session
  grimoirePositions?: number[]; // Positions des grimoires sur le plateau
  winnerId?: string; // Pour stocker le gagnant à la fin
  // Pour notifier le client d'un sort lancé
  lastSpellCast?: {
    spellId: SpellId;
    casterId: string;
    targetId: string;
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
}
