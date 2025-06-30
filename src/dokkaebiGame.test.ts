import * as admin from "firebase-admin";

// Initialize admin if not already done
if (admin.apps.length === 0) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  admin.initializeApp({
    projectId: "test-hangeul-typhoon-project", // Use a consistent project ID for tests
  });
}

const db = admin.firestore();

import {
    getDokkaebiGameDataLogic,
    ActionVerbDefinition,
    ACTION_VERB_DEFINITIONS_COLLECTION,
    // DokkaebiGameDataResponse, // Already used as return type for getDokkaebiGameDataLogic
    // GetDokkaebiGameDataRequest, // Removed unused import
    submitDokkaebiGameResultsLogic,
    SubmitDokkaebiGameResultsRequest,
    PlayerProfile as ActualPlayerProfile
} from "./dokkaebiGame"; // Import the actual logic

// --- Interfaces (local to test, or could be shared if identical) ---
// ActionVerbDefinition is imported
// DokkaebiGameDataResponse is effectively the return type of getDokkaebiGameDataLogic

// --- Test Helper Functions ---
// const VERBS_COLLECTION = "minigames/dokkaebi/verbs"; // Old collection
// Use the actual collection name
const VERBS_COLLECTION_FOR_TESTS = ACTION_VERB_DEFINITIONS_COLLECTION;

/**
 * Sets up action verb definitions in Firestore for testing.
 * @param verbs An array of ActionVerbDefinition objects to set up.
 */
async function setupActionVerbDefinitions(
    verbs: ActionVerbDefinition[]
): Promise<void> {
  const batch = db.batch();
  const collectionRef = db.collection(VERBS_COLLECTION_FOR_TESTS);

  // Clear existing verbs first
  const snapshot = await collectionRef.get();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));

  verbs.forEach(verbDef => {
    // Use verb as ID, or let Firestore auto-generate. For test predictability, using verb.
    const docRef = collectionRef.doc(verbDef.verb);
    batch.set(docRef, verbDef);
  });
  await batch.commit();
  console.log(`Test ActionVerbDefinitions set up: ${verbs.map(v => v.verb).join(", ")}`);
}

// --- Test Suite ---
describe("Dokkaebi Minigame Backend", () => {
  describe("getDokkaebiGameDataLogic", () => { // Changed describe to match function name
    afterEach(async () => {
      // Clean up verbs after each test
      const snapshot = await db.collection(VERBS_COLLECTION_FOR_TESTS).get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    });

    test("should return a clear order and a list of possible actions for level 1", async () => {
      // Arrange
      // Assuming ActionVerbDefinition is the correct type instead of DokkaebiVerb
      const verbsToSetup: ActionVerbDefinition[] = [
        { verb: "자다", englishTranslation: "to sleep", frenchTranslation: "dormir", targetNoun: "lit", type: "action" },
        { verb: "먹다", englishTranslation: "to eat", frenchTranslation: "manger", targetNoun: "nourriture", type: "action" },
        { verb: "마시다", englishTranslation: "to drink", frenchTranslation: "boire", targetNoun: "boisson", type: "action" },
        { verb: "보다", englishTranslation: "to see", frenchTranslation: "voir", targetNoun: "télévision", type: "action" },
      ];
      await setupActionVerbDefinitions(verbsToSetup);

      // Act
      // This function is expected to be defined in the actual Cloud Functions code.
      // For TDD, we are testing against its expected signature and behavior.
      const gameData = await getDokkaebiGameDataLogic({ level: 1 });

      // Assert (these will fail initially)
      expect(gameData).toBeDefined();
      expect(gameData).not.toBeNull();
      expect(gameData.commandText).toMatch(/^(자|먹|마시|보)!$/); // e.g., "자!" or "먹어!" - adjust regex as needed
      expect(gameData.commandAudio).toEqual(expect.any(String)); // Should be a string (URL or identifier)
      expect(gameData.commandAudio).not.toBe("");

      const expectedTargets = verbsToSetup.map(v => v.targetNoun); // Changed from v.translation
      expect(expectedTargets).toContain(gameData.correctTarget);

      expect(gameData.actionOptions).toBeInstanceOf(Array);
      expect(gameData.actionOptions.length).toBeGreaterThanOrEqual(2); // Expect at least 2 options
      expect(gameData.actionOptions).toContain(gameData.correctTarget);

      expect(gameData.isSimonSays).toBe(false);
    });
  });

  // Scenarios 2 and 3 will be added here later

  describe("submitDokkaebiGameResults", () => {
    // Player data structure (simplified for tests) - Now using ActualPlayerProfile from dokkaebiGame.ts
    // interface PlayerProfile { ... } // Removed, will use ActualPlayerProfile

    // SubmitDokkaebiGameResultsRequest is imported from dokkaebiGame.ts
    // interface SubmitDokkaebiGameResultsRequest { ... } // Removed

    // DokkaebiGameResultsResponse is the return type of imported submitDokkaebiGameResultsLogic
    // interface DokkaebiGameResultsResponse { ... } // Removed

    // Placeholder removed, actual logic is imported.
    // const submitDokkaebiGameResultsLogic = async ( ... ) => { ... };

    const PLAYER_COLLECTION = "players"; // This constant is also defined in dokkaebiGame.ts

    /**
     * Sets up a player profile in Firestore for testing.
     * @param playerId The ID of the player.
     * @param initialProfileData Partial data for the player's profile.
     */
    async function setupPlayerProfile(
      playerId: string,
      initialProfileData: Partial<ActualPlayerProfile>
    ): Promise<void> {
      const playerRef = db.collection(PLAYER_COLLECTION).doc(playerId);
      await playerRef.set({
        uid: playerId, // Ensure uid is set
        mana: 0,
        stats: { verbsMastered: 0 },
        ...initialProfileData,
      } as ActualPlayerProfile); // Cast to ensure all required fields if any
      console.log(`Player profile for ${playerId} set up in emulator.`);
    }

    /**
     * Retrieves a player profile from Firestore.
     * @param playerId The ID of the player.
     * @returns The player's profile data or null if not found.
     */
    async function getPlayerProfile(
      playerId: string
    ): Promise<ActualPlayerProfile | null> {
      const playerRef = db.collection(PLAYER_COLLECTION).doc(playerId);
      const doc = await playerRef.get();
      if (!doc.exists) return null;
      return doc.data() as ActualPlayerProfile;
    }

    afterEach(async () => {
      // Clean up player profiles created in this describe block
      // This is a simple cleanup; more specific cleanup might be needed if UIDs are dynamic.
      const snapshot = await db.collection(PLAYER_COLLECTION).get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        // Example: only delete test players if they follow a pattern
        if (doc.id.startsWith("test-player-")) {
          batch.delete(doc.ref);
        }
      });
      await batch.commit();
    });

    test("should validate a correct answer, return a positive score, and update player stats", async () => {
      // Arrange
      const playerId = "test-player-scenario2";
      const initialMana = 50;
      const initialVerbsMastered = 5;

      await setupPlayerProfile(playerId, {
        mana: initialMana,
        stats: { verbsMastered: initialVerbsMastered },
      });

      const gameSubmission: SubmitDokkaebiGameResultsRequest = {
        playerId: playerId,
        command: "자!",
        clickedTarget: "lit", // Assuming "자!" corresponds to "lit"
        isSimonSays: false,
      };

      // Act
      const result = await submitDokkaebiGameResultsLogic(gameSubmission);

      // Assert: Function Result (will fail)
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result.result).toBe("success");
      expect(result.score).toBe(100);

      // Assert: Player Data Updated in Firestore (will fail)
      const updatedProfile = await getPlayerProfile(playerId);
      expect(updatedProfile).not.toBeNull();
      // Assuming score directly adds to mana for this test, or some logic derives it
      expect(updatedProfile!.mana).toBe(initialMana + 100);
      // Check if verbsMastered was incremented.
      // The actual implementation might involve FieldValue.increment(1)
      // For this TDD setup, we'll check for the expected final value.
      // This assertion is tricky without knowing the exact update mechanism.
      // If the function is expected to use FieldValue.increment(1),
      // the mock setupPlayerProfile and getPlayerProfile might need adjustment,
      // or the test focuses on the function *intending* to increment.
      // For now, let's assume the placeholder function is supposed to handle the increment logic
      // and we are checking the outcome.
      // A direct check for `initialVerbsMastered + 1` will likely fail if the function
      // is not implemented or if it uses FieldValue.increment and returns null.
      expect(updatedProfile!.stats.verbsMastered).toBe(initialVerbsMastered + 1);
    });

    test("should invalidate an action and apply penalty if 'Dokkaebi dit...' condition is not met", async () => {
      // Arrange
      const playerId = "test-player-scenario3";
      const initialMana = 50;

      await setupPlayerProfile(playerId, {
        mana: initialMana,
        // stats.verbsMastered is not expected to change in this scenario
      });

      const gameSubmission: SubmitDokkaebiGameResultsRequest = {
        playerId: playerId,
        command: "자!", // Action performed
        clickedTarget: "lit", // Target clicked
        isSimonSays: true, // It was a "Dokkaebi dit..." round
        simonSaysConditionMet: false, // But the condition was NOT met (e.g., "Dokkaebi" wasn't said)
      };

      // Act
      const result = await submitDokkaebiGameResultsLogic(gameSubmission);

      // Assert: Function Result (will fail)
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result.result).toBe("failure");
      expect(result.score).toBe(-50); // Penalty

      // Assert: Player Data (Optional for this specific test, but good for completeness)
      // Check if mana decreased or if other penalty effects are in place.
      // The prompt focuses on the returned score, so we'll primarily check that.
      // If mana is affected by negative score, we can check that too.
      const updatedProfile = await getPlayerProfile(playerId);
      expect(updatedProfile).not.toBeNull();
      // Assuming negative score reduces mana. If not, this assertion might change.
      expect(updatedProfile!.mana).toBe(initialMana - 50);
    });
  });
});
