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
