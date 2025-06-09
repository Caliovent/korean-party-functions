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
  id: string; // L'ID du document Firestore
  name: string;
  hostId: string;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  currentPlayerId?: string; // L'UID du joueur dont c'est le tour
  lastDiceRoll?: number; // Le résultat du dernier lancer de dé
  turnState?: "ROLLING" | "MOVING" | "RESOLVING_TILE" | "ENDED";
  createdAt: FirebaseFirestore.Timestamp;
}
