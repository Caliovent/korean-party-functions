/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable valid-jsdoc */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-len */
import { onCall } from "firebase-functions/v2/https";
import * as functionsV1 from "firebase-functions/v1";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { FieldValue, DocumentReference } from "firebase-admin/firestore";

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

/**
 * @description Structure de configuration pour chaque case du plateau.
 * Cette interface est maintenant la source de vérité pour le backend et le frontend.
 */
interface TileConfig {
  type: "start" | "finish" | "quiz" | "bonus" | "malus" | "event" | "duel" | "teleport" | "shop";
  data?: {
    // Pour 'bonus' ou 'malus'
    mana?: number;
    xp?: number;
    // Pour 'quiz'
    quizId?: string;
    // Pour 'teleport'
    targetPosition?: number;
  };
}

/**
 * @description Définit la signature pour toutes les fonctions de gestion d'effets de case.
 */
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

/**
 * Met à jour un objet de quête en marquant une étape comme terminée.
 * @param {Quest} quest L'objet de quête du joueur.
 * @param {number} stepIndex L'index de l'étape à compléter.
 * @return {Quest} Le nouvel objet de quête mis à jour.
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
 * Fait passer le tour au joueur suivant dans l'ordre défini.
 * @param {DocumentReference} gameRef - Référence au document de la partie.
 * @param {any} gameData - Les données actuelles de la partie.
 * @param {admin.firestore.Transaction} t - La transaction Firestore en cours.
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

export const createGame = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { uid } = request.auth;
  const existingGamesQuery = admin.firestore().collection("games").where("hostId", "==", uid).where("status", "==", "waiting");
  if (!(await existingGamesQuery.get()).empty) {
    throw new functionsV1.https.HttpsError("already-exists", "Vous avez déjà une partie en attente.");
  }
  const userDoc = await admin.firestore().collection("users").doc(uid).get();
  if (!userDoc.exists) throw new functionsV1.https.HttpsError("not-found", "Profil utilisateur non trouvé.");

  const newGame = {
    hostId: uid,
    hostPseudo: userDoc.data()?.pseudo || "Hôte Anonyme",
    players: [uid],
    playerDetails: { [uid]: { pseudo: userDoc.data()?.pseudo || "Hôte Anonyme" } },
    status: "waiting",
    createdAt: FieldValue.serverTimestamp(),
  };
  const gameRef = await admin.firestore().collection("games").add(newGame);
  return { status: "succès", gameId: gameRef.id };
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

/**
 * @description Génère la disposition du plateau de jeu.
 * C'est ici que nous définissons le plateau pour chaque nouvelle partie.
 * Cette fonction est conçue pour être facilement modifiable pour créer des plateaux variés.
 * @return {TileConfig[]} Le tableau décrivant la configuration du plateau.
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
  gameData.players.forEach((p: string) => {
    playerPositions[p] = 0;
  });

  // Génération du plateau dynamique
  const boardLayout = generateBoardLayout();

  await gameRef.update({
    status: "in-progress",
    turnOrder: gameData.players,
    currentPlayerId: gameData.players[0],
    playerPositions,
    // Le plateau est maintenant stocké dans la partie, il devient la source de vérité.
    boardLayout,
    playerQuests: {}, // Quêtes initialisées plus tard
  });
  return { status: "succès" };
});


// =================================================================
//        NOUVELLE ARCHITECTURE MODULAIRE POUR LA LOGIQUE DE JEU
// =================================================================

/**
 * Gestionnaire pour les cases BONUS. Augmente le mana ou l'XP du joueur.
 * @param {admin.firestore.Transaction} t - La transaction Firestore.
 * @param {DocumentReference} gameRef - La référence au document du jeu.
 * @param {any} gameData - Les données actuelles du jeu.
 * @param {string} playerId - L'ID du joueur.
 * @param {any} tileData - Les données spécifiques à la case.
 * @return {Promise<void>}
 */
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

/**
 * Gestionnaire pour les cases MALUS. Diminue le mana du joueur.
 * @param {admin.firestore.Transaction} t - La transaction Firestore.
 * @param {DocumentReference} gameRef - La référence au document du jeu.
 * @param {any} gameData - Les données actuelles du jeu.
 * @param {string} playerId - L'ID du joueur.
 * @param {any} tileData - Les données spécifiques à la case.
 * @return {Promise<void>}
 */
const handleMalusTile: TileEffectHandler = async (t, gameRef, gameData, playerId, tileData) => {
  const userRef = db.collection("users").doc(playerId);
  if (tileData?.mana) {
    t.update(userRef, { manaCurrent: FieldValue.increment(tileData.mana) });
  }
  await advanceToNextPlayer(gameRef, gameData, t);
};

/**
 * Gestionnaire pour les cases QUIZ. Met en place un mini-jeu de quiz.
 * @param {admin.firestore.Transaction} t - La transaction Firestore.
 * @param {DocumentReference} gameRef - La référence au document du jeu.
 * @param {any} gameData - Les données actuelles du jeu.
 * @param {string} playerId - L'ID du joueur.
 * @param {any} _tileData - Les données spécifiques à la case (non utilisées pour l'instant).
 * @return {Promise<void>}
 */
const handleQuizTile: TileEffectHandler = async (t, gameRef, _gameData, playerId, _tileData) => {
  const updates = {
    currentMiniGame: { type: "quiz", question: "Le mot '친구' signifie :", options: ["Ami", "Famille", "Professeur"], correctAnswer: "Ami", playerId: playerId },
  };
  t.update(gameRef, updates);
};

/**
 * Gestionnaire pour les cases EVENT. Déclenche un événement aléatoire.
 * @param {admin.firestore.Transaction} t - La transaction Firestore.
 * @param {DocumentReference} gameRef - La référence au document du jeu.
 * @param {any} gameData - Les données actuelles du jeu.
 * @param {string} playerId - L'ID du joueur.
 * @param {any} _tileData - Les données spécifiques à la case (non utilisées pour l'instant).
 * @return {Promise<void>}
 */
const handleEventTile: TileEffectHandler = async (t, gameRef, _gameData, playerId, _tileData) => {
  const updates = {
    currentEvent: { type: "mana_bonus", title: "Pluie de Mana !", message: "Vous trouvez une source d'énergie magique. Vous gagnez 20 points de Mana !", playerId: playerId },
  };
  t.update(gameRef, updates);
};

// "Répertoire" de nos gestionnaires d'effets.
// Pour ajouter un nouveau type de case, il suffit de créer la fonction et de l'ajouter ici.
const tileEffectHandlers: Record<string, TileEffectHandler> = {
  "bonus": handleBonusTile,
  "malus": handleMalusTile,
  "quiz": handleQuizTile,
  "event": handleEventTile,
  // 'duel': handleDuelTile, // Prêt à être implémenté !
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

      // Logique de quête (ré-intégrée)
      const playerQuest = gameData.playerQuests?.[uid];
      if (playerQuest?.steps[playerQuest.currentStep]?.objective === "roll_dice") {
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
        const userUpdates = { "xp": FieldValue.increment(10), "fragments.vocab": FieldValue.increment(1) };
        t.update(userRef, userUpdates);
        resultMessage = "Bonne réponse ! +10 XP & +1 Fragment !";

        // Logique de quête (ré-intégrée)
        const playerQuest = gameData.playerQuests?.[uid];
        if (playerQuest?.steps[playerQuest.currentStep]?.objective === "win_quiz") {
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

/**
 * @description Récupère les données du profil de l'utilisateur connecté.
 * @param {object} request - La requête de la fonction.
 * @returns {Promise<any>} Le document du profil utilisateur.
 */
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

/**
 * @description Fonction d'appel sécurisée pour recevoir des données du client.
 * @param {object} request - La requête de la fonction.
 * @returns {Promise<object>} Un objet contenant un message de succès et les données reçues.
 */
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
