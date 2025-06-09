/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable valid-jsdoc */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-len */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as functionsV1 from "firebase-functions/v1";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { FieldValue, DocumentReference } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { Player } from "./types";

admin.initializeApp();
const db = admin.firestore();

// =================================================================
//                    INTERFACES ET TYPES
// =================================================================

interface QuestStep {
  description: string;
  objective: string;
  completed: boolean;
}

interface Quest {
  questId: string;
  title: string;
  currentStep: number;
  steps: QuestStep[];
}

interface ReviewItem {
  id: string;
  lastReviewed: admin.firestore.Timestamp;
  correctStreak: number;
}

interface TileConfig {
  type: "start" | "finish" | "quiz" | "bonus" | "malus" | "event" | "duel" | "teleport" | "shop";
  data?: {
    mana?: number;
    xp?: number;
    quizId?: string;
    targetPosition?: number;
  };
}

type TileEffectHandler = (
  t: admin.firestore.Transaction,
  gameRef: DocumentReference,
  gameData: any,
  playerId: string,
  tileData?: { [key: string]: any }
) => Promise<void>;


// =================================================================
//                    FONCTIONS UTILITAIRES INTERNES
// =================================================================
// Fonction utilitaire pour compléter une étape de quête
/**
 * Complète une étape de quête et met à jour l'état de la quête.
 * @param quest La quête à mettre à jour.
 * @param stepIndex L'index de l'étape à compléter.
 * @returns La quête mise à jour.
 */
function completeQuestStep(quest: Quest, stepIndex: number): Quest {
  const newSteps = [...quest.steps];
  newSteps[stepIndex] = { ...newSteps[stepIndex], completed: true };
  return {
    ...quest,
    steps: newSteps,
    currentStep: quest.currentStep + 1,
  };
}

/**
 * Avance au joueur suivant dans l'ordre de jeu.
 * @param gameRef Référence du document de la partie.
 * @param gameData Les données de la partie.
 * @param t La transaction Firestore en cours.
 */
async function advanceToNextPlayer(gameRef: DocumentReference, gameData: any, t: admin.firestore.Transaction) {
  const currentPlayerIndex = gameData.turnOrder.indexOf(gameData.currentPlayerId);
  const nextPlayerIndex = (currentPlayerIndex + 1) % gameData.turnOrder.length;
  const nextPlayerId = gameData.turnOrder[nextPlayerIndex];
  t.update(gameRef, { currentPlayerId: nextPlayerId });
}

// =================================================================
//                    GESTION DES UTILISATEURS ET PROFILS
// =================================================================

export const createProfileOnSignup = functionsV1.auth.user().onCreate(async (user) => {
  const { uid, email } = user;
  if (!email) {
    logger.info(`Utilisateur anonyme ${uid} créé, pas de profil nécessaire.`);
    return null;
  }
  const userProfile = {
    email: email,
    pseudo: email.split("@")[0],
    level: 1,
    xp: 0,
    manaCurrent: 100,
    manaMax: 100,
    fragments: { vocab: 0, grammar: 0, culture: 0 },
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection("users").doc(uid).set(userProfile);
  return null;
});

export const updateUserProfile = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { pseudo } = request.data;
  const { uid } = request.auth;
  if (typeof pseudo !== "string" || pseudo.length < 3 || pseudo.length > 20) {
    throw new functionsV1.https.HttpsError("invalid-argument", "Le pseudo doit contenir entre 3 et 20 caractères.");
  }
  await admin.firestore().collection("users").doc(uid).update({ pseudo });
  return { status: "succès" };
});


// =================================================================
//                    GESTION DU LOBBY ET DES PARTIES
// =================================================================

/**
 * createGame
 * Crée une nouvelle partie dans Firestore en utilisant la syntaxe v2 des Cloud Functions.
 * L'utilisateur qui appelle cette fonction devient l'hôte.
 */
export const createGame = onCall(async (request) => { // MODIFIÉ ICI
  // 1. Validation de l'authentification
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Vous devez être connecté pour créer une partie."
    );
  }

  // 2. Validation des entrées
  const gameName = request.data.gameName; // MODIFIÉ ICI
  if (typeof gameName !== "string" || gameName.length < 3 || gameName.length > 50) {
    throw new HttpsError(
      "invalid-argument",
      "Le nom de la partie doit contenir entre 3 et 50 caractères."
    );
  }

  const uid = request.auth.uid; // MODIFIÉ ICI

  try {
    // 3. Récupérer les informations du joueur depuis la collection 'users'
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError(
        "not-found",
        "L'utilisateur n'existe pas dans la base de données."
      );
    }
    const userData = userDoc.data();
    const displayName = userData?.displayName || "Sorcier Anonyme";

    // 4. Préparation de l'objet Player pour l'hôte
    const hostPlayer: Player = {
      uid: uid,
      displayName: displayName,
      position: 0,
      mana: 20,
    };

    // 5. Création du nouvel objet Game
    const newGame = {
      name: gameName,
      hostId: uid,
      status: "waiting" as const,
      players: [hostPlayer],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // 6. Ajout du document à Firestore
    const gameRef = await db.collection("games").add(newGame);

    // 7. Retourner l'ID de la nouvelle partie
    return { gameId: gameRef.id };
  } catch (error) {
    console.error("Erreur lors de la création de la partie:", error);
    throw new HttpsError(
      "internal",
      "Une erreur interne est survenue lors de la création de la partie."
    );
  }
});


export const joinGame = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  const { uid } = request.auth;
  if (!gameId) throw new functionsV1.https.HttpsError("invalid-argument", "L'ID de la partie est requis.");

  const userDoc = await admin.firestore().collection("users").doc(uid).get();
  if (!userDoc.exists) throw new functionsV1.https.HttpsError("not-found", "Profil utilisateur non trouvé.");

  const gameRef = admin.firestore().collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  if (!gameDoc.exists) throw new functionsV1.https.HttpsError("not-found", "La partie n'existe pas.");

  const gameData = gameDoc.data()!;
  if (gameData.status !== "waiting") throw new functionsV1.https.HttpsError("failed-precondition", "La partie a déjà commencé.");
  if (gameData.players.includes(uid)) return { status: "déjà rejoint" };
  if (gameData.players.length >= 4) throw new functionsV1.https.HttpsError("failed-precondition", "La partie est pleine.");

  await gameRef.update({
    players: FieldValue.arrayUnion(uid),
    [`playerDetails.${uid}`]: { pseudo: userDoc.data()?.pseudo || "Joueur Anonyme" },
  });
  return { status: "succès" };
});

export const deleteGame = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  const { uid } = request.auth;
  if (!gameId) throw new functionsV1.https.HttpsError("invalid-argument", "L'ID de la partie est requis.");

  const gameRef = admin.firestore().collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  if (!gameDoc.exists) throw new functionsV1.https.HttpsError("not-found", "La partie n'existe pas.");
  if (gameDoc.data()?.hostId !== uid) throw new functionsV1.https.HttpsError("permission-denied", "Vous n'êtes pas l'hôte de cette partie.");

  await gameRef.delete();
  return { status: "succès" };
});

/** Génère la disposition du plateau de jeu.
* Le plateau est composé de 30 cases avec des types variés.
* - La première case est le point de départ.
* - La dernière case est la ligne d'arrivée.
* - Des cases bonus, malus, quiz et événements sont réparties sur le plateau.
*/
function generateBoardLayout(): TileConfig[] {
  const boardSize = 30;
  const layout: TileConfig[] = [];

  for (let i = 0; i < boardSize; i++) {
    if (i === 0) {
      layout.push({ type: "start" });
    } else if (i === boardSize - 1) {
      layout.push({ type: "finish" });
    } else if (i % 7 === 0) {
      layout.push({ type: "bonus", data: { mana: 15 } });
    } else if (i % 11 === 0) {
      layout.push({ type: "malus", data: { mana: -10 } });
    } else if (i % 5 === 0) {
      layout.push({ type: "event" });
    } else {
      layout.push({ type: "quiz" });
    }
  }
  return layout;
}


export const startGame = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  const { uid } = request.auth;
  if (!gameId) throw new functionsV1.https.HttpsError("invalid-argument", "L'ID de la partie est requis.");

  const gameRef = db.collection("games").doc(gameId);
  const gameDoc = await gameRef.get();
  const gameData = gameDoc.data()!;
  if (gameData.hostId !== uid) throw new functionsV1.https.HttpsError("permission-denied", "Seul l'hôte peut lancer la partie.");
  if (gameData.status !== "waiting") throw new functionsV1.https.HttpsError("failed-precondition", "La partie a déjà commencé.");

  const playerPositions: Record<string, number> = {};

  // --- MODIFICATION : Ajout de la quête d'introduction ---
  const playerQuests: Record<string, Quest> = {};
  const introQuest: Quest = {
    questId: "INTRO_01",
    title: "Les Premiers Pas du Sorcier",
    currentStep: 0,
    steps: [
      { description: "Lancez le dé pour la première fois.", objective: "roll_dice", completed: false },
      { description: "Réussissez votre premier quiz.", objective: "win_quiz", completed: false },
    ],
  };

  gameData.players.forEach((p: string) => {
    playerPositions[p] = 0;
    playerQuests[p] = introQuest; // Assigner la quête à chaque joueur
  });

  const boardLayout = generateBoardLayout();

  await gameRef.update({
    status: "in-progress",
    turnOrder: gameData.players,
    currentPlayerId: gameData.players[0],
    playerPositions,
    boardLayout,
    playerQuests, // Sauvegarder l'objet des quêtes
  });
  return { status: "succès" };
});


// =================================================================
//        ARCHITECTURE MODULAIRE POUR LA LOGIQUE DE JEU
// =================================================================

const handleBonusTile: TileEffectHandler = async (t, gameRef, gameData, playerId, tileData) => {
  const userRef = db.collection("users").doc(playerId);
  if (tileData?.mana) {
    t.update(userRef, { manaCurrent: FieldValue.increment(tileData.mana) });
  }
  if (tileData?.xp) {
    t.update(userRef, { xp: FieldValue.increment(tileData.xp) });
  }
  await advanceToNextPlayer(gameRef, gameData, t);
};

const handleMalusTile: TileEffectHandler = async (t, gameRef, gameData, playerId, tileData) => {
  const userRef = db.collection("users").doc(playerId);
  if (tileData?.mana) {
    t.update(userRef, { manaCurrent: FieldValue.increment(tileData.mana) });
  }
  await advanceToNextPlayer(gameRef, gameData, t);
};

const handleQuizTile: TileEffectHandler = async (t, gameRef, _gameData, playerId, _tileData) => {
  const updates = {
    currentMiniGame: { type: "quiz", question: "Le mot '친구' signifie :", options: ["Ami", "Famille", "Professeur"], correctAnswer: "Ami", playerId: playerId },
  };
  t.update(gameRef, updates);
};

const handleEventTile: TileEffectHandler = async (t, gameRef, _gameData, playerId, _tileData) => {
  const updates = {
    currentEvent: { type: "mana_bonus", title: "Pluie de Mana !", message: "Vous trouvez une source d'énergie magique. Vous gagnez 20 points de Mana !", playerId: playerId },
  };
  t.update(gameRef, updates);
};

const tileEffectHandlers: Record<string, TileEffectHandler> = {
  "bonus": handleBonusTile,
  "malus": handleMalusTile,
  "quiz": handleQuizTile,
  "event": handleEventTile,
};


export const takeTurn = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  const { uid } = request.auth;
  if (!gameId) throw new functionsV1.https.HttpsError("invalid-argument", "L'ID de la partie est requis.");

  const gameRef = db.collection("games").doc(gameId);

  try {
    return await db.runTransaction(async (t) => {
      const gameDoc = await t.get(gameRef);
      if (!gameDoc.exists) throw new functionsV1.https.HttpsError("not-found", "Partie non trouvée.");

      const gameData = gameDoc.data()!;
      if (gameData.currentPlayerId !== uid) throw new functionsV1.https.HttpsError("failed-precondition", "Ce n'est pas votre tour.");
      if (gameData.currentMiniGame || gameData.currentEvent) throw new functionsV1.https.HttpsError("failed-precondition", "Vous devez d'abord résoudre l'événement en cours.");

      const diceRoll = Math.floor(Math.random() * 6) + 1;
      const newPosition = (gameData.playerPositions[uid] + diceRoll);
      const tile = gameData.boardLayout[newPosition % gameData.boardLayout.length];

      const updates: Record<string, any> = {
        [`playerPositions.${uid}`]: newPosition,
        lastDiceRoll: { playerId: uid, value: diceRoll },
      };

      // --- MODIFICATION : Logique de quête activée ---
      const playerQuest = gameData.playerQuests?.[uid];
      if (playerQuest && playerQuest.steps[playerQuest.currentStep]?.objective === "roll_dice") {
        updates[`playerQuests.${uid}`] = completeQuestStep(playerQuest, playerQuest.currentStep);
      }

      t.update(gameRef, updates);

      const handler = tileEffectHandlers[tile.type];
      if (handler) {
        await handler(t, gameRef, gameData, uid, tile.data);
      } else {
        await advanceToNextPlayer(gameRef, gameData, t);
      }

      return { status: "succès", diceRoll };
    });
  } catch (error) {
    logger.error(`Erreur lors du tour de ${uid}:`, error);
    if (error instanceof functionsV1.https.HttpsError) throw error;
    throw new functionsV1.https.HttpsError("internal", "Impossible de jouer le tour.");
  }
});


export const submitMiniGameResults = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId, answer } = request.data;
  const { uid } = request.auth;
  if (!gameId || answer === undefined) throw new functionsV1.https.HttpsError("invalid-argument", "Données manquantes.");

  const gameRef = db.collection("games").doc(gameId);
  const userRef = db.collection("users").doc(uid);

  try {
    return await db.runTransaction(async (t) => {
      const gameDoc = await t.get(gameRef);
      if (!gameDoc.exists) throw new functionsV1.https.HttpsError("not-found", "Partie non trouvée.");

      const gameData = gameDoc.data()!;
      const miniGame = gameData.currentMiniGame;
      if (!miniGame || miniGame.playerId !== uid) throw new functionsV1.https.HttpsError("failed-precondition", "Pas de mini-jeu actif pour vous.");

      let resultMessage = "Réponse incorrecte.";
      const updates: Record<string, any> = { currentMiniGame: null };

      if (answer === miniGame.correctAnswer) {
        t.update(userRef, { "xp": FieldValue.increment(10), "fragments.vocab": FieldValue.increment(1) });
        resultMessage = "Bonne réponse ! +10 XP & +1 Fragment !";

        // --- MODIFICATION : Logique de quête activée ---
        const playerQuest = gameData.playerQuests?.[uid];
        if (playerQuest && playerQuest.steps[playerQuest.currentStep]?.objective === "win_quiz") {
          updates[`playerQuests.${uid}`] = completeQuestStep(playerQuest, playerQuest.currentStep);
        }
      }

      t.update(gameRef, updates);
      await advanceToNextPlayer(gameRef, gameData, t);

      return { status: "succès", message: resultMessage };
    });
  } catch (error) {
    logger.error(`Erreur de soumission du mini-jeu pour ${uid}:`, error);
    if (error instanceof functionsV1.https.HttpsError) throw error;
    throw new functionsV1.https.HttpsError("internal", "Impossible de traiter la réponse.");
  }
});

export const resolveEvent = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  const { uid } = request.auth;
  if (!gameId) throw new functionsV1.https.HttpsError("invalid-argument", "L'ID de la partie est requis.");

  const gameRef = db.collection("games").doc(gameId);
  const userRef = db.collection("users").doc(uid);

  try {
    return await db.runTransaction(async (t) => {
      const gameDoc = await t.get(gameRef);
      const gameData = gameDoc.data()!;
      const event = gameData.currentEvent;
      if (!event || event.playerId !== uid) throw new functionsV1.https.HttpsError("failed-precondition", "Pas d'événement actif pour vous.");

      if (event.type === "mana_bonus") {
        t.update(userRef, { manaCurrent: FieldValue.increment(20) });
      }

      t.update(gameRef, { currentEvent: null });
      await advanceToNextPlayer(gameRef, gameData, t);

      return { status: "succès", message: "Événement résolu." };
    });
  } catch (error) {
    logger.error(`Erreur de résolution de l'événement pour ${uid}:`, error);
    if (error instanceof functionsV1.https.HttpsError) throw error;
    throw new functionsV1.https.HttpsError("internal", "Impossible de traiter l'événement.");
  }
});


// =================================================================
//                    SYSTÈME DE RÉPÉTITION ESPACÉE (SRS)
// =================================================================

export const getReviewItems = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { uid } = request.auth;
  const query = admin.firestore().collection("users").doc(uid).collection("learningItemsStatus").orderBy("lastReviewed", "asc").limit(5);
  const snapshot = await query.get();
  const reviewItems = snapshot.docs.map((doc): ReviewItem => ({
    id: doc.id,
    ...(doc.data() as { lastReviewed: admin.firestore.Timestamp; correctStreak: number }),
  }));
  return { items: reviewItems };
});

export const submitSrsReview = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { itemId, wasCorrect } = request.data;
  const { uid } = request.auth;
  if (!itemId || wasCorrect === undefined) throw new functionsV1.https.HttpsError("invalid-argument", "Données manquantes.");

  const itemRef = admin.firestore().collection("users").doc(uid).collection("learningItemsStatus").doc(itemId);
  const updateData = {
    lastReviewed: FieldValue.serverTimestamp(),
    correctStreak: wasCorrect ? FieldValue.increment(1) : 0,
  };
  await itemRef.update(updateData);
  return { status: "succès" };
});

// =================================================================
//                    RÉCUPÉRATION DE DONNÉES SÉCURISÉES
// =================================================================

export const getUserProfile = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté pour accéder à ces données.");
  }
  const { uid } = request.auth;

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      throw new functionsV1.https.HttpsError("not-found", "Profil utilisateur non trouvé.");
    }
    return userDoc.data();
  } catch (error) {
    logger.error(`Erreur lors de la récupération du profil pour ${uid}:`, error);
    if (error instanceof functionsV1.https.HttpsError) throw error;
    throw new functionsV1.https.HttpsError("internal", "Impossible de récupérer le profil utilisateur.");
  }
});

export const getSecureData = onCall({ cors: true }, (request) => {
  const clientData = request.data.message;
  logger.info(`Message reçu du client : "${clientData}"`);

  if (!request.auth) {
    logger.warn("Un utilisateur non authentifié a appelé la fonction.");
  } else {
    logger.info(`Fonction appelée par l'utilisateur : ${request.auth.uid}`);
  }

  return {
    status: "succès",
    serverMessage: "Ceci est une réponse sécurisée depuis le serveur !",
    dataReceived: clientData,
  };
});
