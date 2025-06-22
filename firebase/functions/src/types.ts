import * as admin from "firebase-admin";

/**
 * Represents the learning status of a specific spell (rune/content) for a user.
 * Stored in Firestore under: playerLearningProfiles/{userId}/spellMasteryStatus/{contentId}
 */
export interface SpellMasteryStatus {
  contentId: string; // ID of the learned content (word, grammar, etc.)
  status: 'discovered' | 'learning' | 'mastered' | 'engraved';
  lastReviewedTimestamp: admin.firestore.Timestamp;
  nextReviewTimestamp: admin.firestore.Timestamp;
  currentIntervalDays: number; // The interval in days for the next review
  easeFactor: number; // SuperMemo 2 ease factor (minimum 1.3)
  correctStreak: number; // Number of consecutive correct reviews
}

/**
 * Input for the submitSrsReview Cloud Function.
 */
export interface SubmitSrsReviewPayload {
  itemId: string; // contentId of the item being reviewed
  wasCorrect: boolean; // Whether the user's answer was correct
}
