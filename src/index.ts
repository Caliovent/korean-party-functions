/* eslint-disable max-len */
import { setGlobalOptions } from "firebase-functions/v2"; // CORRECT : Importation depuis la racine v2
import { onCall, HttpsError } from "firebase-functions/v2/https"; // onCall et HttpsError restent ici
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
// v1 import for auth triggers
import * as functionsV1 from "firebase-functions/v1"; // Importation de v1 pour les triggers d'authentification
import * as functions from "firebase-functions/v2"; // Importation de v2 pour les autres fonctions
import * as logger from "firebase-functions/logger";
import { getXpForLevel } from "./xpUtils";
import { Player, Tile, Guild, Grimoire, GuildMember, SendTyphoonAttackRequest, SendTyphoonAttackResponse, Game, SendTyphoonAttackSuccessResponse, SendTyphoonAttackFailureResponse } from "./types"; // Added Game
import { SPELL_DEFINITIONS, SpellId } from "./spells";
import { eventCards, EventCard } from "./data/eventCards";

// Mana Reward Constants
const MANA_REWARD_MINI_GAME_QUIZ = 20;
// const MANA_REWARD_HANGEUL_TYPHOON = 40; // Placeholder for future use

// Hangeul Typhoon Constants
const DEFAULT_GROUND_RISE_AMOUNT = 10;
const DEFAULT_PENALTY_RISE_AMOUNT = 5;

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


// =================================================================
//                    FONCTIONS UTILITAIRES INTERNES
// =================================================================
// Fonction utilitaire pour compléter une étape de quête


// =================================================================
//                    GESTION DES UTILISATEURS ET PROFILS
// =================================================================

// V2: Use functions.identity.user() instead of functions.auth.user()
export const createProfileOnSignup = functionsV1.auth.user().onCreate(async (user) => {
  const { uid, email } = user;
  if (!email) {
    logger.info(`Utilisateur anonyme ${uid} créé, pas de profil nécessaire.`);
    return null;
  }
  const userProfile = {
    email: email,
    displayName: email.split("@")[0],
    level: 1,
    xp: 0,
    manaCurrent: 100,
    manaMax: 100,
    fragments: { vocab: 0, grammar: 0, culture: 0 },
    createdAt: FieldValue.serverTimestamp(),
    // Add the stats object here
    stats: {
      gamesPlayed: 0,
      gamesWon: 0,
      duelsWon: 0,
      spellsCast: 0,
      grimoiresCollected: 0,
      wordsTypedInTyphoon: 0,
      perfectQuizzes: 0,
    },
  };
  await db.collection("users").doc(uid).set(userProfile);
  return null;
});


/**
 * Déclencheur qui s'active à la création d'un nouvel utilisateur
 * dans Firebase Authentication pour créer son profil dans Firestore.
 */
export const onUserCreate = functionsV1
  .region("europe-west1") // Important de spécifier la même région que vos autres fonctions
  .auth.user()
  .onCreate(async (user) => {
    const { uid, email, displayName } = user;

    console.log(`[Auth Trigger] New user detected: ${uid} (${email}). Creating Firestore profile.`);

    const userRef = admin.firestore().collection("users").doc(uid);

    const initialdisplayName = displayName || (email ? email.split("@")[0] : `Sorcier_${uid.substring(0, 5)}`);

    try {
      await userRef.set({
        uid: uid,
        email: email || "",
        displayName: initialdisplayName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        rank: "Apprenti Runique",
        mana: 100,
        grimoires: [],
        fragments: {
          dark: 0,
          light: 0,
          nature: 0,
        },
        activeQuests: [],
        completedQuests: [],
      });

      console.log(`[Auth Trigger] Firestore document successfully created for user ${uid}.`);
    } catch (error) {
      console.error(
        `[Auth Trigger] Error creating Firestore document for user ${uid}:`,
        error
      );
    }
  });




export const updateUserProfile = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { displayName } = request.data;
  const { uid } = request.auth;
  if (typeof displayName !== "string" || displayName.length < 3 || displayName.length > 20) {
    throw new functions.https.HttpsError("invalid-argument", "Le displayName doit contenir entre 3 et 20 caractères.");
  }
  await admin.firestore().collection("users").doc(uid).update({ displayName });
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
      const displayName = userData?.displayName || "Sorcier Anonyme"; // Use displayName as displayName

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
      const displayName = userData?.displayName || "Sorcier Anonyme"; // Use displayName

      // 4. Get guild
      const guildDoc = await transaction.get(guildRef);
      if (!guildDoc.exists) {
        throw new HttpsError("not-found", `Guilde avec l'ID "${guildId}" non trouvée.`);
      }
      const guildData = guildDoc.data() as Guild; // Cast to Guild type

      // 5. Check if user is already a member (should be redundant due to user profile check, but good for integrity)
      if (guildData.members.some((member) => member.uid === uid)) {
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
      const userAsMember = guildData.members.find((member) => member.uid === uid);

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
        const remainingMembers = guildData.members.filter((member) => member.uid !== uid);
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


/**
 * Permet à un utilisateur de supprimer une partie dont il est l'hôte.
 */
export const deleteGame = onCall(async (request) => {
  const uid = request.auth?.uid;
  const gameId = request.data.gameId;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour supprimer une partie.");
  }

  if (!gameId || typeof gameId !== "string") {
    throw new HttpsError("invalid-argument", "L'ID de la partie est manquant ou invalide.");
  }

  const gameRef = admin.firestore().collection("games").doc(gameId);

  try {
    const gameDoc = await gameRef.get();

    if (!gameDoc.exists) {
      throw new HttpsError("not-found", "La partie que vous essayez de supprimer n'existe pas.");
    }

    const gameData = gameDoc.data();
    if (gameData?.hostId !== uid) {
      // Ce n'est pas l'hôte qui fait la demande, on refuse.
      throw new HttpsError("permission-denied", "Vous n'êtes pas l'hôte de cette partie, vous ne pouvez pas la supprimer.");
    }

    // La vérification a réussi, on peut supprimer le document.
    await gameRef.delete();

    logger.log(`Game ${gameId} successfully deleted by host ${uid}.`);
    return { success: true, message: "Partie supprimée avec succès." };
  } catch (error) {
    logger.error(`Error deleting game ${gameId} for user ${uid}:`, error);
    // On re-throw l'erreur pour que le client soit notifié
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de la suppression de la partie.");
  }
});

// =================================================================
//                    ACHIEVEMENT FUNCTIONS
// =================================================================

// Import achievements and related types
import { ALL_ACHIEVEMENTS, Achievement, UserStats } from "./data/achievements";

/**
 * Helper function to grant a single achievement and update the game document.
 * @param {string} userId
 * @param {string} gameId
 * @param {Achievement} achievement
 */
async function grantSingleAchievement(userId: string, gameId: string, achievement: Achievement) {
  const userAchievementsRef = db.collection("users").doc(userId).collection("unlockedAchievements");
  const gameRef = db.collection("games").doc(gameId);

  try {
    // Record the achievement for the user
    await userAchievementsRef.doc(achievement.id).set({
      achievementId: achievement.id,
      unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update the game document with the last unlocked achievement details
    await gameRef.update({
      lastAchievementUnlocked: {
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        iconUrl: achievement.iconUrl,
      },
    });
    logger.info(`Achievement ${achievement.id} unlocked for user ${userId} and notified on game ${gameId}.`);
    return true; // Indicates an achievement was granted and notified
  } catch (error) {
    logger.error(`Error granting achievement ${achievement.id} to user ${userId} on game ${gameId}:`, error);
    return false;
  }
}

/**
 * Core logic for checking and granting achievements.
 * Can be called internally by other Cloud Functions.
 * @param {string} userId
 * @param {string} gameId
 */
export async function checkAndGrantAchievementsInternal(userId: string, gameId: string | null) {
  if (!userId) {
    logger.error("checkAndGrantAchievementsInternal: userId is required.");
    return;
  }

  const userRef = db.collection("users").doc(userId);
  let userDoc;
  try {
    userDoc = await userRef.get();
  } catch (error) {
    logger.error(`Failed to retrieve user document for ${userId}:`, error);
    return;
  }

  if (!userDoc.exists) {
    logger.error(`User ${userId} not found for checking achievements.`);
    return;
  }

  const userData = userDoc.data();
  const userStats = userData?.stats as UserStats; // Type assertion
  if (!userStats) {
    logger.info(`User ${userId} has no stats, skipping achievement check.`);
    // If gameId is provided, clear any stale achievement notification
    if (gameId) {
      const gameRef = db.collection("games").doc(gameId);
      try {
        await gameRef.update({ lastAchievementUnlocked: null });
      } catch (error) {
        if (error instanceof Error) {
          logger.warn(`Could not clear lastAchievementUnlocked for game ${gameId} (user has no stats): ${error.message}`);
        } else {
          logger.warn(`Could not clear lastAchievementUnlocked for game ${gameId} (user has no stats): An unknown error occurred`);
        }
      }
    }
    return;
  }

  let unlockedAchievementsSnapshot;
  try {
    unlockedAchievementsSnapshot = await userRef.collection("unlockedAchievements").get();
  } catch (error) {
    logger.error(`Failed to retrieve unlocked achievements for ${userId}:`, error);
    return;
  }
  const unlockedAchievementIds = new Set(unlockedAchievementsSnapshot.docs.map((doc) => doc.id));

  let newAchievementGrantedInThisCall = false;

  for (const achievement of ALL_ACHIEVEMENTS) {
    if (unlockedAchievementIds.has(achievement.id)) {
      continue; // Already unlocked
    }

    const statValue = userStats[achievement.trigger.stat];
    if (statValue !== undefined && statValue >= achievement.trigger.value) {
      logger.info(`User ${userId} meets criteria for achievement ${achievement.id}. Stat ${achievement.trigger.stat}: ${statValue} >= ${achievement.trigger.value}`);
      if (gameId) {
        const grantedSuccessfully = await grantSingleAchievement(userId, gameId, achievement);
        if (grantedSuccessfully) {
          newAchievementGrantedInThisCall = true;
          // The last one processed in the loop will be set on the gameDoc.
        }
      } else {
        // No gameId, so just unlock the achievement without game notification
        const userAchievementsColRef = userRef.collection("unlockedAchievements");
        try {
          await userAchievementsColRef.doc(achievement.id).set({
            achievementId: achievement.id,
            unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          logger.info(`Achievement ${achievement.id} unlocked for user ${userId} (no gameId for notification).`);
          // newAchievementGrantedInThisCall is not set to true here, as it tracks game notification specifically.
          // Or, if we want to track any unlock: newAchievementGrantedInThisCall = true; (decide behavior)
          // For now, let's say newAchievementGrantedInThisCall tracks if a *game notification* was made.
        } catch (error) {
          logger.error(`Error granting achievement ${achievement.id} to user ${userId} (no gameId):`, error);
        }
      }
      // If we only want to process & notify for the *first* new achievement per call:
      // if (newAchievementGrantedInThisCall && gameId) break;
    }
  }

  if (gameId && !newAchievementGrantedInThisCall) {
    // If a gameId was provided, but no new achievement was granted *and notified* in this call,
    // clear the lastAchievementUnlocked field to prevent stale notifications.
    const gameRef = db.collection("games").doc(gameId);
    try {
      await gameRef.update({ lastAchievementUnlocked: null });
      logger.info(`No new achievements for user ${userId} on game ${gameId}. Cleared lastAchievementUnlocked.`);
    } catch (error) {
      // Non-critical if game doc doesn't exist or field is already null
      if (error instanceof Error) {
        logger.warn(`Could not clear lastAchievementUnlocked for game ${gameId}: ${error.message}`);
      } else {
        logger.warn(`Could not clear lastAchievementUnlocked for game ${gameId}: An unknown error occurred`);
      }
    }
  } else if (gameId && newAchievementGrantedInThisCall) {
    logger.info(`Finished checking achievements for user ${userId}. At least one achievement was processed for game ${gameId}.`);
  }
}

/**
 * Callable Cloud Function wrapper for checking and granting achievements.
 */
export const checkAndGrantAchievements = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté pour vérifier les succès.");
  }

  const { userId, gameId } = request.data;

  if (!userId || typeof userId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Le champ userId (chaîne de caractères) est requis.");
  }

  // gameId is optional. If provided, it must be a string.
  if (gameId !== undefined && (typeof gameId !== "string" || gameId.length === 0)) {
    throw new functions.https.HttpsError("invalid-argument", "Le champ gameId doit être une chaîne de caractères non vide si fourni.");
  }

  // Basic security: a user can only trigger this for themselves.
  // Server-side functions calling `checkAndGrantAchievementsInternal` directly bypass this.
  if (request.auth.uid !== userId) {
    throw new functions.https.HttpsError("permission-denied", "Vous ne pouvez vérifier les succès que pour vous-même.");
  }

  try {
    await checkAndGrantAchievementsInternal(userId, gameId || null);
    return { success: true, message: "Vérification des succès terminée." };
  } catch (error) {
    logger.error(`Erreur lors de la vérification des succès pour ${userId} (jeu: ${gameId || "N/A"}):`, error);
    // Don't throw raw error to client, but log it.
    // The internal function handles its own errors by logging, but top-level catch here is good.
    throw new functions.https.HttpsError("internal", "Une erreur est survenue lors de la vérification des succès.");
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
export const createGame = onCall({ cors: true }, async (request: functions.https.CallableRequest) => { // MODIFIÉ ICI
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
      grimoires: [],
      groundHeight: 0, // Added
      blocks: [], // Added
    };

    // 5. Création du nouvel objet Game
    const newGame = {
      name: gameName,
      hostId: uid,
      status: "waiting" as const,
      players: [hostPlayer],
      createdAt: FieldValue.serverTimestamp(), // Doit utiliser le 'FieldValue' importé
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
export const joinGame = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
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
      grimoires: [], // Initialiser les grimoires à 0
      groundHeight: 0, // Added
      blocks: [], // Added
    };
    const updatedPlayers = [...players, newPlayer];

    // 5. Ajout atomique du joueur à la partie
    await gameRef.update({
      players: updatedPlayers,
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
export const leaveGame = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
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
      await gameRef.update({ players: FieldValue.arrayRemove(playerToRemove) });
      return { success: true, message: "Vous avez quitté la partie." };
    }
    return { success: true };
  } catch (error) {
    logger.error("Error leaving game:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An internal error occurred while leaving the game.");
  }
});

// --- FONCTIONS DE FLUX DE JEU ---

export const startGame = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
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

// =================================================================
//                    MINI-GAME RESULT FUNCTIONS
// =================================================================

export const submitQuizResult = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  }
  const { gameId, playerId, wasPerfect } = request.data; // gameId might not be strictly needed for this stat if user is known.
  const aUid = request.auth.uid; // Authenticated user

  if (aUid !== playerId) {
    logger.error(`User ${aUid} attempting to submit quiz result for ${playerId}`);
    throw new functions.https.HttpsError("permission-denied", "You can only submit quiz results for yourself.");
  }

  if (typeof wasPerfect !== "boolean" || typeof playerId !== "string" || playerId.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid data for quiz result.");
  }

  if (wasPerfect) {
    const playerDocRef = db.collection("users").doc(playerId);
    try {
      await playerDocRef.update({
        "stats.perfectQuizzes": admin.firestore.FieldValue.increment(1),
      });
      logger.info(`Perfect quiz stat updated for player ${playerId}. GameID: ${gameId}`);

      // After successful stat update, check for achievements
      // playerId and gameId are from request.data
      try {
        await checkAndGrantAchievementsInternal(playerId, gameId || null); // Pass gameId or null
        logger.info(`Achievement check initiated for player ${playerId} in game ${gameId || "N/A"} after perfect quiz.`);
      } catch (error) {
        logger.error(`Error initiating achievement check for player ${playerId} in game ${gameId || "N/A"} after perfect quiz:`, error);
      }
      return { success: true, message: "Quiz result processed." };
    } catch (error) {
      logger.error(`Error updating perfectQuizzes for player ${playerId}:`, error);
      throw new functions.https.HttpsError("internal", "Failed to update quiz stats.");
    }
  } else {
    // No stat update if not perfect, but acknowledge processing.
    return { success: true, message: "Quiz result processed (not perfect)." };
  }
});

export const submitHangeulTyphoonResult = onCall({ cors: true }, async (request) => {
  if (!request.auth) { // Assuming the caller (e.g., game client of one player, or a trusted server process) is authenticated
    throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  }
  const { gameId, winnerId, playersData } = request.data; // gameId might not be strictly needed for stats if users are known.

  if (typeof winnerId !== "string" || !Array.isArray(playersData) || playersData.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid data for Hangeul Typhoon result.");
  }

  const batch = db.batch();

  // Update duelsWon for the winner
  if (winnerId && winnerId.length > 0) { // Check if there's a winner
    const winnerDocRef = db.collection("users").doc(winnerId);
    batch.update(winnerDocRef, {
      "stats.duelsWon": admin.firestore.FieldValue.increment(1),
    });
  }

  // Update wordsTypedInTyphoon for all participants
  for (const playerData of playersData) {
    if (typeof playerData.userId === "string" && playerData.userId.length > 0 && typeof playerData.wordsTyped === "number" && playerData.wordsTyped >= 0) {
      const playerDocRef = db.collection("users").doc(playerData.userId);
      // Only update if wordsTyped is greater than 0, or always record participation?
      // Current logic increments even if 0, which is fine for FieldValue.increment.
      batch.update(playerDocRef, {
        "stats.wordsTypedInTyphoon": admin.firestore.FieldValue.increment(playerData.wordsTyped),
      });
    } else {
      logger.warn("Invalid player data in playersData array, skipping:", playerData);
    }
  }

  try {
    await batch.commit();
    logger.info(`Hangeul Typhoon stats updated. GameID: ${gameId}, Winner: ${winnerId}, Participants: ${playersData.map((p: { userId: string; }) => p.userId).join(", ")}.`);

    // After successful stat update, check for achievements for all involved players
    // gameId is from request.data.gameId
    try {
      const userIdsToUpdate = new Set<string>();
      if (winnerId && winnerId.length > 0) {
        userIdsToUpdate.add(winnerId);
      }
      for (const playerData of playersData) {
        // Ensure playerData.userId is a valid string before adding
        if (playerData.userId && typeof playerData.userId === "string" && playerData.userId.length > 0) {
          userIdsToUpdate.add(playerData.userId);
        }
      }

      logger.info(`Initiating achievement check for Hangeul Typhoon users in game ${gameId || "N/A"}: ${Array.from(userIdsToUpdate).join(", ")}`);
      for (const userIdFromSet of userIdsToUpdate) {
        await checkAndGrantAchievementsInternal(userIdFromSet, gameId || null); // Pass gameId or null
      }
      logger.info(`Achievement check completed for users in game ${gameId || "N/A"} after Hangeul Typhoon.`);
    } catch (error) {
      logger.error(`Error initiating achievement checks for Hangeul Typhoon users in game ${gameId || "N/A"}:`, error);
    }
    return { success: true, message: "Hangeul Typhoon result processed." };
  } catch (error) {
    logger.error("Error committing Hangeul Typhoon stats batch:", error);
    throw new functions.https.HttpsError("internal", "Failed to update Hangeul Typhoon stats.");
  }
});

// --- FONCTIONS DE TOUR DE JEU ---

export const rollDice = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
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

export const resolveTileAction = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
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

  const board = [...gameData.board]; // Made mutable
  const players = [...gameData.players];
  const grimoirePositions = [...(gameData.grimoirePositions || [])];
  const currentPlayerIndex = players.findIndex((p: Player) => p.uid === uid);
  let currentPlayer = players[currentPlayerIndex];
  const tile = board[currentPlayer.position];

  // Reset lastEventCard at the beginning of resolving a new tile if it's for the current player.
  // More robust reset happens when turn passes to next player or before EXTRA_ROLL.
  if (gameData.lastEventCard) {
    // Avoid resetting if an event card effect (like EXTRA_ROLL) is what led here.
    // This simple check might need refinement based on game flow.
    // For now, let's assume it's reset before next player's turn or explicitly after an event.
  }

  const grimoireIndex = grimoirePositions.indexOf(currentPlayer.position);
  if (grimoireIndex > -1) {
    currentPlayer = { ...currentPlayer, grimoires: currentPlayer.grimoires + 1 };
    players[currentPlayerIndex] = currentPlayer;
    grimoirePositions.splice(grimoireIndex, 1);

    if (currentPlayer.grimoires >= 3) {
      // ***** START OF XP MODIFICATION AREA *****
      const XP_REWARD_WINNER = 150;
      const XP_REWARD_LOSER = 50;

      const userUpdates = players.map(async (player) => {
        const userRef = db.collection("users").doc(player.uid);
        try {
          const userDoc = await userRef.get();
          if (userDoc.exists) {
            let currentLevel = userDoc.data()?.level || 1;
            let currentXp = userDoc.data()?.xp || 0;
            const isWinner = player.uid === currentPlayer.uid;
            const xpGained = isWinner ? XP_REWARD_WINNER : XP_REWARD_LOSER;

            currentXp += xpGained;

            let xpNeededForNextLevel = getXpForLevel(currentLevel);
            while (currentXp >= xpNeededForNextLevel) {
              currentXp -= xpNeededForNextLevel;
              currentLevel++;
              xpNeededForNextLevel = getXpForLevel(currentLevel); // Recalculate for the new currentLevel
            }
            await userRef.update({ xp: currentXp, level: currentLevel });
            logger.info(`Player ${player.uid} updated to Level ${currentLevel}, XP ${currentXp}`);
          } else {
            logger.warn(`User document not found for player ${player.uid} during XP update.`);
          }
        } catch (error) {
          logger.error(`Failed to update XP for user ${player.uid}`, error);
        }
      });

      await Promise.all(userUpdates);
      // ***** END OF XP MODIFICATION AREA *****

      // The winnerId for game update is currentPlayer.uid
      const gameWinnerId = currentPlayer.uid;

      await gameRef.update({ players, grimoirePositions, status: "finished", winnerId: gameWinnerId, turnState: "ENDED", lastEventCard: null });

      // Atomically update stats for all players - MOVED HERE
      const batch = db.batch();
      players.forEach((player: Player) => {
        const playerRef = db.collection("users").doc(player.uid);
        batch.update(playerRef, {
          "stats.gamesPlayed": admin.firestore.FieldValue.increment(1),
          "stats.grimoiresCollected": admin.firestore.FieldValue.increment((player.grimoires?.length ?? 0)),
        });

        if (player.uid === gameWinnerId) { // Corrected to use gameWinnerId
          batch.update(playerRef, {
            "stats.gamesWon": admin.firestore.FieldValue.increment(1),
          });
        }
      });
      await batch.commit().catch((error) => {
        logger.error("Erreur lors de la mise à jour des statistiques des joueurs:", error);
      });

      // After successful stats update, check for achievements for all players in the game
      try {
        logger.info(`Initiating achievement check for game ${gameId} completion.`);
        // The 'players' variable here holds the final state of players in the game
        // gameId is available directly in this function's scope.
        for (const player of players) { // 'players' is the array of player objects used in the gameRef.update above
          await checkAndGrantAchievementsInternal(player.uid, gameId);
        }
        logger.info(`Achievement check completed for all players in game ${gameId}.`);
      } catch (error) {
        logger.error(`Error during achievement checks for game ${gameId} completion:`, error);
      }

      return { success: true, effect: "VICTORY" };
    }
  }

  let tileEffectApplied = false;

  // RUNE_TRAP Check
  if (tile.trap && tile.trap.spellId === "RUNE_TRAP") {
    logger.info(`Player ${currentPlayer.uid} triggered a RUNE_TRAP on tile ${currentPlayer.position} owned by ${tile.trap.ownerId}`);
    const manaLoss = 50;
    currentPlayer.mana = Math.max(0, currentPlayer.mana - manaLoss);
    players[currentPlayerIndex] = currentPlayer; // Update player in local array

    // Log the event for the client
    // Note: This specific update for the log might be batched or combined with the final update.
    // For atomicity of trap removal and player state change due to trap, consider what needs to be updated together.
    // The main update at the end will save players and board. Adding log here is fine.
    await gameRef.update({
      log: FieldValue.arrayUnion({
        message: `${currentPlayer.displayName} triggered a Rune Trap and lost ${manaLoss} Mana! (Owned by ${tile.trap.ownerId})`,
        timestamp: FieldValue.serverTimestamp(),
      }),
    });

    // Remove the trap from the tile
    delete board[currentPlayer.position].trap; // Modify the mutable board copy

    tileEffectApplied = true; // Trap effect takes precedence over other standard tile effects.
  }

  if (tile.type === "event" && !tileEffectApplied) { // Only process event if trap hasn't superseded
    tileEffectApplied = true; // Event itself is an effect
    const randomIndex = Math.floor(Math.random() * eventCards.length);
    const selectedCard = eventCards[randomIndex] as EventCard; // Ensure type

    switch (selectedCard.effect.type) {
      case "GIVE_MANA":
        currentPlayer.mana += selectedCard.effect.value;
        if (currentPlayer.mana < 0) currentPlayer.mana = 0;
        // if (currentPlayer.mana > MAX_MANA) currentPlayer.mana = MAX_MANA;
        break;
      case "MOVE_TO_TILE":
        // const boardSize = board.length;
        if (selectedCard.effect.value < 0) { // Moving backwards relative to current position
          currentPlayer.position = Math.max(0, currentPlayer.position + selectedCard.effect.value);
        } else { // Moving forwards relative to current position or to a specific tile if value is absolute
          // Assuming effect.value is relative for now as per example "Sudden Gust of Wind"
          // If it can be absolute, logic needs to distinguish: e.g. if (selectedCard.effect.isAbsolute) newPos = val
          currentPlayer.position = (currentPlayer.position + selectedCard.effect.value) % board.length;
        }
        // Note: Effect of the new tile is not resolved in this turn.
        break;
      case "SKIP_TURN":
        // players[currentPlayerIndex].skipNextTurn = true; // This would skip current player's next turn.
        // The instruction implies the *next* player in sequence after current player finishes their turn.
        // So this flag should be set on the player who would play next.
        // However, the current design has SKIP_TURN make the *current* player skip their *next* turn.
        // Let's stick to the spirit of making *someone* skip a turn.
        // The provided logic snippet for SKIP_TURN handling is at the end of function,
        // which correctly applies to the *next* player.
        // So, we mark the current player to have an effect that says "the next turn progression will skip one player"
        // For now, let's assume `players[currentPlayerIndex].effects` could store this.
        // Or, as per instructions, a temporary field on game.
        // The provided snippet sets `players[nextPlayerIndex].skipNextTurn = true;`
        // This is deferred to the end of the function.
        // For now, we'll just record the event happened.
        // The actual skip logic is handled during turn progression.
        await gameRef.update({ [`players.${currentPlayerIndex}.effects.skipNextTurn`]: true }); // Placeholder for effect
        break;
      case "EXTRA_ROLL":
        players[currentPlayerIndex] = currentPlayer; // Save any changes to current player first
        await gameRef.update({
          players: players,
          lastEventCard: { title: selectedCard.title, description: selectedCard.description },
          // currentPlayerId remains the same
          turnState: "AWAITING_ROLL", // Player rolls again
        });
        return { success: true, effect: "EXTRA_ROLL", event: selectedCard };
    }

    players[currentPlayerIndex] = currentPlayer;
    await gameRef.update({
      lastEventCard: { title: selectedCard.title, description: selectedCard.description },
      players: players,
    });
  }

  if (!tileEffectApplied) {
    switch (tile.type) {
      case "MANA_GAIN":
        currentPlayer.mana += 10;
        players[currentPlayerIndex] = currentPlayer;
        break;
      case "MINI_GAME_QUIZ": // New case
        logger.info(`Player ${currentPlayer.uid} landed on MINI_GAME_QUIZ.`);
        currentPlayer.mana += MANA_REWARD_MINI_GAME_QUIZ; // Using the constant
        // Optional: Cap mana if a manaMax is defined for the player in-game object
        // if (currentPlayer.mana > currentPlayer.manaMax) currentPlayer.mana = currentPlayer.manaMax;
        players[currentPlayerIndex] = currentPlayer;
        tileEffectApplied = true; // Mark that an effect was applied for this tile
        // Add a log or event for the client if needed
        await gameRef.update({
          players: players, // Update players array with new mana value
          log: FieldValue.arrayUnion({
            message: `${currentPlayer.displayName} gained ${MANA_REWARD_MINI_GAME_QUIZ} Mana from a Quiz!`,
            timestamp: FieldValue.serverTimestamp(),
          }),
        });
        break;
      // TODO: Add case for HANGEUL_TYPHOON if it's a separate tile type
      // case "HANGEUL_TYPHOON":
      //   currentPlayer.mana += MANA_REWARD_HANGEUL_TYPHOON; // Placeholder for future use
      //   players[currentPlayerIndex] = currentPlayer;
      //   tileEffectApplied = true;
      //   break;
      // other existing tile types
    }
  }

  // --- Turn Progression ---
  let nextPlayerIndex = (currentPlayerIndex + 1) % players.length;
  let nextPlayerId = players[nextPlayerIndex].uid;
  const nextTurnState = "AWAITING_ROLL";

  // Handle SKIP_TURN effect for the player whose turn it is about to be
  // This uses a flag on the player object, e.g., `player.skipNextTurn`
  // The `SKIP_TURN` event card effect should set this flag on the *current* player,
  // meaning *their own* next turn is skipped.
  // If the event card meant to make the *immediate next* player skip, the flag would be set on players[nextPlayerIndex] by the event card logic itself.

  // Let's refine the SKIP_TURN. The event card applies to the CURRENT player.
  // So if currentPlayer lands on SKIP_TURN, their *own* next turn is skipped.
  // This means we need a way to mark the current player.
  // The `await gameRef.update({ [`players.${currentPlayerIndex}.effects.skipNextTurn`]: true });` from event handling is one way.
  // Let's assume the actual skip logic is handled when it's their turn again.

  // The provided snippet to handle skipNextTurn:
  const playerAboutToPlay = { ...players[nextPlayerIndex] }; // Make a copy to check and modify

  // Check if the player designated to play next is under a 'skipNextTurn' effect.
  // This effect could have been applied to them previously.
  if (playerAboutToPlay.skipNextTurn) {
    logger.info(`Player ${playerAboutToPlay.displayName} (${playerAboutToPlay.uid}) is skipping their turn.`);
    // Remove the skipNextTurn flag from this player
    delete playerAboutToPlay.skipNextTurn;
    players[nextPlayerIndex] = playerAboutToPlay as Player; // Update in local players array

    // The turn passes to the player *after* the one who is skipping.
    nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
    nextPlayerId = players[nextPlayerIndex].uid;
    // The state remains AWAITING_ROLL for the new next player.

    await gameRef.update({
      players: players, // Save players array with the updated skipNextTurn flag removed
      currentPlayerId: nextPlayerId,
      turnState: nextTurnState,
      lastEventCard: null, // Reset for the new turn
    });
    return { success: true, effect: "TURN_SKIPPED", skippedPlayerId: playerAboutToPlay.uid };
  }

  // If the current player landed on a "SKIP_TURN" event tile, they skip their *own* next turn.
  // We need to set this flag now on the current player.
  if (tile.type === "event") {
    // const selectedCard = eventCards.find(card => card.id === gameData.lastEventCard?.id); // This requires lastEventCard to store 'id'
    // A better way: the event card effect should have directly set a flag on the player or game state.
    // For example, if the `SKIP_TURN` case in the event handling decided to set a flag like:
    // `players[currentPlayerIndex].effects = { skipNextTurn: true };` (or similar)
    // Then, we check that here for the *current* player before deciding the *actual* next player.

    // Re-evaluating: The SKIP_TURN event means the *current* player loses their *next* turn.
    // So, after this turn resolution, when it would normally be their turn again after others have played, they skip.
    // This means the flag `skipNextTurn` should be set on `players[currentPlayerIndex]`.
    // The logic above handles skipping for `players[nextPlayerIndex]`.
    // This suggests that if current player got a SKIP_TURN card, we set `players[currentPlayerIndex].skipNextTurn = true;`
    // This flag will be checked when it's their turn again.

    // Let's assume the SKIP_TURN event set: `players[currentPlayerIndex].skipNextTurnForOwnNext = true;`
    // This flag would persist on the player object.
    // The current skip logic correctly advances past a player who *starts* their turn already flagged to skip.
    // So, if player A gets SKIP_TURN card, `playerA.skipNextTurn = true` is set.
    // Turn passes to B. Then C. Then D.
    // When it's A's turn again, the check `if (playerAboutToPlay.skipNextTurn)` will catch it.
    // So the event logic just needs to set this flag on `players[currentPlayerIndex]`.

    // The case 'SKIP_TURN' in the event handling earlier:
    // `await gameRef.update({ [`players.${currentPlayerIndex}.effects.skipNextTurn`]: true });`
    // This is okay. Let's assume `player.effects.skipNextTurn` is the flag being checked by `playerAboutToPlay.skipNextTurn`.
    // Firestore direct update might not reflect immediately in `players` array in this function instance.
    // It's safer to update the local `players` array then save it.
    // If SKIP_TURN event happened:
    // players[currentPlayerIndex].skipNextTurn = true; // Set it locally for the save below.
    // This was implicitly done by `await gameRef.update({ [`players.${currentPlayerIndex}.effects.skipNextTurn`]: true });`
    // but to be safe for the *current* `players` array that will be saved:
    if (gameData.lastEventCard && eventCards.find((c) => c.title === gameData.lastEventCard.title)?.effect.type === "SKIP_TURN") {
      // Ensure the flag is set on the current player object in the `players` array that will be saved.
      // This assumes the effect was meant for the current player's *next* turn.
      // This should be handled by the effect setting `skipNextTurn` on the player object directly.
      // players[currentPlayerIndex].skipNextTurn = true;
    }
  }

  // Decrement effect durations for the player whose turn is ending
  const playerWhoseTurnIsEnding = players[currentPlayerIndex];
  if (playerWhoseTurnIsEnding.effects && playerWhoseTurnIsEnding.effects.length > 0) {
    playerWhoseTurnIsEnding.effects = playerWhoseTurnIsEnding.effects
      .map((effect: { type: string, duration: number }) => ({ ...effect, duration: effect.duration - 1 }))
      .filter((effect: { type: string, duration: number }) => effect.duration > 0);
    if (playerWhoseTurnIsEnding.effects.length === 0) {
      // delete playerWhoseTurnIsEnding.effects; // Firestore specific way to remove a field if needed
      // For an array, setting to empty or null is usually fine. Let's ensure it's an empty array if no effects.
      playerWhoseTurnIsEnding.effects = [];
    }
    players[currentPlayerIndex] = playerWhoseTurnIsEnding;
  }

  await gameRef.update({
    players: players, // This now includes players with updated effects
    board: board, // Save potentially modified board (e.g. trap removal)
    grimoirePositions: grimoirePositions,
    currentPlayerId: nextPlayerId,
    turnState: nextTurnState,
    lastEventCard: null, // Reset for the new turn (unless an EXTRA_ROLL happened)
  });
  return { success: true };
});

// =================================================================
//                    HANGEUL TYPHOON FUNCTIONS
// =================================================================

export const sendTyphoonAttack = onCall<SendTyphoonAttackRequest>({ cors: true }, async (request): Promise<SendTyphoonAttackResponse> => {
  logger.info("sendTyphoonAttack request received:", request.data);

  // Top-level variables for catch block logging, if needed before they are assigned in try.
  let gameIdForCatch: string | undefined = request.data.gameId; // Attempt to get it early
  let attackerPlayerIdForCatch: string | undefined = request.data.attackerPlayerId;

  try {
    // 1. Authentication Check & UID Extraction
    if (!request.auth) {
      logger.error("Unauthenticated call to sendTyphoonAttack");
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const uid = request.auth.uid;
    logger.info(`User ${uid} authenticated.`);

    // 2. Extract Request Data
    const { gameId, attackerPlayerId, targetPlayerId, attackWord } = request.data;
    // Update context for catch block
    gameIdForCatch = gameId;
    attackerPlayerIdForCatch = attackerPlayerId;


    // 3. Attacker ID Verification
    if (attackerPlayerId !== uid) {
      logger.error(`Attacker ID ${attackerPlayerId} does not match authenticated user ${uid}.`);
      throw new HttpsError("permission-denied", `Attacker ID ${attackerPlayerId} does not match authenticated user.`);
    }
    logger.info(`Attacker ID ${attackerPlayerId} verified against authenticated user ${uid}.`);

    // 4. Input Validation (Basic)
    if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
      throw new HttpsError("invalid-argument", "Missing or invalid gameId.");
    }
    if (!attackerPlayerId || typeof attackerPlayerId !== "string" || attackerPlayerId.trim() === "") {
      throw new HttpsError("invalid-argument", "Missing or invalid attackerPlayerId.");
    }
    if (!targetPlayerId || typeof targetPlayerId !== "string" || targetPlayerId.trim() === "") {
      throw new HttpsError("invalid-argument", "Missing or invalid targetPlayerId.");
    }
    if (!attackWord || typeof attackWord !== "string" || attackWord.trim() === "") {
      throw new HttpsError("invalid-argument", "Missing or invalid attackWord.");
    }
    logger.info("Request parameters validated.");

    // 5. Fetch Game Document
    const gameRef = db.collection("games").doc(gameId);
    let gameDoc;
    // Specific try-catch for Firestore fetch, could be part of the main try-catch too.
    try {
      gameDoc = await gameRef.get();
    } catch (error) {
      logger.error(`Error fetching game document ${gameId}:`, error);
      if (error instanceof Error) {
        throw new HttpsError("internal", `Failed to fetch game data for gameId ${gameId}. Details: ${error.message}`);
      } else {
        throw new HttpsError("internal", `Failed to fetch game data for gameId ${gameId}. An unknown error occurred.`);
      }
    }

    // 6. Game Existence and Status Check
    if (!gameDoc.exists) {
      logger.error(`Game with ID ${gameId} not found.`);
      throw new HttpsError("not-found", `Game with ID ${gameId} not found.`);
    }
    const gameData = gameDoc.data() as Game; // Type assertion using Game type
    logger.info(`Game ${gameId} found.`);

    if (gameData.status !== "playing") {
      logger.warn(`Game ${gameId} is not active. Current status: ${gameData.status}`);
      throw new HttpsError("failed-precondition", `Game ${gameId} is not active. Current status: ${gameData.status}`);
    }
    logger.info(`Game ${gameId} is active (status: ${gameData.status}).`);

    // 7. Player Participation Verification & Game State Retrieval
    const attackerPlayer = gameData.players.find((p) => p.uid === attackerPlayerId);
    const targetPlayer = gameData.players.find((p) => p.uid === targetPlayerId);

    if (!attackerPlayer) {
      logger.error(`Attacker player ${attackerPlayerId} object not found in game ${gameId} despite prior checks.`);
      throw new HttpsError("internal", `Attacker ${attackerPlayerId} data is inconsistent within game ${gameId}.`);
    }
    if (!targetPlayer) {
      logger.error(`Target player ${targetPlayerId} object not found in game ${gameId} despite prior checks.`);
      throw new HttpsError("internal", `Target ${targetPlayerId} data is inconsistent within game ${gameId}.`);
    }
    if (targetPlayer.blocks === undefined || targetPlayer.blocks === null) {
      logger.error(`Target player ${targetPlayerId} blocks array is undefined or null. Game data: `, gameData);
      throw new HttpsError("internal", `Target player ${targetPlayerId} blocks data is missing or inconsistent.`);
    }
    logger.info(`Attacker ${attackerPlayerId} data: groundHeight ${attackerPlayer.groundHeight}`);
    logger.info(`Target ${targetPlayerId} data: ${targetPlayer.blocks.length} blocks, groundHeight ${targetPlayer.groundHeight}`);

    if (attackerPlayerId === targetPlayerId) {
      logger.error("Attacker and target cannot be the same player.");
      throw new HttpsError("invalid-argument", "Attacker and target cannot be the same player.");
    }
    logger.info(`Attacker ${attackerPlayerId} and Target ${targetPlayerId} game states retrieved and verified in game ${gameId}.`);

    const currentTime = admin.firestore.Timestamp.now();
    let targetBlock: Player["blocks"][0] | undefined = undefined;
    let blockIndex = -1;

    for (let i = 0; i < targetPlayer.blocks.length; i++) {
      const block = targetPlayer.blocks[i];
      if (block.text === attackWord && !block.isDestroyed) {
        targetBlock = block;
        blockIndex = i;
        break;
      }
    }

    let isAttackSuccessful = false;
    let failureReason = "";

    if (!targetBlock) {
      logger.info(`Attack validation: No active block found for word "${attackWord}" for target ${targetPlayerId}.`);
      failureReason = "WORD_NOT_FOUND_OR_DESTROYED";
      isAttackSuccessful = false;
    } else {
      if (targetBlock.vulnerableAt.toMillis() <= currentTime.toMillis()) {
        logger.info(`Attack validation: Block "${targetBlock.text}" for target ${targetPlayerId} is vulnerable.`);
        isAttackSuccessful = true;
      } else {
        logger.info(`Attack validation: Block "${targetBlock.text}" for target ${targetPlayerId} is not vulnerable. Vulnerable at: ${targetBlock.vulnerableAt.toDate().toISOString()}, Current time: ${currentTime.toDate().toISOString()}`);
        failureReason = "BLOCK_NOT_VULNERABLE";
        isAttackSuccessful = false;
      }
    }

    if (isAttackSuccessful) {
      if (!targetBlock || blockIndex === -1) {
        logger.error("Critical error: targetBlock or blockIndex is invalid in successful attack path.", { targetBlock, blockIndex });
        throw new HttpsError("internal", "Inconsistent state during successful attack processing.");
      }
      logger.info(`Processing successful attack on block: ${targetBlock.id} - ${targetBlock.text} for target ${targetPlayer.uid}`);
      const updatedTargetBlocks = JSON.parse(JSON.stringify(targetPlayer.blocks));
      updatedTargetBlocks[blockIndex].isDestroyed = true;
      const destroyedBlockWord = targetBlock.text;
      const targetGroundRiseAmount = DEFAULT_GROUND_RISE_AMOUNT;
      const newTargetGroundHeight = (targetPlayer.groundHeight || 0) + targetGroundRiseAmount;
      const updatedPlayers = gameData.players.map((p) => {
        if (p.uid === targetPlayer.uid) {
          return { ...p, blocks: updatedTargetBlocks, groundHeight: newTargetGroundHeight };
        }
        return p;
      });
      await gameRef.update({ players: updatedPlayers });
      logger.info(`Firestore updated successfully for successful attack. Target: ${targetPlayer.uid}, Block: ${targetBlock.id}`);
      return {
        status: "success",
        message: "Attack successful. Target's block destroyed.",
        attackerPlayerId: attackerPlayerId,
        targetPlayerId: targetPlayer.uid,
        destroyedBlockWord: destroyedBlockWord,
        targetGroundRiseAmount: targetGroundRiseAmount,
      } as SendTyphoonAttackSuccessResponse;
    } else {
      if (!attackerPlayer) {
        logger.error("Critical error: attackerPlayer is invalid in failed attack path.", { attackerPlayerId });
        throw new HttpsError("internal", "Inconsistent state during failed attack processing: attacker data missing.");
      }
      const attackerPenaltyGroundRiseAmount = DEFAULT_PENALTY_RISE_AMOUNT;
      const newAttackerGroundHeight = (attackerPlayer.groundHeight || 0) + attackerPenaltyGroundRiseAmount;
      logger.info(`Processing failed attack for attacker: ${attackerPlayer.uid}. Reason: ${failureReason}. Applying penalty of ${attackerPenaltyGroundRiseAmount}. New ground height: ${newAttackerGroundHeight}`);
      const updatedPlayers = gameData.players.map((p) => {
        if (p.uid === attackerPlayer.uid) {
          return { ...p, groundHeight: newAttackerGroundHeight };
        }
        return p;
      });
      await gameRef.update({ players: updatedPlayers });
      logger.info(`Firestore updated successfully for failed attack. Attacker: ${attackerPlayer.uid} penalized.`);
      return {
        status: "failure",
        reason: failureReason || "UNKNOWN_FAILURE",
        message: "Attack failed. Attacker penalized.",
        attackerPlayerId: attackerPlayerId,
        attackerPenaltyGroundRiseAmount: attackerPenaltyGroundRiseAmount,
      } as SendTyphoonAttackFailureResponse;
    }
  } catch (error) {
    // Log with context if available
    logger.error(`Unhandled error in sendTyphoonAttack for game: ${gameIdForCatch || "unknown"}, attacker: ${attackerPlayerIdForCatch || "unknown"}, error:`, error);
    if (error instanceof HttpsError) {
      throw error; // Re-throw HttpsErrors directly
    }
    // For other errors, throw a generic HttpsError
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    throw new HttpsError("internal", "An unexpected internal error occurred processing your attack.", { details: errorMessage });
  }
});


export const castSpell = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Non authentifié.");
  const { gameId, spellId, targetId, options } = request.data; // Added options
  if (typeof gameId !== "string" || typeof spellId !== "string") { // targetId validation depends on spell
    throw new HttpsError("invalid-argument", "Données de sort invalides (gameId, spellId requis).");
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
  let targetIndex = -1;
  if (spell.type !== "TERRAIN" && typeof targetId === "string") { // TERRAIN spells might not have a player targetId
    targetIndex = gameData.players.findIndex((p: Player) => p.uid === targetId);
  }


  // Validations for caster and target (if applicable)
  if (casterIndex === -1) {
    throw new HttpsError("not-found", "Caster not found.");
  }
  if (spell.type !== "TERRAIN" && spell.id !== "MANA_SHIELD" && targetIndex === -1) { // MANA_SHIELD targets self, TERRAIN might not target a player
    throw new HttpsError("not-found", "Target player not found for this spell type.");
  }
  if (spell.id !== "MANA_SHIELD" && spell.type !== "TERRAIN" && uid === targetId) { // Allow self-target only for MANA_SHIELD (TERRAIN has no player target)
    throw new HttpsError("invalid-argument", "Cannot target self with this spell.");
  }
  if (spell.id === "MANA_SHIELD" && uid !== targetId) {
    throw new HttpsError("invalid-argument", "MANA_SHIELD must target self.");
  }


  const players = [...gameData.players];
  if (players[casterIndex].mana < spell.manaCost) {
    throw new HttpsError("failed-precondition", "Mana insuffisant.");
  }

  players[casterIndex].mana -= spell.manaCost;

  // Increment spellsCast stat for the caster
  const casterStatsRef = db.collection("users").doc(uid);
  await casterStatsRef.update({
    "stats.spellsCast": admin.firestore.FieldValue.increment(1),
  }).catch((error) => {
    logger.error(`Erreur lors de la mise à jour de stats.spellsCast pour ${uid}:`, error);
    // Continue even if stat update fails, core game logic is more critical.
  });

  // After successful spell cast and stat update, check for achievements
  // uid is casterId, gameId is from request.data.gameId
  try {
    await checkAndGrantAchievementsInternal(uid, gameId);
    logger.info(`Achievement check initiated for caster ${uid} in game ${gameId} after spell cast.`);
  } catch (error) {
    logger.error(`Error initiating achievement check for caster ${uid} in game ${gameId} after spell cast:`, error);
  }

  switch (spell.id) {
    case "BLESSING_OF_HANGEUL": {
      if (targetIndex === -1) throw new HttpsError("invalid-argument", "Target required for BLESSING_OF_HANGEUL.");
      players[targetIndex].mana += 10; // Changed from 5 to 10
      break;
    }
    case "KIMCHIS_MALICE": {
      if (targetIndex === -1) throw new HttpsError("invalid-argument", "Target required for KIMCHIS_MALICE.");
      players[targetIndex].mana = Math.max(0, players[targetIndex].mana - 15); // Changed from 8 to 15
      break;
    }
    case "RUNE_TRAP": {
      if (typeof options?.tileIndex !== "number" || options.tileIndex < 0 || options.tileIndex >= gameData.board.length) {
        throw new HttpsError("invalid-argument", "Valid tileIndex is required in options for RUNE_TRAP.");
      }
      const boardCopy = [...gameData.board];
      boardCopy[options.tileIndex] = { ...boardCopy[options.tileIndex], trap: { ownerId: uid, spellId: spell.id } }; // Added spellId to trap
      await gameRef.update({
        players: players,
        board: boardCopy,
        lastSpellCast: { spellId, casterId: uid, options },
      });
      // Note: spellsCast was already incremented before the switch.
      return { success: true }; // Return early as board update is specific
    }
    case "MANA_SHIELD": {
      // Target is self, casterIndex is used.
      const existingEffects = players[casterIndex].effects || [];
      const hasShield = existingEffects.some((effect: { type: string }) => effect.type === "SHIELDED");
      if (!hasShield) {
        players[casterIndex].effects = [...existingEffects, { type: "SHIELDED", duration: 1, spellId: spell.id }]; // Duration changed to 1
      } else {
        players[casterIndex].effects = existingEffects.map((effect: { type: string, duration: number }) =>
          effect.type === "SHIELDED" ? { ...effect, duration: 1 } : effect // Duration changed to 1
        );
      }
      break;
    }
    case "ASTRAL_SWAP": {
      if (targetIndex === -1) throw new HttpsError("invalid-argument", "Target required for ASTRAL_SWAP.");
      if (uid === targetId) { // Should be caught by earlier general check but good to have specific
        throw new HttpsError("invalid-argument", "Cannot swap with yourself.");
      }
      // player1Index is casterIndex
      const pos1 = players[casterIndex].position;
      const pos2 = players[targetIndex].position;
      players[casterIndex].position = pos2;
      players[targetIndex].position = pos1;
      break;
    }
  }

  await gameRef.update({
    players: players,
    lastSpellCast: { spellId, casterId: uid, targetId: targetId, options }, // targetId might be null for RUNE_TRAP but handled above
  });
  return { success: true };
});
