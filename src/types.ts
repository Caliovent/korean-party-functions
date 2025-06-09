/**
 * types.ts
 * Ce fichier contient les définitions de types et interfaces partagées
 * pour l'ensemble des Cloud Functions du projet Korean Party.
 */

// Représente l'état d'un joueur dans une partie
export interface Player {
  uid: string;
  displayName: string;
  position: number; // Numéro de la case sur le plateau
  mana: number; // Mana de départ
}

// Représente l'état complet d'une partie
export interface Game {
  id: string;
  name: string;
  hostId: string;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  currentPlayerId?: string;
  // Ajout d'une machine à état pour le tour
  turnState?: "AWAITING_ROLL" | "MOVING" | "RESOLVING_TILE";
  lastDiceRoll?: number;
  createdAt: FirebaseFirestore.Timestamp;
}
