/* eslint-disable max-len */
import { setGlobalOptions } from "firebase-functions/v2"; // CORRECT : Importation depuis la racine v2
import { onCall, HttpsError } from "firebase-functions/v2/https"; // onCall et HttpsError restent ici
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore"; // DocumentReference removed
import * as functionsV1 from "firebase-functions";
import * as logger from "firebase-functions/logger";
import { Player, Tile, Guild, GuildMember } from "./types";
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


// =================================================================
//                    INTERFACES ET TYPES
// =================================================================

// interface QuestStep {
//   description: string;
//   objective: string;
//   completed: boolean;
// }

// interface Quest {
//   questId: string;
//   title: string;
//   currentStep: number;
//   steps: QuestStep[];
// }

// interface ReviewItem {
//   id: string;
//   lastReviewed: admin.firestore.Timestamp;
//   correctStreak: number;
// }

// interface TileConfig {
//   type: "start" | "finish" | "quiz" | "bonus" | "malus" | "event" | "duel" | "teleport" | "shop";
//   data?: {
//     mana?: number;
//     xp?: number;
//     quizId?: string;
//     targetPosition?: number;
//   };
// }

// type TileEffectHandler = (
//   t: admin.firestore.Transaction,
//   gameRef: DocumentReference,
//   gameData: admin.firestore.DocumentData | undefined,
//   playerId: string,
//   tileData?: { [key: string]: unknown }
// ) => Promise<void>;


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
// function completeQuestStep(quest: Quest, stepIndex: number): Quest {
//   const newSteps = [...quest.steps];
//   newSteps[stepIndex] = { ...newSteps[stepIndex], completed: true };
//   return {
//     ...quest,
//     steps: newSteps,
//     currentStep: quest.currentStep + 1,
//   };
// }

/**
 * Avance au joueur suivant dans l'ordre de jeu.
 * @param gameRef Référence du document de la partie.
 * @param gameData Les données de la partie.
 * @param t La transaction Firestore en cours.
 */
// async function advanceToNextPlayer(gameRef: DocumentReference, gameData: admin.firestore.DocumentData | undefined, t: admin.firestore.Transaction) {
//   if (!gameData || !gameData.turnOrder || !gameData.currentPlayerId) {
//     console.error("advanceToNextPlayer: gameData or essential properties are missing.");
//     return;
//   }
//   const currentPlayerIndex = gameData?.turnOrder?.indexOf(gameData?.currentPlayerId);
//   const nextPlayerIndex = (currentPlayerIndex !== undefined && gameData?.turnOrder) ? (currentPlayerIndex + 1) % gameData.turnOrder.length : undefined;
//   const nextPlayerId = (nextPlayerIndex !== undefined && gameData?.turnOrder) ? gameData.turnOrder[nextPlayerIndex] : undefined;
//   if (nextPlayerId !== undefined) {
//     t.update(gameRef, { currentPlayerId: nextPlayerId });
//   }
// }

// =================================================================
//                    GESTION DES UTILISATEURS ET PROFILS
// =================================================================

export const createProfileOnSignup = functionsV1.auth.user().onCreate(async (user: admin.auth.UserRecord) => {
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

export const updateUserProfile = onCall({ cors: true }, async (request: functionsV1.https.CallableRequest) => {
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
//                    GESTION DES GUILDES (MAISONS DE SORCIERS)
// =================================================================

export const createGuild = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
  // 1. Authenticate the user
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour créer une guilde.");
  }
  const uid = request.auth.uid;

  // 2. Validate input
  const { name, tag } = request.data;
  if (typeof name !== "string" || name.length < 3 || name.length > 30) {
    throw new HttpsError("invalid-argument", "Le nom de la guilde doit contenir entre 3 et 30 caractères.");
  }
  if (typeof tag !== "string" || tag.length < 2 || tag.length > 5) {
    throw new HttpsError("invalid-argument", "Le tag de la guilde doit contenir entre 2 et 5 caractères.");
  }

  const userRef = db.collection("users").doc(uid);
  const guildsRef = db.collection("guilds");

  try {
    return await db.runTransaction(async (transaction) => {
      // 3. Get user profile
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "Profil utilisateur non trouvé.");
      }
      const userData = userDoc.data();
      if (userData?.guildId) {
        throw new HttpsError("failed-precondition", "Vous êtes déjà membre d'une guilde.");
      }
      const displayName = userData?.pseudo || "Sorcier Anonyme"; // Use pseudo as displayName

      // 4. Check for uniqueness of guild name and tag
      const nameQuery = guildsRef.where("name", "==", name);
      const tagQuery = guildsRef.where("tag", "==", tag);

      const nameSnapshot = await transaction.get(nameQuery);
      if (!nameSnapshot.empty) {
        throw new HttpsError("already-exists", `Une guilde avec le nom "${name}" existe déjà.`);
      }

      const tagSnapshot = await transaction.get(tagQuery);
      if (!tagSnapshot.empty) {
        throw new HttpsError("already-exists", `Une guilde avec le tag "${tag}" existe déjà.`);
      }

      // 5. Create the new guild
      const newGuildRef = guildsRef.doc(); // Auto-generate ID
      const initialMember: GuildMember = { uid, displayName, };
      const newGuildData: Guild = {
        id: newGuildRef.id,
        name,
        tag,
        leaderId: uid,
        members: [initialMember],
        createdAt: admin.firestore.Timestamp.now(), // Use admin.firestore.Timestamp
      };
      transaction.set(newGuildRef, newGuildData);

      // 6. Update user's profile with guildId
      transaction.update(userRef, { guildId: newGuildRef.id });

      return { guildId: newGuildRef.id, message: "Guilde créée avec succès !" };
    });
  } catch (error) {
    logger.error(`Erreur lors de la création de la guilde par ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de la création de la guilde.");
  }
});

export const joinGuild = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
  // 1. Authenticate the user
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour rejoindre une guilde.");
  }
  const uid = request.auth.uid;

  // 2. Validate input
  const { guildId } = request.data;
  if (typeof guildId !== "string" || guildId.trim() === "") {
    throw new HttpsError("invalid-argument", "L'ID de la guilde est invalide.");
  }

  const userRef = db.collection("users").doc(uid);
  const guildRef = db.collection("guilds").doc(guildId);

  try {
    return await db.runTransaction(async (transaction) => {
      // 3. Get user profile
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "Profil utilisateur non trouvé.");
      }
      const userData = userDoc.data();
      if (userData?.guildId) {
        throw new HttpsError("failed-precondition", "Vous êtes déjà membre d'une guilde.");
      }
      const displayName = userData?.pseudo || "Sorcier Anonyme"; // Use pseudo

      // 4. Get guild
      const guildDoc = await transaction.get(guildRef);
      if (!guildDoc.exists) {
        throw new HttpsError("not-found", `Guilde avec l'ID "${guildId}" non trouvée.`);
      }
      const guildData = guildDoc.data() as Guild; // Cast to Guild type

      // 5. Check if user is already a member (should be redundant due to user profile check, but good for integrity)
      if (guildData.members.some(member => member.uid === uid)) {
        // This case should ideally not be reached if user profile guildId is managed correctly.
        // If reached, it implies an inconsistency. We can update user profile as a corrective measure.
        transaction.update(userRef, { guildId: guildId });
        throw new HttpsError("failed-precondition", "Vous êtes déjà listé comme membre de cette guilde (profil mis à jour).");
      }

      // (Future: Add member limit check here if implemented: e.g., if (guildData.members.length >= MAX_MEMBERS) ...)

      // 6. Add user to guild's members array
      const newMember: GuildMember = { uid, displayName };
      transaction.update(guildRef, {
        members: FieldValue.arrayUnion(newMember), // Atomically add new member
      });

      // 7. Update user's profile with guildId
      transaction.update(userRef, { guildId: guildId, });

      return { message: `Vous avez rejoint la guilde "${guildData.name}" avec succès !` };
    });
  } catch (error) {
    logger.error(`Erreur lorsque ${uid} a tenté de rejoindre la guilde ${guildId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue en tentant de rejoindre la guilde.");
  }
});

export const leaveGuild = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
  // 1. Authenticate the user
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour quitter une guilde.");
  }
  const uid = request.auth.uid;

  const userRef = db.collection("users").doc(uid);

  try {
    return await db.runTransaction(async (transaction) => {
      // 2. Get user profile
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "Profil utilisateur non trouvé.");
      }
      const userData = userDoc.data();
      const currentGuildId = userData?.guildId;

      if (!currentGuildId) {
        throw new HttpsError("failed-precondition", "Vous n'êtes membre d'aucune guilde.");
      }

      const guildRef = db.collection("guilds").doc(currentGuildId);
      const guildDoc = await transaction.get(guildRef);

      if (!guildDoc.exists) {
        // Data inconsistency: user has a guildId but guild doesn't exist. Clean up user profile.
        logger.warn(`Utilisateur ${uid} avait guildId ${currentGuildId} mais la guilde n'existe pas. Nettoyage du profil.`);
        transaction.update(userRef, { guildId: FieldValue.delete() });
        throw new HttpsError("not-found", "La guilde que vous essayez de quitter n'existe plus. Votre profil a été mis à jour.");
      }

      const guildData = guildDoc.data() as Guild;
      const userAsMember = guildData.members.find(member => member.uid === uid);

      if (!userAsMember) {
        // Data inconsistency: user has guildId, guild exists, but user not in members list. Clean up.
        logger.warn(`Utilisateur ${uid} (guildId: ${currentGuildId}) non trouvé dans la liste des membres de la guilde ${guildData.name}. Nettoyage du profil.`);
        transaction.update(userRef, { guildId: FieldValue.delete() });
        throw new HttpsError("internal", "Erreur interne : vous n'étiez pas listé dans les membres de la guilde. Votre profil a été mis à jour.");
      }

      // 3. Remove user from guild's members array
      transaction.update(guildRef, {
        members: FieldValue.arrayRemove(userAsMember),
      });

      // 4. Update user's profile
      transaction.update(userRef, {
        guildId: FieldValue.delete(), // Remove guildId field
      });

      // 5. Handle leader leaving scenarios
      // let guildUpdateData: { [key: string]: any } = {}; // Not strictly needed due to direct transaction updates
      let finalMessage = `Vous avez quitté la guilde "${guildData.name}".`;

      if (guildData.leaderId === uid) {
        const remainingMembers = guildData.members.filter(member => member.uid !== uid);
        if (remainingMembers.length === 0) {
          // Leader leaves and is the last member, delete the guild
          transaction.delete(guildRef);
          finalMessage = `Vous avez quitté la guilde "${guildData.name}" et étiez le dernier membre. La guilde a été dissoute.`;
        } else {
          // Leader leaves, other members remain. Guild becomes leaderless for now.
          transaction.update(guildRef, { leaderId: null });
          finalMessage = `Vous avez quitté la guilde "${guildData.name}" en tant que leader. La guilde est maintenant sans leader.`;
           logger.info(`Le leader ${uid} a quitté la guilde ${currentGuildId}. La guilde est maintenant sans leader désigné.`);
        }
      }

      return { message: finalMessage };
    });
  } catch (error) {
    logger.error(`Erreur lorsque ${uid} a tenté de quitter sa guilde:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue en tentant de quitter la guilde.");
  }
});

// =================================================================
//                    GESTION DU LOBBY ET DES PARTIES
// =================================================================

/**
 * createGame
 * Crée une nouvelle partie dans Firestore en utilisant la syntaxe v2 des Cloud Functions.
 * L'utilisateur qui appelle cette fonction devient l'hôte.
 */
export const createGame = onCall(async (request: functions.https.CallableRequest) => { // MODIFIÉ ICI
  // 1. Validation de l'authentification
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  }
  const gameName = request.data.gameName;
  if (typeof gameName !== "string" || gameName.length < 3) {
    throw new HttpsError("invalid-argument", "Le nom de la partie est invalide.");
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
      grimoires: 0, // CORRECTION : Initialisation du champ manquant
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

    // 6a. Update hub_state for the host
    await db.collection("hub_state").doc(uid).set({
      inGame: gameRef.id,
      lastSeen: FieldValue.serverTimestamp(),
    }, { merge: true });

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


/**
 * joinGame
 * * Permet à un utilisateur de rejoindre une partie existante.
 */
export const joinGame = onCall(async (request: functions.https.CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID de jeu invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      throw new HttpsError("not-found", "Cette partie n'existe pas.");
    }

    const gameData = gameDoc.data();
    const players = gameData?.players || [];

    // 3. Logique de validation métier
    if (gameData?.status !== "waiting") {
      throw new HttpsError(
        "failed-precondition",
        "Vous ne pouvez pas rejoindre une partie qui a déjà commencé ou est terminée."
      );
    }

    if (players.length >= 4) {
      throw new HttpsError(
        "failed-precondition",
        "Cette partie est déjà pleine."
      );
    }

    if (players.some((player: Player) => player.uid === uid)) {
      // Le joueur est déjà dans la partie, on ne fait rien.
      return { message: "Vous êtes déjà dans cette partie." };
    }

    // 4. Préparation du nouvel objet Player
    const userDoc = await db.collection("users").doc(uid).get();
    const displayName = userDoc.data()?.displayName || "Sorcier Anonyme";

    const newPlayer: Player = {
      uid: uid,
      displayName: displayName,
      position: 0,
      mana: 20,
      grimoires: 0, // Initialiser les grimoires à 0
    };

    // 5. Ajout atomique du joueur à la partie
    await gameRef.update({
      players: FieldValue.arrayUnion(newPlayer),
    });

    // 5a. Update hub_state for the joining player
    await db.collection("hub_state").doc(uid).set({
      inGame: gameId,
      lastSeen: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error("Erreur pour rejoindre la partie:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      "Une erreur interne est survenue pour rejoindre la partie."
    );
  }
});


/**
 * leaveGame
 * * Permet à un utilisateur de quitter une partie.
 * * Si l'hôte quitte, la partie est supprimée.
 */
export const leaveGame = onCall(async (request: functions.https.CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId } = request.data;
  if (typeof gameId !== "string") throw new HttpsError("invalid-argument", "ID invalide.");

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      // La partie n'existe déjà plus, on considère l'action comme réussie.
      return { success: true, message: "La partie n'existe plus." };
    }

    const gameData = gameDoc.data();

    // 2. Si le joueur qui part est l'hôte, supprimer la partie
    if (gameData?.hostId === uid) {
      await gameRef.delete();
      // Update hub_state for the host
      await db.collection("hub_state").doc(uid).set({
        inGame: null,
        lastSeen: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { success: true, message: "Partie dissoute par l'hôte." };
    }

  const playerToRemove = gameData?.players.find((p: Player) => p.uid === uid);
  if (playerToRemove) {
    await gameRef.update({ players: FieldValue.arrayRemove(playerToRemove), });
    return { success: true, message: "Vous avez quitté la partie.", };
  }
  return { success: true, };
  } catch (error) {
    logger.error("Error leaving game:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An internal error occurred while leaving the game.");
  }
});

// --- FONCTIONS DE FLUX DE JEU ---

export const startGame = onCall(async (request: functions.https.CallableRequest) => {
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

export const rollDice = onCall(async (request: functions.https.CallableRequest) => {
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

export const resolveTileAction = onCall(async (request: functions.https.CallableRequest) => {
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

export const castSpell = onCall(async (request: functions.https.CallableRequest) => {
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
