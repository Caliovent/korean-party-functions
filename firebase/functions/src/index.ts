/**
 * Initial entry point for Firebase Cloud Functions.
 */

// Firebase Admin SDK
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { SpellMasteryStatus, SubmitSrsReviewPayload } from "./types";

admin.initializeApp();

// Firestore instance
const db = admin.firestore();

// --- SRS Algorithm Constants ---
const MIN_EASE_FACTOR = 1.3;
const INITIAL_EASE_FACTOR = 2.5;
const EASE_FACTOR_MODIFIER_WRONG = 0.2;
// const EASE_FACTOR_MODIFIER_CORRECT = 0.1; // Optional: if we want to adjust ease factor on correct answers too

const CORRECT_STREAK_TO_MASTERED = 5; // Example: 5 correct answers in a row to reach 'mastered'
const CORRECT_STREAK_TO_ENGRAVED = 15; // Example: 15 correct answers in a row to reach 'engraved' (from mastered)


/**
 * Cloud Function to get items due for review for the authenticated user.
 */
export const getReviewItems = functions.https.onCall(async (_data, context) => {
  // 1. Validate user authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated.",
    );
  }
  const userId = context.auth.uid;

  try {
    // 2. Query the user's spellMasteryStatus subcollection
    const now = admin.firestore.Timestamp.now();
    const reviewItemsQuery = db
      .collection("playerLearningProfiles")
      .doc(userId)
      .collection("spellMasteryStatus")
      .where("nextReviewTimestamp", "<=", now)
      .orderBy("nextReviewTimestamp") // Oldest due items first
      .limit(20); // 3. Limit results

    const snapshot = await reviewItemsQuery.get();

    if (snapshot.empty) {
      return []; // No items due for review
    }

    // 4. Return an array of contentIds
    const itemsToReview = snapshot.docs.map((doc) => {
      const data = doc.data() as SpellMasteryStatus;
      return data.contentId; // Or return the full object if frontend needs more info
    });

    return itemsToReview;
  } catch (error)
  {
    functions.logger.error(
        "Error in getReviewItems for user:",
        userId,
        error,
    );
    throw new functions.https.HttpsError(
      "internal",
      "An error occurred while fetching review items.",
    );
  }
});

/**
 * Interface for the payload of submitMiniGameResults.
 * (Illustrative - adapt to actual game reward structure)
 */
interface MiniGameResultsPayload {
  gameId: string; // ID of the mini-game played
  score: number;
  newlyLearnedContentIds: string[]; // Array of contentIds (words, phrases) learned
  // ... other potential rewards like XP, mana, etc.
}

/**
 * (Illustrative) Cloud Function to submit mini-game results and initialize SRS data
 * for newly learned items.
 */
export const submitMiniGameResults = functions.https.onCall(async (data: MiniGameResultsPayload, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
  }
  const userId = context.auth.uid;
  const { newlyLearnedContentIds } = data;

  if (!Array.isArray(newlyLearnedContentIds)) {
    throw new functions.https.HttpsError("invalid-argument", "'newlyLearnedContentIds' must be an array.");
  }

  // Here, you would typically grant other rewards (XP, Mana, etc.)
  // For example: await grantXp(userId, data.score);

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const contentId of newlyLearnedContentIds) {
    if (!contentId || typeof contentId !== "string") {
      functions.logger.warn(`Invalid contentId found for user ${userId}: ${contentId}`);
      continue; // Skip invalid contentId
    }

    const srsItemRef = db
      .collection("playerLearningProfiles")
      .doc(userId)
      .collection("spellMasteryStatus")
      .doc(contentId);

    // Check if an SRS record already exists for this item.
    // This function will create it if it's genuinely new.
    // If it can be learned multiple times, this logic might need adjustment
    // or rely on the game design to only send "newly" learned items.
    // For this implementation, we assume newlyLearnedContentIds are truly new.

    const newSrsEntry: SpellMasteryStatus = {
      contentId: contentId,
      status: "discovered",
      lastReviewedTimestamp: now,
      // Set to review immediately or very soon.
      // Interval 0 means it's new, submitSrsReview will handle first interval.
      nextReviewTimestamp: now,
      currentIntervalDays: 0,
      easeFactor: INITIAL_EASE_FACTOR, // Default ease factor
      correctStreak: 0,
    };
    batch.set(srsItemRef, newSrsEntry, { merge: true }); // Use merge:true to be safe, though it should be a new doc.
  }

  try {
    await batch.commit();
    return { success: true, message: `${newlyLearnedContentIds.length} new SRS items initialized.` };
  } catch (error) {
    functions.logger.error(
        `Error initializing SRS items for user ${userId}:`,
        error,
    );
    throw new functions.https.HttpsError(
      "internal",
      "Failed to initialize new learning items.",
    );
  }
});


/**
 * Cloud Function to submit a review result and update SRS data.
 */
export const submitSrsReview = functions.https.onCall(async (data: SubmitSrsReviewPayload, context) => {
  // 1. Validate user authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated.",
    );
  }
  const userId = context.auth.uid;

  // 2. Validate input data
  const { itemId, wasCorrect } = data;
  if (!itemId || typeof wasCorrect !== "boolean") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid payload. 'itemId' (string) and 'wasCorrect' (boolean) are required.",
    );
  }

  const itemRef = db
    .collection("playerLearningProfiles")
    .doc(userId)
    .collection("spellMasteryStatus")
    .doc(itemId);

  try {
    const doc = await itemRef.get();
    if (!doc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `SRS item with ID ${itemId} not found for user ${userId}.`,
      );
    }

    const srsData = doc.data() as SpellMasteryStatus;

    // --- Apply SM-2 like algorithm ---
    let newIntervalDays: number;
    let newEaseFactor = srsData.easeFactor;
    let newCorrectStreak = srsData.correctStreak;
    let newStatus = srsData.status;

    if (wasCorrect) {
      newCorrectStreak++;
      if (srsData.currentIntervalDays === 0) { // First review or after a reset
        newIntervalDays = 1;
      } else if (srsData.currentIntervalDays === 1) {
        newIntervalDays = 6; // Standard SM-2: first interval 1, second 6
      } else {
        newIntervalDays = Math.round(srsData.currentIntervalDays * newEaseFactor);
      }
      // Optional: Slightly increase easeFactor if consistently correct (not in original spec, but can be added)
      // newEaseFactor = Math.min(2.5, newEaseFactor + EASE_FACTOR_MODIFIER_CORRECT);

      // Update status based on streak
      if (newStatus === "learning" && newCorrectStreak >= CORRECT_STREAK_TO_MASTERED) {
        newStatus = "mastered";
      } else if (newStatus === "mastered" && newCorrectStreak >= CORRECT_STREAK_TO_ENGRAVED) {
        newStatus = "engraved";
      } else if (newStatus === "discovered") { // First correct answer
        newStatus = "learning";
      }

    } else { // wasCorrect is false
      newCorrectStreak = 0;
      newIntervalDays = 1; // Reset interval to 1 day
      newEaseFactor = Math.max(MIN_EASE_FACTOR, newEaseFactor - EASE_FACTOR_MODIFIER_WRONG);

      // Update status based on failure
      if (newStatus === "mastered" || newStatus === "engraved") {
        newStatus = "learning";
      }
      // If 'discovered' and wrong, it remains 'discovered' until a correct answer.
    }

    const now = admin.firestore.Timestamp.now();
    let newNextReviewTimestampValue = now.toMillis() + newIntervalDays * 24 * 60 * 60 * 1000;
    // Ensure next review is not in the past if interval is 0 (e.g. for 'discovered' items to be reviewed soon)
    if (newIntervalDays === 0 && newNextReviewTimestampValue < now.toMillis()) {
      newNextReviewTimestampValue = now.toMillis();
    }
    const newNextReviewTimestamp = admin.firestore.Timestamp.fromMillis(newNextReviewTimestampValue);


    const updatePayload: Partial<SpellMasteryStatus> = {
      lastReviewedTimestamp: now,
      nextReviewTimestamp: newNextReviewTimestamp,
      currentIntervalDays: newIntervalDays,
      easeFactor: newEaseFactor,
      correctStreak: newCorrectStreak,
      status: newStatus,
    };

    await itemRef.update(updatePayload);

    return { success: true, message: `SRS data for item ${itemId} updated.` };

  } catch (error) {
    functions.logger.error(
        `Error in submitSrsReview for user ${userId}, item ${itemId}:`,
        error,
    );
    if (error instanceof functions.https.HttpsError) {
      throw error; // Re-throw HttpsError directly
    }
    throw new functions.https.HttpsError(
      "internal",
      `An error occurred while updating SRS item ${itemId}.`,
    );
  }
});
