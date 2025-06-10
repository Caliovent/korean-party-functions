/* eslint-disable max-len */
import { setGlobalOptions } from "firebase-functions/v2"; // CORRECT : Importation depuis la racine v2
import { onCall, HttpsError } from "firebase-functions/v2/https"; // onCall et HttpsError restent ici
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { Player, Tile } from "./types";
import { SPELL_DEFINITIONS, SpellId } from "./spells";

// Helper pour générer un plateau de jeu par défaut
const generateBoardLayout = (): Tile[] => {
  const layout: Tile[] = [];
  for (let i = 0; i < 30; i++) {
    if (i === 0) layout.push({ type: "SAFE_ZONE" });
    else if (i % 3 === 0) layout.push({ type: "MINI_GAME_QUIZ" });
    else if (i % 2 === 0) layout.push({ type: "MANA_GAIN" });
    else layout.push({ type: "SAFE_ZONE" });
  }
  return layout;
};

setGlobalOptions({ region: "europe-west1" });

admin.initializeApp();
const db = admin.firestore();


// --- FONCTIONS DE GESTION DU LOBBY ---

export const createGame = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  }
  const gameName = request.data.gameName;
  if (typeof gameName !== "string" || gameName.length < 3) {
    throw new HttpsError("invalid-argument", "Le nom de la partie est invalide.");
  }
  const uid = request.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const displayName = userDoc.data()?.displayName || "Sorcier Anonyme";
  const hostPlayer: Player = { uid, displayName, position: 0, mana: 20, grimoires: 0 };
  const newGame = {
    name: gameName,
    hostId: uid,
    status: "waiting" as const,
    players: [hostPlayer],
    createdAt: FieldValue.serverTimestamp(),
  };
  const gameRef = await db.collection("games").add(newGame);
  return { gameId: gameRef.id };
});

export const joinGame = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID de jeu invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  if (!gameDoc.exists) throw new HttpsError("not-found", "Cette partie n'existe pas.");

  const gameData = gameDoc.data()!;
  const isPlayerInGame = gameData.players.some((p: Player) => p.uid === uid);
  // Correction de la ligne trop longue
  if (gameData.status !== "waiting" || gameData.players.length >= 4 || isPlayerInGame) {
    throw new HttpsError("failed-precondition", "Impossible de rejoindre cette partie.");
  }

  const userDoc = await db.collection("users").doc(uid).get();
  const displayName = userDoc.data()?.displayName || "Sorcier Anonyme";
  const newPlayer: Player = { uid, displayName, position: 0, mana: 20, grimoires: 0 };
  await gameRef.update({ players: FieldValue.arrayUnion(newPlayer) });
  return { success: true };
});

export const leaveGame = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  if (!gameDoc.exists) return { success: true };

  const gameData = gameDoc.data()!;
  if (gameData.hostId === uid) {
    await gameRef.delete();
    return { success: true, message: "Partie dissoute." };
  }

  const playerToRemove = gameData.players.find((p: Player) => p.uid === uid);
  if (playerToRemove) {
    await gameRef.update({ players: FieldValue.arrayRemove(playerToRemove) });
    return { success: true, message: "Vous avez quitté la partie." };
  }
  return { success: true };
});

// --- FONCTIONS DE FLUX DE JEU ---

export const startGame = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  const gameData = gameDoc.data();
  if (!gameData || gameData.hostId !== uid || gameData.status !== "waiting" || gameData.players.length < 2) {
    throw new HttpsError("failed-precondition", "Impossible de démarrer.");
  }

  const board = generateBoardLayout();
  const grimoirePositions: number[] = [];
  while (grimoirePositions.length < 3) {
    const pos = Math.floor(Math.random() * (board.length - 1)) + 1;
    if (!grimoirePositions.includes(pos)) grimoirePositions.push(pos);
  }

  const players = [...gameData.players];
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  await gameRef.update({
    status: "playing",
    players: players,
    currentPlayerId: players[0].uid,
    turnState: "AWAITING_ROLL",
    grimoirePositions: grimoirePositions,
    board: board,
  });
  return { success: true };
});

// --- FONCTIONS DE TOUR DE JEU ---

export const rollDice = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  const gameData = gameDoc.data();
  if (!gameData || gameData.status !== "playing" || gameData.currentPlayerId !== uid || gameData.turnState !== "AWAITING_ROLL") {
    throw new HttpsError("failed-precondition", "Impossible de lancer le dé.");
  }

  const diceResult = Math.floor(Math.random() * 6) + 1;
  const currentPlayer = gameData.players.find((p: Player) => p.uid === uid)!;
  const boardSize = 30;
  const newPosition = (currentPlayer.position + diceResult) % boardSize;

  const updatedPlayers = gameData.players.map((p: Player) =>
    p.uid === uid ? { ...p, position: newPosition } : p
  );

  await gameRef.update({
    players: updatedPlayers,
    lastDiceRoll: diceResult,
    turnState: "RESOLVING_TILE",
  });
  return { success: true, diceResult };
});

export const resolveTileAction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  const gameData = gameDoc.data();
  if (!gameData || !gameData.board || gameData.status !== "playing" || gameData.currentPlayerId !== uid || gameData.turnState !== "RESOLVING_TILE") {
    throw new HttpsError("failed-precondition", "Impossible de résoudre l'action.");
  }

  const board = gameData.board;
  const players = [...gameData.players];
  const grimoirePositions = [...(gameData.grimoirePositions || [])];
  const currentPlayerIndex = players.findIndex((p: Player) => p.uid === uid);
  let currentPlayer = players[currentPlayerIndex];
  const tile = board[currentPlayer.position];

  const grimoireIndex = grimoirePositions.indexOf(currentPlayer.position);
  if (grimoireIndex > -1) {
    currentPlayer = { ...currentPlayer, grimoires: currentPlayer.grimoires + 1 };
    players[currentPlayerIndex] = currentPlayer;
    grimoirePositions.splice(grimoireIndex, 1);

    if (currentPlayer.grimoires >= 3) {
      await gameRef.update({ players, grimoirePositions, status: "finished", winnerId: currentPlayer.uid, turnState: "ENDED" });
      return { success: true, effect: "VICTORY" };
    }
  }

  switch (tile.type) {
  case "MANA_GAIN": currentPlayer.mana += 10; break;
  }
  players[currentPlayerIndex] = currentPlayer;

  const nextPlayerIndex = (currentPlayerIndex + 1) % players.length;
  await gameRef.update({
    players: players,
    grimoirePositions: grimoirePositions,
    currentPlayerId: players[nextPlayerIndex].uid,
    turnState: "AWAITING_ROLL",
  });
  return { success: true };
});

export const castSpell = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId, spellId, targetId } = request.data;
  if (typeof gameId !== "string" || typeof spellId !== "string" || typeof targetId !== "string") {
    throw new HttpsError("invalid-argument", "Données de sort invalides.");
  }

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  const gameData = gameDoc.data();
  if (!gameData || gameData.status !== "playing" || gameData.currentPlayerId !== uid || gameData.turnState !== "AWAITING_ROLL") {
    throw new HttpsError("failed-precondition", "Impossible de lancer de sort.");
  }

  const spell = SPELL_DEFINITIONS[spellId as SpellId];
  if (!spell) throw new HttpsError("not-found", "Ce sort n'existe pas.");

  const casterIndex = gameData.players.findIndex((p: Player) => p.uid === uid);
  const targetIndex = gameData.players.findIndex((p: Player) => p.uid === targetId);
  if (casterIndex === -1 || targetIndex === -1 || uid === targetId) {
    throw new HttpsError("not-found", "Cible invalide.");
  }

  const players = [...gameData.players];
  if (players[casterIndex].mana < spell.manaCost) {
    throw new HttpsError("failed-precondition", "Mana insuffisant.");
  }

  players[casterIndex].mana -= spell.manaCost;
  switch (spell.id) {
  case "BLESSING_OF_HANGEUL": players[targetIndex].mana += 5; break;
  case "KIMCHIS_MALICE": players[targetIndex].mana = Math.max(0, players[targetIndex].mana - 8); break;
  }

  await gameRef.update({
    players: players,
    lastSpellCast: { spellId, casterId: uid, targetId },
  });
  return { success: true };
});
