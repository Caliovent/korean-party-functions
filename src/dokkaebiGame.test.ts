import * as admin from "firebase-admin";

// Initialize admin if not already done
if (admin.apps.length === 0) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  admin.initializeApp({
    projectId: "test-hangeul-typhoon-project", // Use a consistent project ID for tests
  });
}

const db = admin.firestore();

// --- Interfaces (will likely be defined in a shared types.ts later) ---
interface DokkaebiVerb {
  korean: string;
  translation: string; // e.g., "lit" for "자다" (action target)
  // any other relevant fields
}

interface DokkaebiGameData {
  commandText: string; // e.g., "자!"
  commandAudio: string; // URL or identifier for audio
  correctTarget: string; // e.g., "lit"
  actionOptions: string[]; // e.g., ["lit", "nourriture", "bureau", "porte"]
  isSimonSays: boolean;
}

interface GetDokkaebiGameDataRequest {
  level: number;
  // Potentially playerId if personalization is needed
}

// --- Placeholder for the actual Cloud Function logic ---
// This function doesn't exist yet, so tests calling it will fail.
const getDokkaebiGameDataLogic = async (
  _request: GetDokkaebiGameDataRequest
): Promise<DokkaebiGameData> => {
  throw new Error("getDokkaebiGameDataLogic not implemented");
};

// --- Test Helper Functions ---
const VERBS_COLLECTION = "minigames/dokkaebi/verbs";

async function setupDokkaebiVerbs(verbs: DokkaebiVerb[]): Promise<void> {
  const batch = db.batch();
  const collectionRef = db.collection(VERBS_COLLECTION);

  // Clear existing verbs first to ensure a clean state for the test
  const snapshot = await collectionRef.get();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));

  verbs.forEach(verb => {
    const docRef = collectionRef.doc(verb.korean); // Use Korean word as ID for simplicity
    batch.set(docRef, verb);
  });
  await batch.commit();
  console.log(`Dokkaebi verbs set up in emulator: ${verbs.map(v => v.korean).join(", ")}`);
}

// --- Test Suite ---
describe("Dokkaebi Minigame Backend", () => {
  describe("getDokkaebiGameData", () => {
    afterEach(async () => {
      // Clean up verbs after each test in this describe block
      const snapshot = await db.collection(VERBS_COLLECTION).get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    });

    test("should return a clear order and a list of possible actions for level 1", async () => {
      // Arrange
      const verbsToSetup: DokkaebiVerb[] = [
        { korean: "자다", translation: "lit" },
        { korean: "먹다", translation: "nourriture" },
        { korean: "마시다", translation: "boisson" },
        { korean: "보다", translation: "télévision" },
      ];
      await setupDokkaebiVerbs(verbsToSetup);

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

      const expectedTargets = verbsToSetup.map(v => v.translation);
      expect(expectedTargets).toContain(gameData.correctTarget);

      expect(gameData.actionOptions).toBeInstanceOf(Array);
      expect(gameData.actionOptions.length).toBeGreaterThanOrEqual(2); // Expect at least 2 options
      expect(gameData.actionOptions).toContain(gameData.correctTarget);

      expect(gameData.isSimonSays).toBe(false);
    });
  });

  // Scenarios 2 and 3 will be added here later

  describe("submitDokkaebiGameResults", () => {
    // Player data structure (simplified for tests)
    interface PlayerProfile {
      uid: string;
      mana: number;
      stats: {
        verbsMastered?: number; // For incrementing
        [key: string]: any;
      };
      // other player fields
    }

    interface SubmitDokkaebiGameResultsRequest {
      playerId: string;
      command: string; // e.g., "자!"
      clickedTarget: string; // e.g., "lit"
      isSimonSays: boolean;
      simonSaysConditionMet?: boolean; // Relevant for other scenarios
      // Potentially other fields like reactionTime, gameId, etc.
    }

    interface DokkaebiGameResultsResponse {
      result: "success" | "failure";
      score: number;
      message?: string;
    }

    // Placeholder for the actual Cloud Function logic
    const submitDokkaebiGameResultsLogic = async (
      _request: SubmitDokkaebiGameResultsRequest
    ): Promise<DokkaebiGameResultsResponse> => {
      throw new Error("submitDokkaebiGameResultsLogic not implemented");
    };

    const PLAYER_COLLECTION = "players";

    async function setupPlayerProfile(playerId: string, initialProfileData: Partial<PlayerProfile>): Promise<void> {
      const playerRef = db.collection(PLAYER_COLLECTION).doc(playerId);
      await playerRef.set({
        mana: 0,
        stats: { verbsMastered: 0 },
        ...initialProfileData,
      });
      console.log(`Player profile for ${playerId} set up in emulator.`);
    }

    async function getPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
      const playerRef = db.collection(PLAYER_COLLECTION).doc(playerId);
      const doc = await playerRef.get();
      if (!doc.exists) return null;
      return doc.data() as PlayerProfile;
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
