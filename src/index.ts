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
import { Player, Tile, Guild, GuildMember } from "./types";
import { SPELL_DEFINITIONS, SpellId } from "./spells";

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
//                    GESTION DES GUILDES (MAISONS DE SORCIERS)
// =================================================================

export const createGuild = onCall({ cors: true }, async (request) => {
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
      const initialMember: GuildMember = { uid, displayName };
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

export const joinGuild = onCall({ cors: true }, async (request) => {
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
        members: FieldValue.arrayUnion(newMember) // Atomically add new member
      });

      // 7. Update user's profile with guildId
      transaction.update(userRef, { guildId: guildId });

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

export const leaveGuild = onCall({ cors: true }, async (request) => {
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
        members: FieldValue.arrayRemove(userAsMember)
      });

      // 4. Update user's profile
      transaction.update(userRef, {
        guildId: FieldValue.delete() // Remove guildId field
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
export const joinGame = onCall(async (request) => {
  // 1. Validation de l'authentification
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Vous devez être connecté pour rejoindre une partie."
    );
  }

  // 2. Validation des entrées
  const gameId = request.data.gameId;
  if (typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "L'ID de la partie est invalide.");
  }

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
export const leaveGame = onCall(async (request) => {
  // 1. Validation
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Vous devez être connecté pour quitter une partie."
    );
  }

  const gameId = request.data.gameId;
  if (typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "L'ID de la partie est invalide.");
  }

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

    // 3. Sinon, retirer le joueur de la liste
    const playerToRemove = gameData?.players.find((p: Player) => p.uid === uid);
    if (playerToRemove) {
      await gameRef.update({
        players: FieldValue.arrayRemove(playerToRemove),
      });
       // Update hub_state for the leaving player
       await db.collection("hub_state").doc(uid).set({
         inGame: null,
         lastSeen: FieldValue.serverTimestamp(),
       }, { merge: true });
      return { success: true, message: "Vous avez quitté la partie." };
    }

    // Si le joueur n'était pas dans la liste, on ne fait rien.
    return { success: true, message: "Vous n'étiez pas dans cette partie." };
  } catch (error) {
    console.error("Erreur pour quitter la partie:", error);
    throw new HttpsError(
      "internal",
      "Une erreur interne est survenue pour quitter la partie."
    );
  }
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


// =================================================================
//                    PLAYER HUB FUNCTIONS
// =================================================================

export const updatePlayerHubPosition = onCall(async (request) => {
  // 1. Require user authentication
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be logged in to update your position."
    );
  }
  const uid = request.auth.uid;

  // 2. Validate input: x and y coordinates
  const { x, y } = request.data;
  if (typeof x !== "number" || typeof y !== "number") {
    throw new HttpsError(
      "invalid-argument",
      "Invalid input: x and y must be numbers."
    );
  }

  try {
    // 3. Fetch the calling user's displayName
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      throw new HttpsError(
        "not-found",
        "User profile not found. Cannot update position."
      );
    }
    const userData = userDoc.data();
    // Ensure displayName exists, otherwise provide a default or handle error
    const displayName = userData?.displayName || userData?.pseudo || "Anonymous User";


    // 4. Construct the data to save
    const positionData = {
      uid: uid,
      displayName: displayName,
      x: x,
      y: y,
      lastSeen: FieldValue.serverTimestamp(),
    };

    // 5. Write data to hub_state collection
    await db.collection("hub_state").doc(uid).set(positionData, { merge: true });

    // 6. Return success message
    return { status: "success", message: "Position updated." };
  } catch (error) {
    logger.error(`Error updating player hub position for ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      "An internal error occurred while updating position."
    );
  }
});

export const playerJoinsHub = onCall(async (request) => {
  // 1. Require user authentication
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be logged in to join the hub."
    );
  }
  const uid = request.auth.uid;

  try {
    // 2. Fetch the calling user's displayName
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      throw new HttpsError(
        "not-found",
        "User profile not found. Cannot join hub."
      );
    }
    const userData = userDoc.data();
    const displayName = userData?.displayName || userData?.pseudo || "Anonymous User";

    // 3. Define default spawn coordinates
    const defaultX = 0;
    const defaultY = 0;

    // 4. Construct the data to save
    const hubPlayerData = {
      uid: uid,
      displayName: displayName,
      x: defaultX,
      y: defaultY,
      lastSeen: FieldValue.serverTimestamp(),
      inGame: null, // Player is not in any game by default when joining hub
    };

    // 5. Write data to hub_state collection (overwrite if exists)
    await db.collection("hub_state").doc(uid).set(hubPlayerData);

    // 6. Return success message
    return { status: "success", message: "Player joined hub." };
  } catch (error) {
    logger.error(`Error playerJoinsHub for ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      "An internal error occurred while joining the hub."
    );
  }
});

export const playerLeavesHub = onCall(async (request) => {
  // 1. Require user authentication
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be logged in to leave the hub."
    );
  }
  const uid = request.auth.uid;

  try {
    // 2. Delete the document for the user from hub_state
    // No need to check for existence first, delete is idempotent.
    // If it doesn't exist, it won't throw an error.
    await db.collection("hub_state").doc(uid).delete();

    // 3. Return success message
    return { status: "success", message: "Player left hub." };
  } catch (error) {
    logger.error(`Error playerLeavesHub for ${uid}:`, error);
    // No specific HttpsError to re-throw here unless delete itself fails in a specific way
    // that we want to communicate differently.
    throw new HttpsError(
      "internal",
      "An internal error occurred while leaving the hub."
    );
  }
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


/**
 * startGame
 * * Démarre une partie, la faisant passer du statut "waiting" à "playing".
 */
export const startGame = onCall(async (request) => {
  // 1. Validation de l'authentification et des entrées
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Vous devez être connecté pour démarrer une partie."
    );
  }

  const gameId = request.data.gameId;
  if (typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "L'ID de la partie est invalide.");
  }

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      throw new HttpsError("not-found", "Cette partie n'existe pas.");
    }

    const gameData = gameDoc.data();

    // 2. Validation métier
    if (gameData?.hostId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Seul l'hôte peut démarrer la partie."
      );
    }

    if (gameData?.status !== "waiting") {
      throw new HttpsError(
        "failed-precondition",
        "La partie a déjà commencé ou est terminée."
      );
    }

    const players = gameData?.players || [];
    if (players.length < 2 || players.length > 4) {
      throw new HttpsError(
        "failed-precondition",
        "Il faut être entre 2 et 4 joueurs pour commencer."
      );
    }

    // 3. Initialisation de l'état de jeu
    const board = generateBoardLayout(); // On génère le plateau UNE SEULE FOIS
    const boardSize = 30; // Doit correspondre à la config
    const grimoireCount = 3; // L'objectif pour gagner
    const grimoirePositions: number[] = [];

    // Générer des positions aléatoires uniques pour les grimoires
    // On exclut la case de départ (0)
    while (grimoirePositions.length < grimoireCount) {
      const pos = Math.floor(Math.random() * (boardSize - 1)) + 1;
      if (!grimoirePositions.includes(pos)) {
        grimoirePositions.push(pos);
      }
    }
    // Algorithme de mélange de Fisher-Yates pour garantir l'équité
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }

    // 4. Mise à jour de la partie
    await gameRef.update({
      status: "playing",
      players: players,
      currentPlayerId: players[0].uid,
      turnState: "AWAITING_ROLL",
      grimoirePositions: grimoirePositions, // On sauvegarde les positions
      board: board, // On sauvegarde le plateau dans le document de la partie
    });

    return { success: true, message: "La partie commence !" };
  } catch (error) {
    console.error("Erreur lors du démarrage de la partie:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      "Une erreur interne est survenue lors du démarrage de la partie."
    );
  }
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

/**
 * rollDice
 * * Gère le lancer de dé d'un joueur, calcule sa nouvelle position.
 */
export const rollDice = onCall(async (request) => {
  // 1. Validation de l'authentification et des entrées
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Vous devez être connecté pour jouer."
    );
  }

  const gameId = request.data.gameId;
  if (typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "L'ID de la partie est invalide.");
  }

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      throw new HttpsError("not-found", "Cette partie n'existe pas.");
    }

    const gameData = gameDoc.data();

    // 2. Validation métier stricte
    if (gameData?.status !== "playing") {
      throw new HttpsError(
        "failed-precondition",
        "La partie n'est pas en cours."
      );
    }

    if (gameData?.currentPlayerId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Ce n'est pas votre tour de jouer."
      );
    }

    if (gameData?.turnState !== "AWAITING_ROLL") {
      throw new HttpsError(
        "failed-precondition",
        "Vous ne pouvez pas lancer le dé maintenant."
      );
    }

    // 3. Logique du jeu
    const diceResult = Math.floor(Math.random() * 6) + 1;
    const currentPlayer = gameData.players.find((p: Player) => p.uid === uid);
    if (!currentPlayer) {
      throw new HttpsError("internal", "Le joueur actuel n'a pas été trouvé.");
    }

    // NOTE : La taille du plateau sera externalisée dans une config plus tard.
    const boardSize = 30;
    const newPosition = (currentPlayer.position + diceResult) % boardSize;

    // 4. Création du nouvel état du tableau des joueurs
    const updatedPlayers = gameData.players.map((p: Player) => {
      if (p.uid === uid) {
        return { ...p, position: newPosition };
      }
      return p;
    });

    // 5. Mise à jour de la partie
    await gameRef.update({
      players: updatedPlayers,
      lastDiceRoll: diceResult,
      turnState: "RESOLVING_TILE", // On passe directement à la résolution de la case
    });

    return { success: true, diceResult: diceResult };
  } catch (error) {
    console.error("Erreur lors du lancer de dé:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      "Une erreur interne est survenue lors du lancer de dé."
    );
  }
});

/**
 * resolveTileAction
 * * Applique l'effet de la case sur laquelle le joueur a atterri et passe au joueur suivant.
 */
export const resolveTileAction = onCall(async (request) => {
  // 1. Validation
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  }

  const gameId = request.data.gameId;
  if (typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "L'ID de la partie est invalide.");
  }

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      throw new HttpsError("not-found", "Cette partie n'existe pas.");
    }

    const gameData = gameDoc.data();
    if (!gameData) throw new HttpsError("internal", "Données de jeu introuvables.");

    // AJOUT : Valider que le plateau existe dans les données du jeu
    if (!gameData.board) {
      throw new HttpsError("internal", "Plateau de jeu non trouvé pour cette partie.");
    }

    // 2. Validation métier
    if (gameData.status !== "playing" || gameData.currentPlayerId !== uid || gameData.turnState !== "RESOLVING_TILE") {
      throw new HttpsError(
        "failed-precondition",
        "Impossible de résoudre l'action de la case maintenant."
      );
    }

    // 3. Application de l'effet de la case
    const board = gameData.board;
    const players = [...gameData.players];
    const grimoirePositions = [...(gameData.grimoirePositions || [])];
    const currentPlayerIndex = players.findIndex((p: Player) => p.uid === uid);
    let currentPlayer = players[currentPlayerIndex];
    const tile = board[currentPlayer.position];
    let manaChange = 0;

    // --- LOGIQUE DE COLLECTE DE GRIMOIRE ---
    const grimoireIndex = grimoirePositions.indexOf(currentPlayer.position);
    if (grimoireIndex > -1) {
      // Le joueur a trouvé un grimoire !
      currentPlayer = { ...currentPlayer, grimoires: currentPlayer.grimoires + 1 };
      players[currentPlayerIndex] = currentPlayer;

      // Retirer le grimoire du plateau
      grimoirePositions.splice(grimoireIndex, 1);

      // --- VÉRIFICATION DE VICTOIRE ---
      const grimoireWinCondition = 3; // À externaliser dans une config plus tard
      if (currentPlayer.grimoires >= grimoireWinCondition) {
        await gameRef.update({
          players: players,
          grimoirePositions: grimoirePositions,
          status: "finished",
          winnerId: currentPlayer.uid,
          turnState: "ENDED", // On fige l'état du tour
        });
        return { success: true, effect: "VICTORY" };
      }
    }
    // --- FIN DE LA LOGIQUE DE COLLECTE ET VICTOIRE ---

    let newMana = currentPlayer.mana;

    switch (tile.type) {
    case "MANA_GAIN":
      newMana += 10; // Valeur à définir dans la config du plateau
      break;
    case "MINI_GAME_QUIZ":
      // La logique pour lancer un mini-jeu sera implémentée ici plus tard.
      // Pour l'instant, on considère que c'est une case sûre.
      break;
    case "SAFE_ZONE":
    default:
      // Aucun effet sur les cases sûres
      break;
    }
    manaChange = currentPlayer.mana - newMana;
    players[currentPlayerIndex] = currentPlayer;

    // 4. Passage au joueur suivant
    const nextPlayerIndex = (currentPlayerIndex + 1) % players.length;

    await gameRef.update({
      players: players,
      grimoirePositions: grimoirePositions, // Mettre à jour les grimoires restants
      currentPlayerId: players[nextPlayerIndex].uid,
      turnState: "AWAITING_ROLL",
    });

    return { success: true, manaChange };
  } catch (error) {
    console.error("Erreur lors de la résolution de l'action:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      "Une erreur interne est survenue lors de la résolution de l'action."
    );
  }
});

/**
 * castSpell
 * * Gère le lancement d'un sort d'influence par un joueur sur un autre.
 */
export const castSpell = onCall(async (request) => {
  // 1. Validation de l'authentification et des entrées
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour lancer un sort.");
  }
  const { gameId, spellId, targetId } = request.data;
  if (typeof gameId !== "string" || typeof spellId !== "string" || typeof targetId !== "string") {
    throw new HttpsError("invalid-argument", "Les données pour lancer le sort sont invalides.");
  }

  const uid = request.auth.uid;
  const gameRef = db.collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();
    const gameData = gameDoc.data();
    if (!gameData) {
      throw new HttpsError("not-found", "Cette partie n'existe pas.");
    }

    // 2. Validations métier
    if (gameData.status !== "playing" || gameData.currentPlayerId !== uid) {
      throw new HttpsError("failed-precondition", "Vous ne pouvez pas lancer de sort maintenant.");
    }
    // Règle de jeu : on ne peut lancer un sort qu'au début de son tour.
    if (gameData.turnState !== "AWAITING_ROLL") {
      throw new HttpsError("failed-precondition", "Vous pouvez uniquement lancer un sort avant de lancer le dé.");
    }
    if (uid === targetId) {
      throw new HttpsError("invalid-argument", "Vous ne pouvez pas vous cibler avec ce type de sort.");
    }

    // 3. Validation du sort et du lanceur
    const spell = SPELL_DEFINITIONS[spellId as SpellId];
    if (!spell) {
      throw new HttpsError("not-found", "Ce sort n'existe pas.");
    }

    const casterIndex = gameData.players.findIndex((p: Player) => p.uid === uid);
    const targetIndex = gameData.players.findIndex((p: Player) => p.uid === targetId);
    if (casterIndex === -1 || targetIndex === -1) {
      throw new HttpsError("not-found", "Le lanceur ou la cible est introuvable dans cette partie.");
    }

    const players = [...gameData.players];
    const caster = players[casterIndex];

    if (caster.mana < spell.manaCost) {
      throw new HttpsError("failed-precondition", "Vous n'avez pas assez de Mana.");
    }

    // 4. Application de la logique du sort
    // Déduire le coût en Mana
    players[casterIndex] = { ...caster, mana: caster.mana - spell.manaCost };

    // Appliquer l'effet
    switch (spell.id) {
    case "BLESSING_OF_HANGEUL": {
      const target = players[targetIndex];
      players[targetIndex] = { ...target, mana: target.mana + 5 };
      break;
    }
    case "KIMCHIS_MALICE": {
      const target = players[targetIndex];
      // On s'assure que le mana ne passe pas en négatif
      players[targetIndex] = { ...target, mana: Math.max(0, target.mana - 8) };
      break;
    }
    default:
      throw new HttpsError("internal", "Logique de sort non implémentée.");
    }

    // 5. Mise à jour de la partie
    await gameRef.update({
      players: players,
      lastSpellCast: { spellId, casterId: uid, targetId },
    });

    return { success: true };
  } catch (error) {
    console.error("Erreur lors du lancement du sort:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors du lancement du sort.");
  }
});
