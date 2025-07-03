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
import {
  Player,
  Tile,
  Guild,
  SendTyphoonAttackRequest,
  SendTyphoonAttackResponse,
  Game,
  SendTyphoonAttackSuccessResponse,
  SendTyphoonAttackFailureResponse,
  QuestDefinition,
  PlayerActiveQuest,
  SpellMasteryItem,
  PrepareMiniGameChallengeRequest, // Added
  MiniGameChallenge,               // Added
  ContentItem,                     // Added
  UserProfileWithCEFR,             // Added
  SpellMasteryItemWithCEFR,        // Added
} from "./types";
import { SPELL_DEFINITIONS, SpellId } from "./spells";
import { eventCards } from "./data/eventCards";

// Mana Reward Constants
const MANA_REWARD_MINI_GAME_QUIZ = 20;
// const MANA_REWARD_HANGEUL_TYPHOON = 40; // Placeholder for future use

// Mini-Game Challenge Constants
const DEFAULT_CHALLENGE_SIZE = 4; // 1 correct, 3 distractors

// SRS Constants
const DEFAULT_EASE_FACTOR = 2.5;
const INITIAL_INTERVAL_DAYS = 1;
const MAX_MASTERY_LEVEL = 8; // Example max level
const REVIEW_ITEMS_LIMIT = 20; // Max items to return for review

// Hangeul Typhoon Constants
const DEFAULT_GROUND_RISE_AMOUNT = 10;
const DEFAULT_PENALTY_RISE_AMOUNT = 5;

// Guild Constants
const MAX_GUILD_MEMBERS = 50; // Maximum members allowed in a guild

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

if (admin.apps.length === 0) {
  admin.initializeApp();
}
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

// TODO: Review and remove one of the two redundant user creation functions.
// Both `createProfileOnSignup` and `onUserCreate` are triggered on user creation (`functionsV1.auth.user().onCreate`).
// Keeping both can lead to duplicate data or unintended side effects.
// It's recommended to consolidate the logic into a single function.
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
        createdAt: FieldValue.serverTimestamp(),
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
        ownedCosmetics: [], // Initialize with no owned cosmetics
        equippedCosmetics: { // Initialize with no equipped cosmetics
          outfit: null,
          pet: null,
          spellEffect: null,
        },
        totalExperience: 0, // Initialize Grimoire Vivant fields
        wizardLevel: 1, // Initialize Grimoire Vivant fields
      });

      console.log(`[Auth Trigger] Firestore document successfully created for user ${uid}.`);
    } catch (error) {
      console.error(
        `[Auth Trigger] Error creating Firestore document for user ${uid}:`,
        error
      );
    }
  });

// =================================================================
//                    GRIMOIRE VIVANT FUNCTIONS
// =================================================================

interface SpellMasteryStatusDoc {
  masteryLevel?: number;
  // Add other fields if needed
}


export const updatePlayerExperienceOnRuneChange = functions.firestore.onDocumentWritten(
  "playerLearningProfiles/{userId}/spellMasteryStatus/{contentId}",
  async (event) => {
    const userId: string = event.params.userId;
    const userRef = db.collection("users").doc(userId);

    logger.info(`Rune changed for user ${userId}, recalculating total experience.`);

    try {
      const spellMasterySnapshot = await db
        .collection(`playerLearningProfiles/${userId}/spellMasteryStatus`)
        .get();

      let totalExperience: number = 0;
      if (spellMasterySnapshot.empty) {
        logger.info(`No runes found for user ${userId}. Setting experience to 0.`);
      } else {
        spellMasterySnapshot.forEach((doc) => {
          const runeData = doc.data() as SpellMasteryStatusDoc;
          const masteryLevel = runeData.masteryLevel; // Assuming this field exists

          if (typeof masteryLevel === "number") {
            switch (masteryLevel) {
            case 1:
              totalExperience += 1;
              break;
            case 2:
              totalExperience += 5;
              break;
            case 3:
              totalExperience += 20;
              break;
            case 4:
              totalExperience += 50;
              break;
            default:
              logger.warn(`Unknown masteryLevel ${masteryLevel} for rune ${doc.id} of user ${userId}`);
            }
          } else {
            logger.warn(`masteryLevel is not a number for rune ${doc.id} of user ${userId}:`, masteryLevel);
          }
        });
      }

      // Calculate wizardLevel
      const wizardLevel: number = Math.floor(totalExperience / 100) + 1;

      const updateData = {
        totalExperience: totalExperience,
        wizardLevel: wizardLevel,
      };

      await userRef.update(updateData);

      logger.info(`User ${userId} updated. Total Experience: ${totalExperience}, Wizard Level: ${wizardLevel}`);
      return null;
    } catch (error) {
      logger.error(`Error recalculating experience for user ${userId}:`, error);
      // Optionally, re-throw the error if you want the function to retry or be marked as failed.
      // For now, we log the error and let the function complete to avoid infinite retries on bad data.
      return null;
    }
  }
);

export const updateUserProfile = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté.");
  const { displayName, language } = request.data;
  const { uid } = request.auth;

  const updateData: { [key: string]: unknown } = {};

  if (displayName !== undefined) {
    if (typeof displayName !== "string" || displayName.length < 3 || displayName.length > 20) {
      throw new functions.https.HttpsError("invalid-argument", "Le displayName doit contenir entre 3 et 20 caractères.");
    }
    updateData.displayName = displayName;
  }

  if (language !== undefined) {
    if (typeof language !== "string" || language.length < 2 || language.length > 10) { // Basic validation for language code
      throw new functions.https.HttpsError("invalid-argument", "La langue fournie est invalide.");
    }
    updateData.languagePreference = language;
  }

  if (Object.keys(updateData).length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Aucune donnée à mettre à jour (displayName ou language requis).");
  }

  await admin.firestore().collection("users").doc(uid).update(updateData);
  return { status: "succès", updatedFields: Object.keys(updateData) };
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
  const { name, tag, description, emblem } = request.data; // Added description and emblem
  if (typeof name !== "string" || name.length < 3 || name.length > 30) {
    throw new HttpsError("invalid-argument", "Le nom de la guilde doit contenir entre 3 et 30 caractères.");
  }
  if (typeof tag !== "string" || tag.length < 2 || tag.length > 5) {
    throw new HttpsError("invalid-argument", "Le tag de la guilde doit contenir entre 2 et 5 caractères.");
  }
  if (typeof description !== "string" || description.length < 10 || description.length > 200) { // Added validation
    throw new HttpsError("invalid-argument", "La description de la guilde doit contenir entre 10 et 200 caractères.");
  }
  if (typeof emblem !== "string" || emblem.trim() === "") { // Added validation (e.g., ensuring it's a non-empty string if it's an ID/URL)
    throw new HttpsError("invalid-argument", "Un emblème valide est requis.");
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
      const newGuildData: Guild = {
        id: newGuildRef.id,
        name,
        tag,
        description, // Added
        emblem, // Added
        leaderId: uid, // masterId equivalent
        members: { // Changed to map with roles and joinedAt
          [uid]: {
            role: "master",
            displayName: displayName, // displayName of the creator
            joinedAt: admin.firestore.Timestamp.now(), // Timestamp of guild creation for the master
          },
        },
        memberCount: 1, // Added
        createdAt: admin.firestore.Timestamp.now(),
      };
      transaction.set(newGuildRef, newGuildData);

      // 6. Update user's profile with guildId and role
      transaction.update(userRef, {
        guildId: newGuildRef.id,
        guildRole: "master", // Added guildRole
      });

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

/**
 * Updates a spell mastery item based on the user's review performance (correct or incorrect).
 * Implements an SM-2 like Spaced Repetition System algorithm.
 */
export const updateReviewItem = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour mettre à jour une rune.");
  }
  const uid = request.auth.uid;
  const { itemId, isCorrect } = request.data;

  if (typeof itemId !== "string" || itemId.trim() === "") {
    throw new HttpsError("invalid-argument", "L'ID de l'item (itemId) est manquant ou invalide.");
  }
  if (typeof isCorrect !== "boolean") {
    throw new HttpsError("invalid-argument", "Le statut de la réponse (isCorrect) est manquant ou invalide.");
  }

  const itemRef = db.collection("users").doc(uid).collection("spellMastery").doc(itemId);
  const now = admin.firestore.Timestamp.now();

  try {
    return await db.runTransaction(async (transaction) => {
      const itemDoc = await transaction.get(itemRef);
      if (!itemDoc.exists) {
        throw new HttpsError("not-found", `L'item de révision avec l'ID ${itemId} n'a pas été trouvé.`);
      }

      const item = itemDoc.data() as SpellMasteryItem;

      // Initialize fields if they are missing (for items created before SRS fields were added)
      let masteryLevel = item.masteryLevel || 0;
      let easeFactor = item.easeFactor || DEFAULT_EASE_FACTOR;
      let interval = item.interval || 0; // days
      let reviews = item.reviews || 0;
      let lapses = item.lapses || 0;

      reviews++;

      if (isCorrect) {
        if (masteryLevel === 0) { // First time correct, or correct after a lapse
          interval = INITIAL_INTERVAL_DAYS;
        } else if (masteryLevel === 1) {
          interval = Math.ceil(INITIAL_INTERVAL_DAYS * 2.5); // e.g., 2-3 days, SM-2 often suggests 6 days for second interval
        } else {
          interval = Math.ceil(interval * easeFactor);
        }
        masteryLevel++;
        if (masteryLevel > MAX_MASTERY_LEVEL) {
          masteryLevel = MAX_MASTERY_LEVEL;
        }
        // SM-2: Ease factor is adjusted based on the quality of response (q).
        // For simplicity here, if correct, we don't adjust EF aggressively unless q < 3 (hard).
        // If we assume any "correct" is q >= 3, EF might not change or slightly increase.
        // Let's keep EF stable on correct, or slightly increase if it was very easy (not implemented here).
        // A common simplification: EF only decreases on incorrect.
      } else { // Incorrect
        lapses++;
        masteryLevel = 0; // Reset mastery level (or decrease by 1 or more)
        interval = INITIAL_INTERVAL_DAYS; // Reset interval
        easeFactor = Math.max(1.3, easeFactor - 0.2); // Decrease easeFactor, but not below 1.3
      }

      const nextReviewDate = admin.firestore.Timestamp.fromMillis(
        now.toMillis() + interval * 24 * 60 * 60 * 1000
      );

      const updateData: Partial<SpellMasteryItem> = {
        masteryLevel,
        easeFactor,
        interval,
        nextReviewDate,
        lastReviewedDate: now,
        reviews,
        lapses,
      };

      transaction.update(itemRef, updateData);

      return { success: true, message: `Item ${itemId} mis à jour.`, nextReview: nextReviewDate.toDate().toISOString() };
    });
  } catch (error) {
    logger.error(`Erreur lors de la mise à jour de la rune ${itemId} pour l'utilisateur ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de la mise à jour de la rune.");
  }
});

// =================================================================
//                    GESTION DES COSMETIQUES
// =================================================================

export const equipCosmeticItem = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour équiper un objet cosmétique.");
  }
  const { uid } = request.auth;
  const { itemId, slot } = request.data;

  if (typeof itemId !== "string" || itemId.trim() === "") {
    throw new HttpsError("invalid-argument", "L'ID de l'objet (itemId) est manquant ou invalide.");
  }
  if (typeof slot !== "string" || slot.trim() === "") {
    throw new HttpsError("invalid-argument", "Le slot d'équipement (slot) est manquant ou invalide.");
  }

  const userRef = db.collection("users").doc(uid);

  try {
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "Profil utilisateur non trouvé.");
    }
    const userData = userDoc.data();

    // Verify ownership
    if (!userData?.ownedCosmetics || !userData.ownedCosmetics.includes(itemId)) {
      throw new HttpsError("failed-precondition", "Vous ne possédez pas cet objet cosmétique.");
    }

    // Validate slot
    const validSlots = ["outfit", "pet", "spellEffect"];
    if (!validSlots.includes(slot)) {
      throw new HttpsError("invalid-argument", `Slot d'équipement invalide. Les slots valides sont : ${validSlots.join(", ")}.`);
    }

    // Update equipped cosmetics
    // Make sure equippedCosmetics field exists, though it should from onUserCreate
    const currentEquipped = userData.equippedCosmetics || { outfit: null, pet: null, spellEffect: null };
    currentEquipped[slot] = itemId;

    await userRef.update({
      [`equippedCosmetics.${slot}`]: itemId,
    });

    logger.info(`User ${uid} equipped item ${itemId} in slot ${slot}.`);
    return { success: true, message: "Objet cosmétique équipé avec succès." };
  } catch (error) {
    logger.error(`Erreur lors de l'équipement de l'objet ${itemId} pour l'utilisateur ${uid} dans le slot ${slot}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de l'équipement de l'objet cosmétique.");
  }
});

/**
 * Completes a quest for a user by updating rewards, moving the quest to completed, and removing it from active quests.
 * @param {admin.firestore.Transaction} transaction - The Firestore transaction.
 * @param {string} userId - The ID of the user completing the quest.
 * @param {string} questId - The ID of the quest being completed.
 * @param {QuestDefinition} questDef - The quest definition containing rewards and details.
 */
async function completeQuestInternal(transaction: admin.firestore.Transaction, userId: string, questId: string, questDef: QuestDefinition) {
  const userRef = db.collection("users").doc(userId);
  const playerActiveQuestRef = db.collection("playerQuests").doc(userId).collection("activeQuests").doc(questId); // CORRIGÉ: uid -> userId
  const playerCompletedQuestRef = db.collection("playerQuests").doc(userId).collection("completedQuests").doc(questId);

  // 1. Lire les récompenses (déjà passées via questDef) et mettre à jour le profil utilisateur
  if (questDef.rewards.xp) {
    transaction.update(userRef, {
      xp: FieldValue.increment(questDef.rewards.xp),
    });
  }
  // Ajouter d'autres récompenses ici (mana, items, etc.)

  // 2. Créer le document de quête complétée
  const completedQuestData = {
    questId: questId,
    completedAt: FieldValue.serverTimestamp(),
    // title: questDef.title, // Dénormalisation optionnelle
  };
  transaction.set(playerCompletedQuestRef, completedQuestData);

  // 3. Supprimer la quête active
  transaction.delete(playerActiveQuestRef);

  logger.info(`Quest ${questId} completed for user ${userId}. XP awarded: ${questDef.rewards.xp || 0}`);
}


export const submitGameAction = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour soumettre une action de jeu.");
  }
  const uid = request.auth.uid; // C'est le userId
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { actionType, actionDetails } = request.data; // actionDetails pourrait contenir { theme: "food" } par exemple

  if (typeof actionType !== "string" || !actionType) {
    throw new HttpsError("invalid-argument", "Le type d'action (actionType) est manquant ou invalide.");
  }

  const playerActiveQuestsRef = db.collection("playerQuests").doc(uid).collection("activeQuests");

  try {
    const activeQuestsSnapshot = await playerActiveQuestsRef.get();
    if (activeQuestsSnapshot.empty) {
      // logger.info(`User ${uid} has no active quests to update for action ${actionType}.`);
      return { success: true, message: "Aucune quête active à mettre à jour." };
    }

    let questsUpdated = 0;
    let questsCompleted = 0;

    for (const questDoc of activeQuestsSnapshot.docs) {
      const activeQuest = questDoc.data() as PlayerActiveQuest; // Utiliser PlayerActiveQuest de src/types
      const questDefRef = db.collection("questDefinitions").doc(activeQuest.questId);
      const questDefDoc = await questDefRef.get();

      if (!questDefDoc.exists) {
        logger.warn(`Quest definition ${activeQuest.questId} not found for active quest of user ${uid}. Skipping.`);
        continue;
      }
      const questDef = questDefDoc.data() as QuestDefinition; // Utiliser QuestDefinition de src/types

      // Supposons pour l'instant que les quêtes ont un seul objectif pour simplifier
      // et que currentStep se réfère à cet objectif (toujours 0 pour l'instant).
      const objective = questDef.objectives[activeQuest.currentStep || 0];
      if (!objective) {
        logger.warn(`Objective not found for quest ${activeQuest.questId}, step ${activeQuest.currentStep || 0}. User: ${uid}`);
        continue;
      }

      // Logique de correspondance d'objectif (simplifiée)
      // Par exemple, si actionType est "minigame_food_completed" et objective.type est "minigame_food_completed"
      let actionMatchesObjective = false;
      if (objective.type === actionType) {
        // Pourrait y avoir des vérifications plus poussées dans actionDetails si nécessaire
        // Par exemple, si objective.targetId est défini (ex: un mini-jeu spécifique)
        actionMatchesObjective = true;
      }
      // Exemple plus complexe: si l'objectif est de "réussir un mini-jeu sur le thème X"
      // et que actionDetails contient { theme: "food" } et objective.targetId est "food"
      // if (objective.type === "minigame_theme_completed" && objective.targetId === actionDetails?.theme) {
      //   actionMatchesObjective = true;
      // }


      if (actionMatchesObjective) {
        const newProgress = (activeQuest.progress || 0) + 1;

        if (newProgress >= objective.target) {
          // Quête (ou étape d'objectif) complétée
          await db.runTransaction(async (transaction) => {
            // Utiliser la fonction interne pour la logique de complétion
            // On passe questDef pour éviter une relecture dans la transaction
            await completeQuestInternal(transaction, uid, activeQuest.questId, questDef);
          });
          questsCompleted++;
        } else {
          // Mettre à jour la progression
          await playerActiveQuestsRef.doc(activeQuest.questId).update({ progress: newProgress });
          questsUpdated++;
        }
      }
    }

    return {
      success: true,
      message: `Action ${actionType} traitée. Quêtes mises à jour: ${questsUpdated}, Quêtes complétées: ${questsCompleted}.`,
    };
  } catch (error) {
    logger.error(`Erreur lors du traitement de l'action ${actionType} pour ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors du traitement de l'action de jeu.");
  }
});

export const listGuilds = onCall({ cors: true }, async (request) => {
  // No auth check needed for listing public guilds, unless specified otherwise.
  // For now, assuming public listing.

  const { limit: reqLimit, startAfterDocId } = request.data || {};

  const DEFAULT_LIMIT = 10;
  const MAX_LIMIT = 25;

  const limit = typeof reqLimit === "number" && reqLimit > 0 ? Math.min(reqLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  let query = db.collection("guilds")
    .orderBy("name") // Order by name for consistent pagination
    .limit(limit);

  if (startAfterDocId && typeof startAfterDocId === "string") {
    try {
      const startAfterDoc = await db.collection("guilds").doc(startAfterDocId).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      } else {
        logger.warn(`listGuilds: startAfterDocId ${startAfterDocId} not found.`);
        // Proceed without startAfter, effectively starting from the beginning for this query.
      }
    } catch (error) {
      logger.error(`listGuilds: Error fetching startAfterDocId ${startAfterDocId}:`, error);
      // Proceed without startAfter on error.
    }
  }

  try {
    const snapshot = await query.get();
    const guilds: Partial<Guild>[] = []; // Use a more specific type instead of any[]
    snapshot.forEach((doc) => {
      const data = doc.data();
      guilds.push({
        id: doc.id,
        name: data.name,
        tag: data.tag,
        description: data.description,
        emblem: data.emblem,
        memberCount: data.memberCount,
        // Do not include the full 'members' map for public listing.
      });
    });

    // Determine the ID of the last document for next page's startAfter
    const lastDocInPage = snapshot.docs[snapshot.docs.length - 1];
    const nextPageStartAfterDocId = lastDocInPage ? lastDocInPage.id : null;

    return {
      guilds,
      nextPageStartAfterDocId, // Client can use this for the next request
      hasMore: guilds.length === limit, // A simple way to suggest if there might be more
    };
  } catch (error) {
    logger.error("Erreur lors de la récupération de la liste des guildes:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de la récupération de la liste des guildes.");
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
      const guildData = guildDoc.data() as Guild; // Cast to updated Guild type

      // 5. Check if guild is full
      if (guildData.memberCount >= MAX_GUILD_MEMBERS) {
        throw new HttpsError("failed-precondition", `La guilde "${guildData.name}" est pleine.`);
      }

      // 6. Check if user is already a member (using the new members map structure)
      // This check is technically redundant due to userData.guildId check, but good for integrity.
      if (guildData.members && guildData.members[uid]) {
        // This case should ideally not be reached if user profile guildId is managed correctly.
        // If reached, it implies an inconsistency. We can update user profile as a corrective measure.
        transaction.update(userRef, { guildId: guildId, guildRole: guildData.members[uid].role || "member" });
        throw new HttpsError("failed-precondition", "Vous êtes déjà listé comme membre de cette guilde (profil mis à jour).");
      }

      // 7. Add user to guild's members map and increment memberCount
      const memberDetail = { // Using GuildMemberDetail structure
        role: "member",
        displayName: displayName,
        joinedAt: admin.firestore.Timestamp.now(),
      };
      transaction.update(guildRef, {
        [`members.${uid}`]: memberDetail, // Add new member to the map
        memberCount: FieldValue.increment(1), // Atomically increment memberCount
      });

      // 8. Update user's profile with guildId and role
      transaction.update(userRef, {
        guildId: guildId,
        guildRole: "member", // Set user's role in the guild
      });

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

      const guildData = guildDoc.data() as Guild; // Cast to updated Guild type

      // Check if user is actually in the members map (new structure)
      if (!guildData.members || !guildData.members[uid]) {
        // Data inconsistency: user has guildId, guild exists, but user not in members map. Clean up.
        logger.warn(`Utilisateur ${uid} (guildId: ${currentGuildId}) non trouvé dans la map des membres de la guilde ${guildData.name}. Nettoyage du profil.`);
        transaction.update(userRef, {
          guildId: FieldValue.delete(),
          guildRole: FieldValue.delete(), // Also remove role
        });
        throw new HttpsError("internal", "Erreur interne : vous n'étiez pas listé dans les membres de la guilde. Votre profil a été mis à jour.");
      }

      // Prepare updates for the guild document
      const guildUpdates: { [key: string]: admin.firestore.FieldValue | string | number | null | undefined } = {
        [`members.${uid}`]: FieldValue.delete(), // Remove member from map
        memberCount: FieldValue.increment(-1), // Decrement memberCount
      };

      let finalMessage = `Vous avez quitté la guilde "${guildData.name}".`;
      let newLeaderId: string | null = null;
      let newLeaderProfileUpdate = null;

      if (guildData.leaderId === uid) {
        // Leader is leaving
        if (guildData.memberCount - 1 <= 0) { // Check if guild will be empty
          transaction.delete(guildRef); // Delete the guild
          finalMessage = `Vous avez quitté la guilde "${guildData.name}" et étiez le dernier membre. La guilde a été dissoute.`;
        } else {
          // Promote the oldest member (earliest joinedAt)
          let oldestMemberUid: string | null = null;
          let oldestJoinedAt: admin.firestore.Timestamp | null = null;

          for (const memberUid in guildData.members) {
            if (memberUid === uid) continue; // Skip the leaving leader

            const memberDetail = guildData.members[memberUid];
            if (!oldestJoinedAt || memberDetail.joinedAt.toMillis() < oldestJoinedAt.toMillis()) {
              oldestJoinedAt = memberDetail.joinedAt;
              oldestMemberUid = memberUid;
            }
          }

          if (oldestMemberUid) {
            newLeaderId = oldestMemberUid;
            guildUpdates.leaderId = newLeaderId;
            guildUpdates[`members.${newLeaderId}.role`] = "master"; // Promote new leader

            // Prepare update for the new leader's user profile
            const newLeaderUserRef = db.collection("users").doc(newLeaderId);
            // This needs to be done carefully within transaction or after.
            // For simplicity in transaction, we'll just update the guild doc here.
            // User profile update for new leader might need to be outside or handled by client listening to guild changes.
            // Let's try to include it in the transaction.
            newLeaderProfileUpdate = { ref: newLeaderUserRef, data: { guildRole: "master" } };

            finalMessage = `Vous avez quitté la guilde "${guildData.name}" en tant que leader. ${guildData.members[newLeaderId].displayName} a été promu(e) nouveau leader.`;
            logger.info(`Le leader ${uid} a quitté la guilde ${currentGuildId}. ${newLeaderId} promu leader.`);
          } else {
            // Should not happen if memberCount > 0, but as a fallback:
            logger.error(`Inconsistency: Leader ${uid} leaving guild ${currentGuildId} with supposedly remaining members, but no one found to promote.`);
            guildUpdates.leaderId = null; // Guild becomes leaderless
            finalMessage = `Vous avez quitté la guilde "${guildData.name}" en tant que leader. La guilde est maintenant sans leader (erreur de promotion).`;
          }
        }
      }

      // Apply guild updates (member removal, count decrement, potential leader change)
      if (guildData.memberCount -1 > 0 || (guildData.leaderId === uid && newLeaderId)) { // Only update if guild not deleted
        transaction.update(guildRef, guildUpdates);
      }

      // Update the leaving user's profile
      transaction.update(userRef, {
        guildId: FieldValue.delete(),
        guildRole: FieldValue.delete(),
      });

      // If a new leader was promoted, update their user profile
      if (newLeaderProfileUpdate) {
        transaction.update(newLeaderProfileUpdate.ref, newLeaderProfileUpdate.data);
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
//                    QUEST SYSTEM FUNCTIONS
// =================================================================

export const acceptQuest = onCall({ cors: true }, async (request: functions.https.CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour accepter une quête.");
  }
  const uid = request.auth.uid;
  const { questId } = request.data;

  if (typeof questId !== "string" || questId.trim() === "") {
    throw new HttpsError("invalid-argument", "L'ID de la quête (questId) est manquant ou invalide.");
  }

  const questDefinitionRef = db.collection("questDefinitions").doc(questId);
  const playerActiveQuestRef = db.collection("playerQuests").doc(uid).collection("activeQuests").doc(questId);
  const playerCompletedQuestRef = db.collection("playerQuests").doc(uid).collection("completedQuests").doc(questId);

  try {
    const questDefDoc = await questDefinitionRef.get();
    if (!questDefDoc.exists) {
      throw new HttpsError("not-found", `La définition de la quête ${questId} n'existe pas.`);
    }

    // Vérifier si la quête est déjà active
    const activeQuestDoc = await playerActiveQuestRef.get();
    if (activeQuestDoc.exists) {
      throw new HttpsError("failed-precondition", `La quête ${questId} est déjà active.`);
    }

    // Vérifier si la quête est déjà complétée
    const completedQuestDoc = await playerCompletedQuestRef.get();
    if (completedQuestDoc.exists) {
      throw new HttpsError("failed-precondition", `La quête ${questId} a déjà été complétée.`);
    }

    // TODO: Vérifier les prérequis de la quête (niveau, autres quêtes complétées) si implémenté plus tard

    const newActiveQuestData = {
      questId: questId,
      progress: 0,
      currentStep: 0, // Supposant que les quêtes commencent à l'étape 0
      startedAt: FieldValue.serverTimestamp(),
      // On pourrait dénormaliser le titre/description ici si besoin, mais pour l'instant on les lit de questDefinitions
    };

    await playerActiveQuestRef.set(newActiveQuestData);

    logger.info(`Player ${uid} accepted quest ${questId}.`);
    return { success: true, message: `Quête ${questId} acceptée.` };
  } catch (error) {
    logger.error(`Erreur lors de l'acceptation de la quête ${questId} par ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de l'acceptation de la quête.");
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

  // Trap Check (RUNE_TRAP, DOKKAEBI_MISCHIEF, etc.)
  if (tile.trap && tile.trap.spellId) {
    const trap = tile.trap; // Convenience variable
    let trapTriggerMessage = "";
    let manaLossFromTrap = 0;

    switch (trap.spellId) {
    case "RUNE_TRAP":
      manaLossFromTrap = trap.manaAmount || SPELL_DEFINITIONS.RUNE_TRAP.effectDetails?.manaLoss || 50; // Fallback to hardcoded if not on trap object
      logger.info(`Player ${currentPlayer.uid} triggered a RUNE_TRAP on tile ${currentPlayer.position} owned by ${trap.ownerId}. Mana loss: ${manaLossFromTrap}`);
      trapTriggerMessage = `${currentPlayer.displayName} triggered a Rune Trap (owned by ${trap.ownerId || "Unknown"}) and lost ${manaLossFromTrap} Mana!`;
      break;
    case "DOKKAEBI_MISCHIEF":
      manaLossFromTrap = trap.manaAmount || SPELL_DEFINITIONS.DOKKAEBI_MISCHIEF.effectDetails?.manaLoss || 15; // Fallback
      logger.info(`Player ${currentPlayer.uid} triggered Dokkaebi's Mischief on tile ${currentPlayer.position} owned by ${trap.ownerId}. Mana loss: ${manaLossFromTrap}`);
      trapTriggerMessage = `${currentPlayer.displayName} triggered Dokkaebi's Mischief (owned by ${trap.ownerId || "Unknown"}) and lost ${manaLossFromTrap} Mana!`;
      break;
    default:
      logger.warn(`Unknown trap spellId encountered: ${trap.spellId} on tile ${currentPlayer.position}`);
      // Decide if unknown traps should still be removed or have a default effect. For now, it does nothing.
      break;
    }

    if (manaLossFromTrap > 0) {
      currentPlayer.mana = Math.max(0, currentPlayer.mana - manaLossFromTrap);
      players[currentPlayerIndex] = currentPlayer; // Update player in local array

      // Log the event for the client
      // This update can be batched with the final game state update if preferred,
      // but for immediate feedback or distinct log entries, updating here is fine.
      await gameRef.update({
        log: FieldValue.arrayUnion({
          message: trapTriggerMessage,
          timestamp: FieldValue.serverTimestamp(),
        }),
        // It's important that players array is also part of this update if mana changed,
        // or ensure the final update at the end of resolveTileAction saves it.
        // For atomicity, it's better to group related state changes.
        // However, the current structure has a final update. Let's ensure `players` is passed there.
      });
    }

    if (trapTriggerMessage) { // If any known trap was triggered and handled
      // Remove the trap from the tile
      delete board[currentPlayer.position].trap; // Modify the mutable board copy
      tileEffectApplied = true; // Trap effect takes precedence over other standard tile effects.
    }
  }

  // Standard tile type for events is usually "EVENT" as per documentation, using "event" as per existing code.
  // If "EVENT" is the correct type, this condition string needs to be changed.
  if (tile.type === "EVENT" && !tileEffectApplied) { // Changed "event" to "EVENT" based on mission brief
    tileEffectApplied = true; // Event itself is an effect
    const randomIndex = Math.floor(Math.random() * eventCards.length);
    // The `eventCards` import from `./data/eventCards` will now use the new EventCard interface.
    const selectedCard = eventCards[randomIndex]; // No need for 'as EventCard' if types are aligned.

    // Prepare the data for lastEventCard field in Firestore
    const eventCardDataForFirestore = {
      titleKey: selectedCard.titleKey,
      descriptionKey: selectedCard.descriptionKey,
      GfxUrl: selectedCard.GfxUrl,
      type: selectedCard.type, // Dénormaliser le type pour accès facile
      // Optional: include type and effectDetails if frontend needs them directly,
      // but mission only specified titleKey, descriptionKey, GfxUrl for lastEventCard.
    };

    // Apply effects based on the new card structure
    switch (selectedCard.type) {
    case "BONUS_MANA":
      if (selectedCard.effectDetails.manaAmount !== undefined) {
        currentPlayer.mana += selectedCard.effectDetails.manaAmount;
      }
      break;
    case "MALUS_MANA": // Handles mana loss for the current player
      if (selectedCard.effectDetails.manaAmount !== undefined) {
        currentPlayer.mana += selectedCard.effectDetails.manaAmount; // manaAmount is negative for loss
        if (currentPlayer.mana < 0) currentPlayer.mana = 0; // Ensure mana doesn't go below 0
      }
      break;
    case "MOVE_RELATIVE":
      if (selectedCard.effectDetails.moveAmount !== undefined) {
        const moveAmount = selectedCard.effectDetails.moveAmount;
        if (moveAmount < 0) {
          currentPlayer.position = Math.max(0, currentPlayer.position + moveAmount);
        } else {
          currentPlayer.position = (currentPlayer.position + moveAmount) % board.length;
        }
        // Note: Effect of the new tile is not resolved in this turn.
      }
      break;
    case "SKIP_TURN_SELF":
      // This effect means the current player skips their *own* next turn.
      // The existing skip logic at the end of resolveTileAction handles a player
      // starting their turn with a `skipNextTurn` flag. So, we set that flag here.
      // Ensure the player object structure can hold this, e.g., `effects.skipNextTurn` or a direct `skipNextTurn` boolean.
      // The existing function uses `player.skipNextTurn`.
      players[currentPlayerIndex].skipNextTurn = true;
      logger.info(`Player ${currentPlayer.displayName} affected by ${selectedCard.titleKey}, will skip their next turn.`);
      break;
    case "EXTRA_ROLL":
      players[currentPlayerIndex] = currentPlayer; // Save any changes to current player first
      await gameRef.update({
        players: players,
        lastEventCard: eventCardDataForFirestore, // Update with new structure
        // currentPlayerId remains the same
        turnState: "AWAITING_ROLL", // Player rolls again
      });
      // Return structure for EXTRA_ROLL might need adjustment if frontend expects specific "event" details.
      // For now, returning the selectedCard which is compliant with the new structure.
      return { success: true, effect: "EXTRA_ROLL", event: selectedCard };
    case "QUIZ_CULTUREL":
      // No mechanical game effect for now, just display the card.
      // The card display is handled by setting lastEventCard.
      logger.info(`Player ${currentPlayer.displayName} drew a cultural quiz card: ${selectedCard.titleKey}`);
      break;
    }

    players[currentPlayerIndex] = currentPlayer; // Ensure current player's state is updated in the local array
    await gameRef.update({
      lastEventCard: eventCardDataForFirestore, // Update with new structure
      players: players, // Save updated players array (mana changes, position changes, skipNextTurn flag)
      // board: board, // Already part of the final update if other changes like traps occurred
      // grimoirePositions: grimoirePositions, // Also part of final update
    });
    // Note: The final gameRef.update at the end of resolveTileAction will consolidate all changes.
    // This specific update for lastEventCard ensures it's set before any potential early return or further logic.
    // However, to maintain atomicity, it's often better to consolidate updates.
    // For now, this explicit update after event processing is fine.
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
      lastDiceRoll: null, // Requirement: Reset lastDiceRoll
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

    // Correction: Utiliser titleKey et vérifier le type de la carte directement.
    // gameData.lastEventCard maintenant contient titleKey, descriptionKey, GfxUrl.
    // La logique de SKIP_TURN_SELF est déjà gérée dans le switch plus haut, où players[currentPlayerIndex].skipNextTurn = true; est défini.
    // Ce bloc if semble être une tentative redondante ou une logique de vérification/débogage.
    // Si l'objectif est de vérifier que la carte tirée était bien une carte SKIP_TURN_SELF:
    if (gameData.lastEventCard?.titleKey) {
      const lastCardDrawn = eventCards.find((card) => card.titleKey === gameData.lastEventCard!.titleKey);
      if (lastCardDrawn && lastCardDrawn.type === "SKIP_TURN_SELF") {
        // Cette condition confirme que la dernière carte était une carte pour passer le tour.
        // L'effet (players[currentPlayerIndex].skipNextTurn = true;) a déjà été appliqué
        // lors du traitement de l'événement (switch case pour selectedCard.type === "SKIP_TURN_SELF").
        // Il n'est pas nécessaire de le réappliquer ici. On peut ajouter un log si besoin.
        logger.info(`Confirmatory check: Player ${players[currentPlayerIndex].displayName} indeed drew a SKIP_TURN_SELF card.`);
      }
    }
    // Ensure the flag is set on the current player object in the `players` array that will be saved.
    // This assumes the effect was meant for the current player's *next* turn.
    // This should be handled by the effect setting `skipNextTurn` on the player object directly.
    // players[currentPlayerIndex].skipNextTurn = true; // Cette ligne était suivie d'une accolade en trop
  } // Fin du if (tile.type === "event")

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
    lastDiceRoll: null, // Requirement: Reset lastDiceRoll
  });
  return { success: true };
});

// =================================================================
//                    HANGEUL TYPHOON FUNCTIONS
// =================================================================

// Logique interne de sendTyphoonAttack, exportée pour les tests

/**
 * Handles the logic for processing a Typhoon attack in the Hangeul Typhoon mini-game.
 * @param {SendTyphoonAttackRequest} requestData - The data for the attack request.
 * @param {{ uid: string }} authContext - The authentication context, simulating request.auth for tests.
 * @return {Promise<SendTyphoonAttackResponse>} The response indicating the result of the attack.
 */
export async function sendTyphoonAttackLogic(
  requestData: SendTyphoonAttackRequest,
  authContext: { uid: string } // Simule request.auth pour les tests
): Promise<SendTyphoonAttackResponse> {
  logger.info("sendTyphoonAttackLogic called with data:", requestData);
  logger.info("Authenticated user for logic:", authContext.uid);

  // Top-level variables for catch block logging, if needed before they are assigned in try.
  const gameIdForCatch: string | undefined = requestData.gameId;
  const attackerPlayerIdForCatch: string | undefined = requestData.attackerPlayerId;

  try {
    // 1. UID Extraction (Utilise authContext.uid)
    const uid = authContext.uid;
    logger.info(`User ${uid} authenticated for logic execution.`);

    // 2. Extract Request Data (directement depuis requestData)
    const { gameId, attackerPlayerId, targetPlayerId, attackWord } = requestData;
    // Update context for catch block (already done with requestData)

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
    const gameData = gameDoc.data() as Game;
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
      logger.error(`Attacker player ${attackerPlayerId} object not found in game ${gameId}.`);
      throw new HttpsError("internal", `Attacker ${attackerPlayerId} data is inconsistent.`);
    }
    if (!targetPlayer) {
      logger.error(`Target player ${targetPlayerId} object not found in game ${gameId}.`);
      throw new HttpsError("internal", `Target ${targetPlayerId} data is inconsistent.`);
    }
    if (targetPlayer.blocks === undefined || targetPlayer.blocks === null) {
      logger.error(`Target player ${targetPlayerId} blocks array is undefined or null.`);
      throw new HttpsError("internal", `Target player ${targetPlayerId} blocks data is missing.`);
    }
    logger.info(`Attacker ${attackerPlayerId} data: groundHeight ${attackerPlayer.groundHeight}`);
    logger.info(`Target ${targetPlayerId} data: ${targetPlayer.blocks.length} blocks, groundHeight ${targetPlayer.groundHeight}`);

    if (attackerPlayerId === targetPlayerId) {
      logger.error("Attacker and target cannot be the same player.");
      throw new HttpsError("invalid-argument", "Attacker and target cannot be the same player.");
    }
    logger.info(`Attacker ${attackerPlayerId} and Target ${targetPlayerId} game states retrieved.`);

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
      logger.info(`No active block found for word "${attackWord}" for target ${targetPlayerId}.`);
      failureReason = "WORD_NOT_FOUND_OR_DESTROYED";
      isAttackSuccessful = false;
    } else {
      if (targetBlock.vulnerableAt.toMillis() <= currentTime.toMillis()) {
        logger.info(`Block "${targetBlock.text}" for target ${targetPlayerId} is vulnerable.`);
        isAttackSuccessful = true;
      } else {
        logger.info(`Block "${targetBlock.text}" for target ${targetPlayerId} is not vulnerable.`);
        failureReason = "BLOCK_NOT_VULNERABLE";
        isAttackSuccessful = false;
      }
    }

    if (isAttackSuccessful) {
      if (!targetBlock || blockIndex === -1) { // Should not happen if isAttackSuccessful is true
        logger.error("Critical error: targetBlock or blockIndex is invalid in successful attack path.");
        throw new HttpsError("internal", "Inconsistent state in successful attack.");
      }
      logger.info(`Processing successful attack on block: ${targetBlock.id} for target ${targetPlayer.uid}`);
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
      logger.info(`Firestore updated for successful attack. Target: ${targetPlayer.uid}`);
      return {
        status: "success",
        message: "Attack successful. Target's block destroyed.",
        attackerPlayerId: attackerPlayerId,
        targetPlayerId: targetPlayer.uid,
        destroyedBlockWord: destroyedBlockWord,
        targetGroundRiseAmount: targetGroundRiseAmount,
      } as SendTyphoonAttackSuccessResponse;
    } else {
      const attackerPenaltyGroundRiseAmount = DEFAULT_PENALTY_RISE_AMOUNT;
      const newAttackerGroundHeight = (attackerPlayer.groundHeight || 0) + attackerPenaltyGroundRiseAmount;
      logger.info(`Processing failed attack for ${attackerPlayer.uid}. Reason: ${failureReason}. Penalty: ${attackerPenaltyGroundRiseAmount}.`);
      const updatedPlayers = gameData.players.map((p) => {
        if (p.uid === attackerPlayer.uid) {
          return { ...p, groundHeight: newAttackerGroundHeight };
        }
        return p;
      });
      await gameRef.update({ players: updatedPlayers });
      logger.info(`Firestore updated for failed attack. Attacker: ${attackerPlayer.uid} penalized.`);
      return {
        status: "failure",
        reason: failureReason || "UNKNOWN_FAILURE",
        message: "Attack failed. Attacker penalized.",
        attackerPlayerId: attackerPlayerId,
        attackerPenaltyGroundRiseAmount: attackerPenaltyGroundRiseAmount,
      } as SendTyphoonAttackFailureResponse;
    }
  } catch (error) {
    logger.error(`Unhandled error in sendTyphoonAttackLogic for game: ${gameIdForCatch}, attacker: ${attackerPlayerIdForCatch}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    throw new HttpsError("internal", "Internal error processing attack.", { details: errorMessage });
  }
}

export const sendTyphoonAttack = onCall<SendTyphoonAttackRequest>(
  { cors: true },
  async (request): Promise<SendTyphoonAttackResponse> => {
    if (!request.auth) {
      logger.error("Unauthenticated onCall to sendTyphoonAttack");
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    // Appelle la logique interne avec les données et le contexte d'authentification
    return sendTyphoonAttackLogic(request.data, { uid: request.auth.uid });
  }
);

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


  const players = [...gameData.players]; // Make a mutable copy
  const caster = { ...players[casterIndex] }; // Make a mutable copy of the caster

  if (caster.mana < spell.manaCost) {
    throw new HttpsError("failed-precondition", "Mana insuffisant.");
  }

  // --- Spell Immunity Check (for offensive spells targeting another player) ---
  // This check should happen BEFORE mana is deducted if the spell is blocked.
  // Let's assume KIMCHIS_MALICE is the primary negative spell for now.
  // Other spells might be added to this check if they are also considered "negative".
  if (spell.id === "KIMCHIS_MALICE" && targetIndex !== -1 && targetIndex !== casterIndex) {
    const targetPlayer = { ...players[targetIndex] }; // Mutable copy of target
    const immunityEffectIndex = (targetPlayer.effects || []).findIndex(
      (eff: { type: string; duration: number; spellId?: string }) => eff.type === "SHIELDED" || eff.type === "IMMUNE_TO_NEXT_SPELL"
    );

    if (immunityEffectIndex > -1) {
      const immunityEffect = targetPlayer.effects[immunityEffectIndex];
      logger.info(`Spell ${spell.id} blocked by ${immunityEffect.spellId} on player ${targetPlayer.uid}.`);

      // Consume the immunity effect
      targetPlayer.effects.splice(immunityEffectIndex, 1);
      if (targetPlayer.effects.length === 0) {
        delete targetPlayer.effects; // Clean up if no effects left
      }
      players[targetIndex] = targetPlayer; // Update target player in the main array

      // Still deduct mana from caster for the attempt
      caster.mana -= spell.manaCost;
      players[casterIndex] = caster; // Update caster in the main array

      // Increment spellsCast stat for the caster
      const casterStatsRef = db.collection("users").doc(uid);
      await casterStatsRef.update({
        "stats.spellsCast": admin.firestore.FieldValue.increment(1),
      }).catch((error) => {
        logger.error(`Erreur lors de la mise à jour de stats.spellsCast pour ${uid} (spell blocked):`, error);
      });
      // No achievement check here as the core spell effect didn't land. Or maybe it should? For now, keeping it simple.

      await gameRef.update({
        players: players,
        log: FieldValue.arrayUnion({ // Add a log message
          message: `${caster.displayName} cast ${spell.name} on ${targetPlayer.displayName}, but it was blocked by ${immunityEffect.spellId}!`,
          timestamp: FieldValue.serverTimestamp(),
        }),
        lastSpellCast: { spellId, casterId: uid, targetId: targetId, options, blocked: true },
      });
      return { success: true, effectBlocked: true, blockerSpellId: immunityEffect.spellId };
    }
  }
  // --- End Spell Immunity Check ---

  caster.mana -= spell.manaCost;
  players[casterIndex] = caster; // Update caster's mana in the main array

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
    // Validation uid === targetId is already done by general checks if spell.requiresTarget === 'player' and not self-targetable.
    // const casterPlayer = players[casterIndex]; // Already have `caster`
    const targetPlayer = players[targetIndex];

    const casterPosition = players[casterIndex].position; // Use players[casterIndex] as `caster` is a copy for mana deduction.
    const targetPosition = targetPlayer.position;

    players[casterIndex].position = targetPosition;
    players[targetIndex].position = casterPosition;
    logger.info(`Astral Swap: ${players[casterIndex].displayName} (${casterPosition}) swapped with ${targetPlayer.displayName} (${targetPosition})`);
    break;
  }
  case "MEMORY_FOG": {
    // Caster is players[casterIndex]
    const currentCasterEffects = players[casterIndex].effects || [];
    // Prevent stacking if already immune via MEMORY_FOG or MANA_SHIELD
    const existingImmunity = currentCasterEffects.find(
      (eff: { type: string; duration: number; spellId?: string }) => eff.type === "IMMUNE_TO_NEXT_SPELL" || eff.type === "SHIELDED"
    );
    if (!existingImmunity) {
      players[casterIndex].effects = [
        ...currentCasterEffects,
        { type: "IMMUNE_TO_NEXT_SPELL", duration: 1, spellId: spell.id },
      ];
      logger.info(`Player ${players[casterIndex].displayName} cast Memory Fog.`);
    } else {
      // Optionally, refresh duration if re-cast? For now, no stacking if any immunity exists.
      logger.info(`Player ${players[casterIndex].displayName} tried to cast Memory Fog but already has an immunity effect.`);
      // Potentially throw an error or return a specific status if stacking isn't allowed and mana shouldn't be consumed.
      // For now, mana is consumed, but effect is not re-applied if one exists.
    }
    break;
  }
  case "KARMIC_SWAP": {
    if (targetIndex === -1 || targetIndex === casterIndex) { // Ensure target is valid and not self
      throw new HttpsError("invalid-argument", "Valid target player required for Karmic Swap and cannot target self.");
    }
    const casterCurrentPosition = players[casterIndex].position;
    const targetCurrentPosition = players[targetIndex].position;

    players[casterIndex].position = targetCurrentPosition;
    players[targetIndex].position = casterCurrentPosition;
    logger.info(`Karmic Swap: ${players[casterIndex].displayName} (was at ${casterCurrentPosition}) swapped with ${players[targetIndex].displayName} (was at ${targetCurrentPosition})`);
    break;
  }
  case "DOKKAEBI_MISCHIEF": {
    if (typeof options?.tileIndex !== "number" || options.tileIndex < 0 || options.tileIndex >= gameData.board.length) {
      throw new HttpsError("invalid-argument", "Valid tileIndex is required in options for Dokkaebi's Mischief.");
    }
    if (gameData.board[options.tileIndex].trap) {
      throw new HttpsError("failed-precondition", "This tile already has a trap.");
    }

    const boardCopy = [...gameData.board];
    boardCopy[options.tileIndex] = {
      ...boardCopy[options.tileIndex],
      trap: {
        ownerId: uid,
        spellId: spell.id,
        effectType: "MANA_LOSS", // As per spell definition
        manaAmount: spell.effectDetails?.manaLoss || 15, // Get from definition, fallback
      },
    };
    logger.info(`Player ${players[casterIndex].displayName} placed Dokkaebi's Mischief on tile ${options.tileIndex}.`);
    // Update board specifically for trap spells, then players and lastSpellCast in the final update
    await gameRef.update({
      board: boardCopy,
      players: players, // Also save player mana update
      lastSpellCast: { spellId, casterId: uid, targetId, options },
    });
    return { success: true, message: "Dokkaebi's Mischief placed." }; // Return early as board is updated
  }
  }

  // Ensure players array reflects changes to caster from mana deduction and potential effects
  // players[casterIndex] = caster; // This was done before the switch for mana, re-ensure for effects if caster object was modified directly.

  await gameRef.update({
    players: players, // This will save caster's reduced mana, and any effects applied to caster/target positions
    lastSpellCast: { spellId, casterId: uid, targetId: targetId, options, blocked: false }, // Ensure 'blocked' is part of the data
  });
  return { success: true };
});


interface UserDoc {
  moonShards: number;
  ownedCosmetics: string[];
  // ... autres champs potentiels de l'utilisateur
}

interface ShopItemDoc {
  name: string;
  category: string;
  price: number;
  imageUrl: string;
  description: string;
  // ... autres champs potentiels de l'article
}

export const purchaseShopItem = functions.https.onCall(async (request) => {
  // 1. Valider que l'utilisateur est authentifié.
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour effectuer un achat."
    );
  }

  const userId = request.auth.uid;
  const { itemId } = request.data;

  if (!itemId || typeof itemId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "L'itemId est requis et doit être une chaîne de caractères."
    );
  }

  const userRef = db.collection("users").doc(userId);
  const itemRef = db.collection("shopItemDefinitions").doc(itemId);

  let itemName = "l'article"; // Valeur par défaut au cas où

  try {
    // 2. Exécuter une transaction atomique
    await db.runTransaction(async (transaction) => {
      const userDocSnapshot = await transaction.get(userRef);
      const itemDocSnapshot = await transaction.get(itemRef);

      if (!userDocSnapshot.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "Document utilisateur non trouvé."
        );
      }

      if (!itemDocSnapshot.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          `Article avec l'ID '${itemId}' non trouvé dans shopItemDefinitions.`
        );
      }

      const userData = userDocSnapshot.data() as UserDoc;
      const itemData = itemDocSnapshot.data() as ShopItemDoc;
      itemName = itemData.name; // Assigner le nom de l'article ici

      // Initialiser les champs si absents (robuste)
      const currentMoonShards = userData.moonShards || 0;
      const currentOwnedCosmetics = userData.ownedCosmetics || [];

      // 3. Vérifier si l'utilisateur a assez d'moonShards.
      if (currentMoonShards < itemData.price) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Solde de MoonShards insuffisant pour cet achat."
        );
      }

      // 4. Vérifier si l'utilisateur ne possède pas déjà l'article.
      if (currentOwnedCosmetics.includes(itemId)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Vous possédez déjà cet article."
        );
      }

      // Mettre à jour les données de l'utilisateur
      const newMoonShards = currentMoonShards - itemData.price;
      const newOwnedCosmetics = [...currentOwnedCosmetics, itemId];

      transaction.update(userRef, {
        moonShards: newMoonShards,
        ownedCosmetics: newOwnedCosmetics,
      });
    });

    // 5. Retourner une réponse de succès.
    return {
      success: true,
      message: `Achat de '${itemName}' réussi ! Vos MoonShards ont été mis à jour.`,
    };
  } catch (error) {
    // Journaliser l'erreur côté serveur pour le débogage
    console.error("Erreur lors de l'achat de l'article:", error);

    // Renvoyer l'erreur au client
    // Si c'est déjà une HttpsError, elle sera renvoyée telle quelle.
    // Sinon, encapsuler dans une HttpsError générique.
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue lors du traitement de votre achat."
    );
  }
});

// [DUPLICATE FUNCTIONS REMOVED]
// The definitions for leaveGuild, joinGuild, and createGuild using functions.https.onCall (v1 style)
// that were previously here have been removed to favor the v2 versions defined earlier in the file.

// =================================================================
//                    FORGE DES SORTS (SRS FUNCTIONS)
// =================================================================

/**
 * Retrieves a list of spell mastery items due for review for the authenticated user.
 */
export const getReviewItems = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Vous devez être connecté pour récupérer les runes à réviser.");
  }
  const uid = request.auth.uid;
  const now = admin.firestore.Timestamp.now();

  try {
    const spellMasterySnapshot = await db.collection("users").doc(uid).collection("spellMastery")
      .where("nextReviewDate", "<=", now)
      .orderBy("nextReviewDate") // Optional: review older items first
      .limit(REVIEW_ITEMS_LIMIT)
      .get();

    if (spellMasterySnapshot.empty) {
      return { items: [] };
    }

    const reviewItems = spellMasterySnapshot.docs.map((doc) => {
      const data = doc.data() as SpellMasteryItem;
      // Return only necessary fields for the frontend to conduct the review session
      return {
        id: doc.id,
        word: data.word,
        translation: data.translation,
        // Include other fields if the frontend needs them, e.g.:
        // romanization: data.romanization,
        // audioUrl: data.audioUrl,
        // masteryLevel: data.masteryLevel, // Could be useful for display
      };
    });

    return { items: reviewItems };
  } catch (error) {
    logger.error(`Erreur lors de la récupération des runes à réviser pour l'utilisateur ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Une erreur interne est survenue lors de la récupération des runes à réviser.");
  }
});


// Potentiellement d'autres fonctions ici...
// export const anotherFunction = functions.https.onRequest(...)

// =================================================================
//                    MINI-GAME CONTENT SELECTION
// =================================================================

export const prepareMiniGameChallenge = onCall<PrepareMiniGameChallengeRequest>(
  { cors: true }, // Assuming CORS is needed, adjust as necessary
  async (request): Promise<MiniGameChallenge> => {
    logger.info("prepareMiniGameChallenge called with data:", request.data);
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required to prepare a mini-game challenge.");
    }

    const { gameId, miniGameType, difficulty } = request.data;

    // Basic input validation
    if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
      throw new HttpsError("invalid-argument", "Missing or invalid gameId.");
    }
    if (!miniGameType || typeof miniGameType !== "string" || miniGameType.trim() === "") {
      throw new HttpsError("invalid-argument", "Missing or invalid miniGameType.");
    }
    const validDifficulties = ["très facile", "moyen", "difficile", "extrême"];
    if (!difficulty || !validDifficulties.includes(difficulty)) {
      throw new HttpsError("invalid-argument", `Invalid difficulty. Must be one of: ${validDifficulties.join(", ")}.`);
    }

    const uid = request.auth.uid; // The user requesting this, might not be the current player if called by a game host/server logic
    logger.info(`Request by user ${uid} for game ${gameId}, type ${miniGameType}, difficulty ${difficulty}.`);

    let gameDoc;
    let gameData: Game;
    let currentPlayerId: string;
    let userProfileData: UserProfileWithCEFR | undefined;
    const playerSpellMastery = new Map<string, SpellMasteryItemWithCEFR>();

    try {
      // 1. Fetch game data to find current player ID.
      gameDoc = await db.collection("games").doc(gameId).get();
      if (!gameDoc.exists) {
        logger.error(`Game document ${gameId} not found.`);
        throw new HttpsError("not-found", `Game ${gameId} not found.`);
      }
      gameData = gameDoc.data() as Game;
      currentPlayerId = gameData.currentPlayerId || gameData.players[0]?.uid; // Fallback to first player if currentPlayerId is not set

      if (!currentPlayerId) {
        logger.error(`Could not determine currentPlayerId for game ${gameId}.`);
        throw new HttpsError("internal", "Could not determine the current player for the game.");
      }
      logger.info(`Current player ID for game ${gameId} is ${currentPlayerId}.`);

      // 2. Fetch current player's learning profile (spellMasteryStatus) & global CEFR level (users/{playerId}).
      const userProfileDoc = await db.collection("users").doc(currentPlayerId).get();
      if (!userProfileDoc.exists) {
        logger.warn(`User profile ${currentPlayerId} not found. Proceeding without CEFR level or specific user data.`);
        // Not throwing an error, as some basic challenges might still be possible without it.
        // The selection algorithm will need to handle this case.
      } else {
        userProfileData = userProfileDoc.data() as UserProfileWithCEFR;
        logger.info(`User profile for ${currentPlayerId} fetched. CEFR level: ${userProfileData.playerCefrLevel || "not set"}`);
      }

      const spellMasterySnapshot = await db
        .collection("playerLearningProfiles")
        .doc(currentPlayerId)
        .collection("spellMasteryStatus")
        .get();

      if (spellMasterySnapshot.empty) {
        logger.info(`No spell mastery items found for player ${currentPlayerId}.`);
      } else {
        spellMasterySnapshot.forEach((doc) => {
          // Assuming doc.id is the contentId (e.g., the Hangeul word itself or a unique ID)
          playerSpellMastery.set(doc.id, doc.data() as SpellMasteryItemWithCEFR);
        });
        logger.info(`Fetched ${playerSpellMastery.size} spell mastery items for player ${currentPlayerId}.`);
      }
    } catch (error) {
      logger.error("Error fetching game or player data:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to fetch necessary game or player data.", error);
    }

    // 3. Fetch content items for the miniGameType
    let contentCollectionName: string;
    switch (miniGameType) {
    case "festinDesMots": // Assuming "Festin des Mots" uses this key
      contentCollectionName = "foodItemDefinitions";
      break;
    case "syllablePuzzle":
      contentCollectionName = "syllablePuzzles";
      break;
    // Add more cases for other miniGameTypes and their corresponding collection names
    // case "colorChaos":
    //   contentCollectionName = "colorChaosDefinitions"; // Example
    //   break;
    default:
      logger.error(`Unknown miniGameType: ${miniGameType}`);
      throw new HttpsError("invalid-argument", `Unsupported miniGameType: ${miniGameType}.`);
    }

    const allContentItems: ContentItem[] = [];
    try {
      const contentSnapshot = await db.collection(contentCollectionName).get();
      if (contentSnapshot.empty) {
        logger.error(`No content items found in collection ${contentCollectionName} for miniGameType ${miniGameType}.`);
        throw new HttpsError("not-found", `No content found for ${miniGameType}.`);
      }
      contentSnapshot.forEach((doc) => {
        // Assuming content items have an 'id' field or we use doc.id
        // And that their structure matches ContentItem interface (especially hangeul, french_name, and assumed cefrLevel)
        allContentItems.push({ id: doc.id, ...doc.data() } as ContentItem);
      });
      logger.info(`Fetched ${allContentItems.length} content items from ${contentCollectionName} for ${miniGameType}.`);
    } catch (error) {
      logger.error(`Error fetching content items from ${contentCollectionName}:`, error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `Failed to fetch content for ${miniGameType}.`, error);
    }

    // TODO: Implement the core logic:
    // 4. Apply selection algorithm based on difficulty.

    interface CategorizedContent {
      mastery1: ContentItem[];
      mastery2: ContentItem[];
      mastery3: ContentItem[];
      mastery4: ContentItem[];
      newItems: ContentItem[]; // All new items, regardless of CEFR
      newItemsByCEFR: Map<string, ContentItem[]>; // New items, grouped by CEFR
      allItemsByCEFR: Map<string, ContentItem[]>; // All items (new or learned), grouped by CEFR
    }

    const categorizedContent: CategorizedContent = {
      mastery1: [],
      mastery2: [],
      mastery3: [],
      mastery4: [],
      newItems: [],
      newItemsByCEFR: new Map(),
      allItemsByCEFR: new Map(),
    };

    const playerGlobalCEFR = userProfileData?.playerCefrLevel;
    logger.info(`Player's global CEFR level for ${currentPlayerId}: ${playerGlobalCEFR || "Not set (will affect 'moyen', 'difficile', 'extrême' accuracy)"}`);

    let itemsMissingCEFRData = 0;
    allContentItems.forEach((item) => {
      if (!item.cefrLevel) {
        itemsMissingCEFRData++;
      }
      const masteryInfo = playerSpellMastery.get(item.id!); // item.id is the key from content collection doc ID
      const itemCEFR = item.cefrLevel || "unknown";

      if (!categorizedContent.allItemsByCEFR.has(itemCEFR)) {
        categorizedContent.allItemsByCEFR.set(itemCEFR, []);
      }
      categorizedContent.allItemsByCEFR.get(itemCEFR)!.push(item);

      if (masteryInfo) {
        // Item is in player's learning profile
        switch (masteryInfo.masteryLevel) {
        case 1: categorizedContent.mastery1.push(item); break;
        case 2: categorizedContent.mastery2.push(item); break;
        case 3: categorizedContent.mastery3.push(item); break;
        case 4: categorizedContent.mastery4.push(item); break;
        default: // Includes masteryLevel 0 or other unexpected values
          // Treat as 'new' for selection if mastery is 0 or not 1-4
          categorizedContent.newItems.push(item);
          if (!categorizedContent.newItemsByCEFR.has(itemCEFR)) {
            categorizedContent.newItemsByCEFR.set(itemCEFR, []);
          }
          categorizedContent.newItemsByCEFR.get(itemCEFR)!.push(item);
          break;
        }
      } else {
        // Item is not in player's learning profile, hence it's "new"
        categorizedContent.newItems.push(item);
        if (!categorizedContent.newItemsByCEFR.has(itemCEFR)) {
          categorizedContent.newItemsByCEFR.set(itemCEFR, []);
        }
        categorizedContent.newItemsByCEFR.get(itemCEFR)!.push(item);
      }
    });

    logger.info(`Categorized content for player ${currentPlayerId}: M1(${categorizedContent.mastery1.length}), M2(${categorizedContent.mastery2.length}), M3(${categorizedContent.mastery3.length}), M4(${categorizedContent.mastery4.length}), New(${categorizedContent.newItems.length})`);
    categorizedContent.newItemsByCEFR.forEach((items, cefr) => logger.info(`  New items for CEFR ${cefr}: ${items.length}`));
    categorizedContent.allItemsByCEFR.forEach((items, cefr) => logger.info(`  All items for CEFR ${cefr}: ${items.length}`));

    if (itemsMissingCEFRData > 0) {
      logger.warn(`${itemsMissingCEFRData}/${allContentItems.length} content items are missing CEFR level data. This will impact CEFR-based difficulty scaling for 'moyen', 'difficile', 'extrême'. Items without CEFR will be grouped under 'unknown' CEFR level.`);
    }
    if (!playerGlobalCEFR && (difficulty === "moyen" || difficulty === "difficile" || difficulty === "extrême")) {
      logger.warn(`Player ${currentPlayerId} is missing a global CEFR level. Difficulty settings 'moyen', 'difficile', and 'extrême' will rely on fallbacks and may not be optimally targeted.`);
    }

    // Helper function to get a CEFR level higher than the player's
    const getHigherCEFR = (currentCEFR: string | undefined): string | undefined => {
      if (!currentCEFR) return undefined; // Cannot determine higher if current is unknown
      const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
      const currentIndex = levels.indexOf(currentCEFR.toUpperCase());
      if (currentIndex === -1 || currentIndex === levels.length - 1) return undefined; // Unknown or already highest
      return levels[currentIndex + 1];
    };

    // Helper function to get a CEFR level lower than the player's
    const getLowerCEFR = (currentCEFR: string | undefined): string | undefined => {
      if (!currentCEFR) return undefined;
      const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
      const currentIndex = levels.indexOf(currentCEFR.toUpperCase());
      if (currentIndex === -1 || currentIndex === 0) return undefined; // Unknown or already lowest
      return levels[currentIndex - 1];
    };


    // This is a simplified selection. We need one target item.
    let targetItem: ContentItem | undefined = undefined;
    // This set will keep track of items already picked for the current challenge (target + distractors)
    const pickedItemIdsForChallenge = new Set<string>();

    // Simplified item selection logic - picks ONE item for now
    // More sophisticated logic will pick based on quotas and fallbacks
    const pickRandomItem = (items: ContentItem[]): ContentItem | undefined => {
      if (items.length === 0) return undefined;
      const availableItems = items.filter((item) => !pickedItemIdsForChallenge.has(item.id!));
      if (availableItems.length === 0) return undefined;
      const randomIndex = Math.floor(Math.random() * availableItems.length);
      const picked = availableItems[randomIndex];
      pickedItemIdsForChallenge.add(picked.id!);
      return picked;
    };

    // Function to pick one item based on prioritized lists
    const pickOneFromPrioritizedLists = (lists: ContentItem[][]): ContentItem | undefined => {
      for (const list of lists) {
        const item = pickRandomItem(list);
        if (item) return item;
      }
      return undefined;
    };

    switch (difficulty) {
    case "très facile":
      // Majoritairement M1, M2. Fill with M3, M4, then New (player's CEFR), then any New.
      targetItem = pickOneFromPrioritizedLists([
        categorizedContent.mastery1,
        categorizedContent.mastery2,
        categorizedContent.mastery3,
        categorizedContent.mastery4,
        playerGlobalCEFR ? categorizedContent.newItemsByCEFR.get(playerGlobalCEFR) || [] : [],
        categorizedContent.newItems, // Any new item if CEFR specific new items are not found
        playerGlobalCEFR ? categorizedContent.allItemsByCEFR.get(playerGlobalCEFR) || [] : [], // Fallback to any item of player's CEFR
      ]);
      break;
    case "moyen":
      // Ciblez M3, M4. Introduisez 20-30% de nouveaux mots (player's CEFR).
      // For simplicity, let's say 1 out of 1 target item could be new.
      // This needs a more complex picker that manages proportions if we were picking multiple items.
      // For one item, we can use a probability or alternate.
      if (Math.random() < 0.30 && playerGlobalCEFR && (categorizedContent.newItemsByCEFR.get(playerGlobalCEFR) || []).length > 0) {
        targetItem = pickRandomItem(categorizedContent.newItemsByCEFR.get(playerGlobalCEFR)!);
      }
      if (!targetItem) {
        targetItem = pickOneFromPrioritizedLists([
          categorizedContent.mastery3,
          categorizedContent.mastery4,
          categorizedContent.mastery2, // Fallback
          categorizedContent.mastery1, // Fallback
        ]);
      }
      // If still no item, try new items of player's CEFR again, then any new.
      if (!targetItem && playerGlobalCEFR) {
        targetItem = pickRandomItem(categorizedContent.newItemsByCEFR.get(playerGlobalCEFR) || []);
      }
      if (!targetItem) {
        targetItem = pickRandomItem(categorizedContent.newItems);
      }
      break;
    case "difficile":
      // Majorité de nouveaux mots pertinents (player's CEFR). Fill with M4, M3.
      // For one item, prioritize new words of player's CEFR.
      if (playerGlobalCEFR) {
        targetItem = pickRandomItem(categorizedContent.newItemsByCEFR.get(playerGlobalCEFR) || []);
      }
      if (!targetItem) { // Fallback if no new words for player's CEFR
        targetItem = pickOneFromPrioritizedLists([
          categorizedContent.mastery4,
          categorizedContent.mastery3,
          categorizedContent.newItems, // Any new item
        ]);
      }
      break;
    case "extrême":
      // Nouveaux mots complexes ou d'un niveau CEFR supérieur.
      const higherCEFR = getHigherCEFR(playerGlobalCEFR);
      if (higherCEFR) {
        targetItem = pickRandomItem(categorizedContent.newItemsByCEFR.get(higherCEFR) || []);
      }
      if (!targetItem && playerGlobalCEFR) { // Fallback to complex (new) words of current CEFR
        targetItem = pickRandomItem(categorizedContent.newItemsByCEFR.get(playerGlobalCEFR) || []);
      }
      if (!targetItem) { // Fallback to any new word
        targetItem = pickRandomItem(categorizedContent.newItems);
      }
      if (!targetItem) { // Furthest fallback: highest mastery items
        targetItem = pickOneFromPrioritizedLists([
          categorizedContent.mastery4,
          categorizedContent.mastery3,
        ]);
      }
      break;
    }

    if (!targetItem) {
      // Fallback: if no item could be selected based on difficulty logic, pick any random item from all content.
      logger.warn(`No target item found for difficulty ${difficulty} with preferred logic. Picking any random available item.`);
      const allAvailableContent = allContentItems.filter(item => !pickedItemIdsForChallenge.has(item.id!));
      if (allAvailableContent.length > 0) {
        targetItem = pickRandomItem(allAvailableContent);
      } else {
         // This case means all items might have been picked (e.g. if content set is very small)
        logger.error("No available content items left to pick for the target item, even after fallback.");
        throw new HttpsError("internal", `Insufficient content to generate a challenge for difficulty ${difficulty}. All items may have been picked or content is empty.`);
      }
    }

    if (!targetItem) { // Final check, should ideally not be reached if previous fallback worked.
        logger.error(`CRITICAL: Still no targetItem selected even after broadest fallback for difficulty ${difficulty}. Content set might be too small or empty.`);
        throw new HttpsError("internal", `Could not select a target item for the challenge. Content set might be empty or too small.`);
    }


    // 5. Assemble challenge object (question, correctAnswer, distractors).

    // Ensure targetItem has been selected
    if (!targetItem) {
      // This should have been caught earlier, but as a safeguard:
      logger.error("CRITICAL: targetItem is undefined at the start of Assemble Challenge Object step.");
      throw new HttpsError("internal", "Failed to select a target item for the challenge.");
    }

    const correctAnswerValue = targetItem.hangeul || targetItem.word || "Unknown Answer"; // Adapt based on content type
    let questionTextValue: string | undefined = undefined;
    let questionImageUrlValue: string | undefined = undefined;
    let questionAudioUrlValue: string | undefined = undefined;
    let challengeTypeValue: string;

    // Determine question type and details based on miniGameType
    // This is a simplified example; more sophisticated logic might be needed
    switch (miniGameType) {
    case "festinDesMots":
      challengeTypeValue = "VOCAB_FR_TO_KO"; // Default for festinDesMots
      questionTextValue = `Traduisez : "${targetItem.french_name}"`;
      if (targetItem.imageUrl) { // Potentially offer image questions too
        // Add logic to sometimes use image as question
        // challengeTypeValue = "VOCAB_IMG_TO_KO";
        // questionTextValue = "Quel est cet aliment ?";
        questionImageUrlValue = targetItem.imageUrl;
      }
      if (targetItem.audioUrl) {
        questionAudioUrlValue = targetItem.audioUrl; // Can be provided alongside text/image
      }
      break;
    case "syllablePuzzle":
      challengeTypeValue = "SYLLABLE_CONSTRUCTION";
      // For syllable puzzles, the 'question' might be implied by the available syllables client-side.
      // The 'correctAnswer' would be the full word.
      // `targetItem` for syllablePuzzle might have `hangeul` (full word) and perhaps `syllables` (array of syllables).
      questionTextValue = `Formez le mot : ${targetItem.hangeul}`; // Or provide syllables if structured that way
      break;
    // Add cases for other miniGameTypes like "colorChaos"
    // case "colorChaos":
    //   challengeTypeValue = "COLOR_WORD_STROOP";
    //   questionTextValue = targetItem.word; // e.g., "ROUGE" displayed in green
    //   // The client would use targetItem.colorHex to display the text in that color.
    //   // correctAnswerValue would be targetItem.correctColorName (e.g., "Vert")
    //   break;
    default:
      logger.warn(`No specific question/challenge type logic for miniGameType: ${miniGameType}. Using generic setup.`);
      challengeTypeValue = "GENERIC_CHALLENGE";
      questionTextValue = targetItem.french_name || `Identifier : ${targetItem.hangeul || targetItem.word}`;
      questionImageUrlValue = targetItem.imageUrl;
      questionAudioUrlValue = targetItem.audioUrl;
      break;
    }

    // Select 3 distractors
    const distractors: string[] = [];
    const potentialDistractorItems = allContentItems.filter(
      (item) => item.id !== targetItem!.id && (item.hangeul || item.word) // Ensure item has a usable value for distractor
    );

    // Shuffle potential distractors to get variety
    for (let i = potentialDistractorItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [potentialDistractorItems[i], potentialDistractorItems[j]] = [potentialDistractorItems[j], potentialDistractorItems[i]];
    }

    for (const distractorItem of potentialDistractorItems) {
      if (distractors.length >= 3) break;
      // Ensure the distractor value is not the same as the correct answer, and not already picked
      const distractorValue = distractorItem.hangeul || distractorItem.word!;
      if (distractorValue !== correctAnswerValue && !pickedItemIdsForChallenge.has(distractorItem.id!)) {
        distractors.push(distractorValue);
        pickedItemIdsForChallenge.add(distractorItem.id!); // Mark as used for this challenge session
      }
    }

    // If not enough unique distractors found, fill with generic or common incorrect options if available,
    // or log a warning. For simplicity, this example might have fewer than 3 if content is sparse.
    if (distractors.length < 3) {
      logger.warn(`Could only find ${distractors.length} distractors for target ${correctAnswerValue}. MiniGameType: ${miniGameType}. Total content items: ${allContentItems.length}`);
      // Fill with placeholders if absolutely necessary, though ideally content should be rich enough.
      const neededPlaceholders = 3 - distractors.length;
      for (let i = 0; i < neededPlaceholders; i++) {
        distractors.push(`Distracteur ${i + 1}`); // Very basic placeholder
      }
    }

    const challenge: MiniGameChallenge = {
      questionText: questionTextValue,
      questionImageUrl: questionImageUrlValue,
      questionAudioUrl: questionAudioUrlValue,
      correctAnswer: correctAnswerValue,
      distractors: distractors,
      challengeType: challengeTypeValue,
      answerDetails: { // Store details of the target item
        hangeul: targetItem.hangeul,
        french_name: targetItem.french_name,
        category: targetItem.category,
        cefrLevel: targetItem.cefrLevel, // Assumed
        imageUrl: targetItem.imageUrl,
        audioUrl: targetItem.audioUrl,
        // Copy other relevant fields from targetItem if needed for UI or scoring
      },
    };

    logger.info("Challenge object assembled:", challenge);

    // 6. Update game document (games/{gameId}) with currentChallengeData.
    try {
      await db.collection("games").doc(gameId).update({
        currentChallengeData: challenge,
        lastChallengePreparedAt: FieldValue.serverTimestamp(), // Optional: useful for tracking
      });
      logger.info(`Game document ${gameId} successfully updated with new challenge data.`);
    } catch (error) {
      logger.error(`Failed to update game document ${gameId} with challenge data:`, error);
      // Still return the challenge object if the client needs it, but log the persistence error.
      // Depending on requirements, this could throw an HttpsError to indicate failure to the client.
      // For now, let's assume the client might still want the challenge even if DB update fails,
      // but this is a design decision.
      // For a stricter approach, uncomment the throw below:
      // throw new HttpsError("internal", "Failed to save challenge data to the game.", error);
    }

    // 7. Return the assembled challenge object.
    return challenge;
  }
);


export const getGuildDetails = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour voir les détails d'une guilde."
    );
  }

  const { guildId } = request.data;
  const userId = request.auth.uid;

  if (!guildId || typeof guildId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "L'ID de la guilde est requis."
    );
  }

  const guildRef = db.collection("guilds").doc(guildId);

  try {
    const guildDoc = await guildRef.get();

    if (!guildDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Guilde avec l'ID "${guildId}" non trouvée.`
      );
    }

    const guildData = guildDoc.data();
    if (!guildData) {
      // This case should ideally not be reached if guildDoc.exists is true.
      throw new functions.https.HttpsError(
        "internal",
        "Données de guilde non trouvées malgré l'existence du document."
      );
    }

    // Validate that the authenticated user is a member of this guild.
    if (!guildData.members || !guildData.members[userId]) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "L'utilisateur n'est pas membre de cette guilde ou les données des membres sont manquantes."
      );
    }

    // Transform the members map into an array of objects as requested.
    // The displayName is already included in the members map entries.
    interface GuildMember {
      displayName: string;
      role: string;
      joinedAt?: admin.firestore.Timestamp;
    }
    const membersArray = Object.entries(guildData.members).map(([uid, memberData]) => {
      const typedMember = memberData as GuildMember;
      return {
        uid: uid,
        displayName: typedMember.displayName,
        role: typedMember.role,
        // joinedAt: typedMember.joinedAt, // Optionally include joinedAt if needed by frontend
      };
    });

    return {
      id: guildDoc.id,
      name: guildData.name,
      tag: guildData.tag,
      description: guildData.description,
      leaderId: guildData.leaderId,
      memberCount: guildData.memberCount,
      // createdAt: guildData.createdAt, // Optionally include
      members: membersArray,
    };
  } catch (error) {
    console.error("Erreur lors de la récupération des détails de la guilde:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue lors de la récupération des détails de la guilde."
    );
  }
});

// [DUPLICATE FUNCTION createGuild REMOVED]
// The definition for createGuild using functions.https.onCall (v1 style)
// that was previously here has been removed to favor the v2 version defined earlier in the file.
