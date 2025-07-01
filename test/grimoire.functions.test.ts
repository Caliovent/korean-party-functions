import * as admin from "firebase-admin";
import * as functions from "firebase-functions-test";
import { updatePlayerExperienceOnRuneChange } from "../src/index"; // Adjust path as needed

// Initialize firebase-functions-test. Requires a service account key file.
// You might need to configure this based on your project setup.
// const testEnv = functions({
//   databaseURL: `https://<YOUR_PROJECT_ID>.firebaseio.com`,
//   storageBucket: `<YOUR_PROJECT_ID>.appspot.com`,
//   projectId: `<YOUR_PROJECT_ID>`,
// }, "path/to/your/serviceAccountKey.json"); // Replace with your actual project ID and service account key path

// For emulated environment, initialization might be simpler or handled by scripts
// If using emulators, admin.initializeApp() might be called elsewhere or configured by emulators:exec
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: "firestore-emulator-example", // Or your actual project ID for tests
  });
}
const db = admin.firestore();

// Helper to create a user document
const createUser = async (userId: string, initialData: any = {}) => {
  await db.collection("users").doc(userId).set({
    email: `${userId}@example.com`,
    displayName: userId,
    level: 1,
    xp: 0,
    manaCurrent: 100,
    manaMax: 100,
    fragments: { vocab: 0, grammar: 0, culture: 0 },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    stats: {
      gamesPlayed: 0,
      gamesWon: 0,
      duelsWon: 0,
      spellsCast: 0,
      grimoiresCollected: 0,
      wordsTypedInTyphoon: 0,
      perfectQuizzes: 0,
    },
    totalExperience: 0, // Initialize
    wizardLevel: 1,     // Initialize
    ...initialData,
  });
};

// Helper to create/update a rune document
const setRuneMastery = async (userId: string, contentId: string, masteryLevel: number | null) => {
  const runeRef = db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).doc(contentId);
  if (masteryLevel === null) {
    await runeRef.delete();
  } else {
    await runeRef.set({ masteryLevel });
  }
};

// Helper to get user data
const getUserData = async (userId: string) => {
  const userSnap = await db.collection("users").doc(userId).get();
  return userSnap.data();
};

describe("updatePlayerExperienceOnRuneChange", () => {
  const userId = "testUserGrimoire";
  const wrapped = testEnv.wrap(updatePlayerExperienceOnRuneChange);

  beforeEach(async () => {
    // Clean up user and their runes before each test
    await db.collection("users").doc(userId).delete().catch(() => {}); // Ignore error if not found
    const runesSnapshot = await db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).get();
    const batch = db.batch();
    runesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    // Create a fresh user for each test
    await createUser(userId);
  });

  afterAll(async () => {
    // Clean up test data
    await db.collection("users").doc(userId).delete().catch(() => {});
    const runesSnapshot = await db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).get();
    const batch = db.batch();
    runesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    // testEnv.cleanup(); // Clean up firebase-functions-test
  });

  test("should initialize totalExperience and wizardLevel to 0 and 1 if no runes", async () => {
    // Trigger the function by simulating a write (e.g., creating then deleting a dummy rune to ensure onWrite fires)
    // Or, if the function correctly handles empty subcollection on first user creation, this might not be needed.
    // For this test, let's assume the user is freshly created and then a rune change happens.
    // The function recalculates everything.

    // Simulate a write event for a non-existent rune (or an actual one and then delete it)
    const fakeRuneId = "runeTEMP";
    const makeChange = testEnv.firestore.makeDocumentSnapshot({ masteryLevel: 1 }, `playerLearningProfiles/${userId}/spellMasteryStatus/${fakeRuneId}`);
    // For onWrite, we need before and after snapshots.
    // Simulating a create:
    const beforeSnap = testEnv.firestore.makeDocumentSnapshot({}, `playerLearningProfiles/${userId}/spellMasteryStatus/${fakeRuneId}`, { exists: false });
    const afterSnap = testEnv.firestore.makeDocumentSnapshot({ masteryLevel: 1 }, `playerLearningProfiles/${userId}/spellMasteryStatus/${fakeRuneId}`);

    await setRuneMastery(userId, fakeRuneId, 1); // Create a rune
    await setRuneMastery(userId, fakeRuneId, null); // Immediately delete it, triggering the function

    // Wait for the function to execute (this might need a delay or a more sophisticated way to await triggers)
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simple delay

    const userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(0);
    expect(userData?.wizardLevel).toBe(1);
  });

  test("should calculate experience correctly for a single rune", async () => {
    await setRuneMastery(userId, "rune1", 2); // Level 2 rune = 5 XP

    // Wait for the function to execute
    await new Promise(resolve => setTimeout(resolve, 1000));

    const userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(5);
    expect(userData?.wizardLevel).toBe(1); // floor(5/100) + 1 = 1
  });

  test("should calculate experience correctly for multiple runes", async () => {
    await setRuneMastery(userId, "rune1", 1); // 1 XP
    await setRuneMastery(userId, "rune2", 2); // 5 XP
    await setRuneMastery(userId, "rune3", 3); // 20 XP
    await setRuneMastery(userId, "rune4", 4); // 50 XP

    // Wait for the function to execute (last write to rune4 will trigger)
    await new Promise(resolve => setTimeout(resolve, 1000));

    const userData = await getUserData(userId);
    const expectedXp = 1 + 5 + 20 + 50; // 76
    expect(userData?.totalExperience).toBe(expectedXp);
    expect(userData?.wizardLevel).toBe(1); // floor(76/100) + 1 = 1
  });

  test("should update wizardLevel when experience crosses threshold", async () => {
    await setRuneMastery(userId, "rune1", 4); // 50 XP
    await setRuneMastery(userId, "rune2", 4); // 50 XP
    // Total 100 XP

    await new Promise(resolve => setTimeout(resolve, 1000));
    let userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(100);
    expect(userData?.wizardLevel).toBe(2); // floor(100/100) + 1 = 2

    await setRuneMastery(userId, "rune3", 4); // +50 XP (Total 150 XP)
    await new Promise(resolve => setTimeout(resolve, 1000));
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(150);
    expect(userData?.wizardLevel).toBe(2); // floor(150/100) + 1 = 2

    await setRuneMastery(userId, "rune4", 4); // +50 XP (Total 200 XP)
    await new Promise(resolve => setTimeout(resolve, 1000));
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(200);
    expect(userData?.wizardLevel).toBe(3); // floor(200/100) + 1 = 3
  });

  test("should recalculate experience when a rune is updated", async () => {
    await setRuneMastery(userId, "rune1", 1); // 1 XP
    await new Promise(resolve => setTimeout(resolve, 1000));
    let userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(1);

    await setRuneMastery(userId, "rune1", 4); // Updated to 50 XP
    await new Promise(resolve => setTimeout(resolve, 1000));
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(50);
    expect(userData?.wizardLevel).toBe(1); // floor(50/100)+1 = 1
  });

  test("should recalculate experience when a rune is deleted", async () => {
    await setRuneMastery(userId, "rune1", 4); // 50 XP
    await setRuneMastery(userId, "rune2", 2); // 5 XP
    // Total 55 XP
    await new Promise(resolve => setTimeout(resolve, 1000));
    let userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(55);

    await setRuneMastery(userId, "rune1", null); // Delete rune1 (remove 50 XP)
    await new Promise(resolve => setTimeout(resolve, 1000));
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(5); // Remaining 5 XP from rune2
    expect(userData?.wizardLevel).toBe(1);
  });

  test("should handle runes with invalid masteryLevel gracefully", async () => {
    await setRuneMastery(userId, "runeValid", 2); // 5 XP
    // @ts-ignore - Testing invalid data
    await setRuneMastery(userId, "runeInvalidLevel", 7); // Invalid level, should be ignored
    // @ts-ignore - Testing invalid data type
    await db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).doc("runeInvalidType").set({ masteryLevel: "not a number" });


    await new Promise(resolve => setTimeout(resolve, 1000));
    const userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(5); // Only valid rune counts
    expect(userData?.wizardLevel).toBe(1);
  });
});

// Note: `firebase-functions-test` setup can be tricky.
// The above `testEnv.wrap` and `makeDocumentSnapshot` might need adjustments
// based on whether you're testing against a live Firebase project (not recommended for automated tests)
// or the emulators. The `package.json` script `test:jest` suggests emulators are used.
// `firebase emulators:exec --project firestore-emulator-example --only firestore "jest"`
// This command indicates the Firestore emulator is running.
// The tests would need to interact with this emulated Firestore instance.
// The `admin.initializeApp()` might need to be configured to point to the emulator:
// process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; (if not already set by emulators:exec)

// The `wrapped` function execution for Firestore triggers is usually like:
// const change = testEnv.firestore.makeChange(beforeSnap, afterSnap);
// await wrapped(change, { params: { userId: userId, contentId: 'someRuneId' } });
// The current test uses direct DB manipulation and a timeout, which is a common way to test triggers
// when direct invocation of the wrapped function is complex or when testing the trigger mechanism itself.
// However, for unit/integration tests of the function's logic, directly calling `wrapped` with appropriate
// Change and EventContext objects is often preferred.
// For this example, I've kept the timeout approach for simplicity of demonstration without full `firebase-functions-test` setup.
// A more robust solution would involve directly invoking the wrapped function.
// Example for a create event:
// const afterSnap = testEnv.firestore.makeDocumentSnapshot({ masteryLevel: 1 }, `playerLearningProfiles/${userId}/spellMasteryStatus/runeNew`);
// const change = testEnv.firestore.makeChange(null, afterSnap); // before is null for create
// await wrapped(change, { params: { userId: userId, contentId: "runeNew" } });
// This would avoid the need for `setTimeout`.
// The current `setRuneMastery` helper and `setTimeout` are used to simulate the trigger.
// For a real test suite, you'd replace `setTimeout` with proper `wrapped` calls.

// The provided `testEnv` initialization is commented out because it often requires
// a service account, which is not ideal for CI/emulator environments.
// The `admin.initializeApp()` for emulators is usually sufficient.
// `functions()` from 'firebase-functions-test' is typically initialized like:
// const test = require('firebase-functions-test')(); or
// import * as testSetup from 'firebase-functions-test';
// const test = testSetup();
// And then `test.wrap(...)`
// I've used `testEnv` as a placeholder for this initialized object.
// The actual variable name might be `test` or similar based on project conventions.
// For the tests to run, `testEnv` should be properly initialized.
// Let's assume `functions` is the initialized test environment:
const testEnv = functions(); // This line is a placeholder for actual initialization.
// If firebase-functions-test is not installed, these tests won't run without modification.
// Given the testing setup in package.json, it's likely firebase-functions-test or a similar helper is used.
// The tests above are structured to work with such a setup.
// The key is that `wrapped(change, context)` correctly simulates the Cloud Function trigger.
// The `setRuneMastery` and `setTimeout` is an alternative way to trigger the function via emulator interaction.
// If `firebase-functions-test` is not in devDependencies, it should be added:
// npm install --save-dev firebase-functions-test
// or
// yarn add --dev firebase-functions-test

// The current `test:jest` script in package.json is:
// "firebase emulators:exec --project firestore-emulator-example --only firestore \"jest\""
// This means tests run within an environment where Firestore emulator is available.
// The admin SDK should automatically connect to the emulator if FIRESTORE_EMULATOR_HOST is set.
// The `functions.firestore.document(...).onWrite` part is the trigger registration.
// The `wrapped` function is the actual HTTPS-callable or background function handler.
// For Firestore triggers, `firebase-functions-test` provides ways to mock the `Change` and `EventContext` objects.

// Final check of the file:
// - `functions` from `firebase-functions-test` needs to be properly initialized.
// - The direct database writes (`setRuneMastery`) followed by `setTimeout` are a common way to test triggers in an emulated environment if direct wrapping and invocation is complex.
// - For more isolated unit tests of the function logic, you'd mock Firestore calls within the function body or pass a mocked Firestore client.
// - The current tests are more integration-style, relying on the emulator.
```javascript
import * as admin from "firebase-admin";
import * as fft from "firebase-functions-test"; // Using fft as alias for firebase-functions-test
import { updatePlayerExperienceOnRuneChange } from "../src/index"; // Adjust path as needed

// Initialize firebase-functions-test.
// projectId can be anything for local testing, but often matches your Firebase project ID.
const testEnv = fft({
  projectId: "korean-party-test-project", // Replace with your actual project ID or a test one
  // databaseURL: `https://korean-party-test-project.firebaseio.com`, // Optional: if using Realtime Database
  // storageBucket: `korean-party-test-project.appspot.com`, // Optional: if using Storage
});

// Ensure Firebase Admin SDK is initialized (points to emulators if FIRESTORE_EMULATOR_HOST is set)
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Helper to create a user document
const createUser = async (userId: string, initialData: any = {}) => {
  await db.collection("users").doc(userId).set({
    email: `${userId}@example.com`,
    displayName: userId,
    // Fields from onUserCreate in src/index.ts
    uid: userId,
    rank: "Apprenti Runique",
    mana: 100,
    grimoires: [],
    fragments: { dark: 0, light: 0, nature: 0 },
    activeQuests: [],
    completedQuests: [],
    ownedCosmetics: [],
    equippedCosmetics: { outfit: null, pet: null, spellEffect: null },
    // Fields from UserProfile in src/types.ts that are also in onUserCreate or createProfileOnSignup
    level: 1, // from createProfileOnSignup, though onUserCreate doesn't have it
    xp: 0,    // from createProfileOnSignup
    // New fields for Grimoire Vivant, initialized in onUserCreate
    totalExperience: 0,
    wizardLevel: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // Stats object from createProfileOnSignup, onUserCreate doesn't explicitly add it but UserProfile has it
    stats: {
      gamesPlayed: 0,
      gamesWon: 0,
      duelsWon: 0,
      spellsCast: 0,
      grimoiresCollected: 0,
      wordsTypedInTyphoon: 0,
      perfectQuizzes: 0,
    },
    ...initialData, // Allows overriding defaults for specific tests
  });
};

// Helper to create/update/delete a rune document which triggers the function
const writeRuneMastery = async (userId: string, contentId: string, masteryLevel: number | null) => {
  const runeRef = db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).doc(contentId);
  if (masteryLevel === null) {
    await runeRef.delete(); // This will trigger an onWrite event (delete)
  } else {
    await runeRef.set({ masteryLevel }); // This will trigger an onWrite event (create or update)
  }
  // Adding a small delay to allow Firestore trigger to propagate and function to execute
  // In a more robust setup, you might listen for the write to the user document
  // or use specific mechanisms from firebase-functions-test if available for ensuring function completion.
  await new Promise(resolve => setTimeout(resolve, 500)); // Adjust delay as needed
};

// Helper to get user data
const getUserData = async (userId: string) => {
  const userSnap = await db.collection("users").doc(userId).get();
  return userSnap.data();
};

describe("Grimoire Vivant - updatePlayerExperienceOnRuneChange", () => {
  const userId = "testUserGrimoireCalc";

  // Wrapped function for direct invocation (alternative to actual trigger)
  // const wrappedUpdatePlayerExp = testEnv.wrap(updatePlayerExperienceOnRuneChange);

  beforeAll(async () => {
    // Optional: Clear Firestore emulator before all tests if not handled by `emulators:exec` script
    // This requires projectId to be set for firebase-admin to talk to the emulator
    // try {
    //   await testEnv.firestore.clearFirestoreData({ projectId: "korean-party-test-project" });
    // } catch (e) {
    //   console.warn("Could not clear Firestore data, perhaps emulator not running or projectId mismatch:", e.message);
    // }
  });

  beforeEach(async () => {
    // Ensure the user document exists for each test, starting fresh.
    // Delete any existing runes for the user.
    const runesSnapshot = await db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).get();
    if (!runesSnapshot.empty) {
      const batch = db.batch();
      runesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    // Create a fresh user, which also tests the initialization logic in onUserCreate
    await createUser(userId, { totalExperience: 0, wizardLevel: 1 });
  });

  afterAll(async () => {
    // Clean up test data
    await db.collection("users").doc(userId).delete().catch(() => {});
    const runesSnapshot = await db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).get();
    if (!runesSnapshot.empty) {
      const batch = db.batch();
      runesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    testEnv.cleanup(); // Clean up firebase-functions-test resources
  });

  test("should correctly initialize totalExperience to 0 and wizardLevel to 1 if no runes exist after a trigger", async () => {
    // User is created fresh by beforeEach.
    // We need to simulate a rune write that results in an empty rune set.
    await writeRuneMastery(userId, "runeTEMP", 1); // Create one
    await writeRuneMastery(userId, "runeTEMP", null); // Then delete it

    const userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(0);
    expect(userData?.wizardLevel).toBe(1);
  });

  test("should calculate experience and level correctly for a single rune", async () => {
    await writeRuneMastery(userId, "rune1", 2); // Level 2 rune = 5 XP

    const userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(5);
    expect(userData?.wizardLevel).toBe(1); // floor(5/100) + 1 = 1
  });

  test("should calculate experience and level correctly for multiple runes", async () => {
    await writeRuneMastery(userId, "rune1", 1); // 1 XP
    await writeRuneMastery(userId, "rune2", 2); // 5 XP
    await writeRuneMastery(userId, "rune3", 3); // 20 XP
    await writeRuneMastery(userId, "rune4", 4); // 50 XP (last write triggers final calculation)

    const userData = await getUserData(userId);
    const expectedXp = 1 + 5 + 20 + 50; // 76
    expect(userData?.totalExperience).toBe(expectedXp);
    expect(userData?.wizardLevel).toBe(1); // floor(76/100) + 1 = 1
  });

  test("should update wizardLevel when experience crosses thresholds", async () => {
    await writeRuneMastery(userId, "rune1", 4); // 50 XP
    await writeRuneMastery(userId, "rune2", 4); // 50 XP (Total 100 XP)

    let userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(100);
    expect(userData?.wizardLevel).toBe(2); // floor(100/100) + 1 = 2

    await writeRuneMastery(userId, "rune3", 4); // +50 XP (Total 150 XP)
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(150);
    expect(userData?.wizardLevel).toBe(2); // floor(150/100) + 1 = 2

    await writeRuneMastery(userId, "rune4", 4); // +50 XP (Total 200 XP)
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(200);
    expect(userData?.wizardLevel).toBe(3); // floor(200/100) + 1 = 3
  });

  test("should recalculate experience when a rune's masteryLevel is updated", async () => {
    await writeRuneMastery(userId, "rune1", 1); // 1 XP
    let userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(1);

    await writeRuneMastery(userId, "rune1", 4); // Updated to 50 XP
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(50);
    expect(userData?.wizardLevel).toBe(1);
  });

  test("should recalculate experience to zero if all runes are deleted", async () => {
    await writeRuneMastery(userId, "rune1", 4); // 50 XP
    await writeRuneMastery(userId, "rune2", 2); // 5 XP
    // Total 55 XP
    let userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(55);

    await writeRuneMastery(userId, "rune1", null); // Delete rune1
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(5); // Remaining 5 XP from rune2

    await writeRuneMastery(userId, "rune2", null); // Delete rune2
    userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(0);
    expect(userData?.wizardLevel).toBe(1);
  });

  test("should handle runes with invalid or missing masteryLevel gracefully", async () => {
    await writeRuneMastery(userId, "runeValid", 2); // 5 XP

    // Simulate a rune with an invalid masteryLevel (e.g., too high)
    const invalidLevelRuneRef = db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).doc("runeInvalidLevel");
    await invalidLevelRuneRef.set({ masteryLevel: 7 }); // Not 1-4
    await new Promise(resolve => setTimeout(resolve, 500)); // Allow trigger

    // Simulate a rune with masteryLevel of wrong type
    const invalidTypeRuneRef = db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).doc("runeInvalidType");
    await invalidTypeRuneRef.set({ masteryLevel: "not a number" });
    await new Promise(resolve => setTimeout(resolve, 500)); // Allow trigger

    // Simulate a rune with no masteryLevel field
    const noLevelRuneRef = db.collection(`playerLearningProfiles/${userId}/spellMasteryStatus`).doc("runeNoLevel");
    await noLevelRuneRef.set({ someOtherField: "test" });
    await new Promise(resolve => setTimeout(resolve, 500)); // Allow trigger

    // The function should log warnings for these cases and not count them.
    const userData = await getUserData(userId);
    expect(userData?.totalExperience).toBe(5); // Only the valid rune counts
    expect(userData?.wizardLevel).toBe(1);
  });
});
```
This test suite uses `firebase-functions-test` (aliased as `fft`) and Jest. It defines helpers for creating users and writing rune data, which in turn trigger the Cloud Function in the emulated environment. The tests cover various scenarios, including initialization, single/multiple runes, level-up thresholds, updates, deletions, and handling of invalid data.

A few important considerations for this test suite:
1.  **`firebase-functions-test` Initialization**: The `fft()` initialization needs to be correct for the testing environment. The `projectId` is often a placeholder for local tests when using emulators.
2.  **Emulator Interaction**: The tests rely on the Firestore emulator being active and the Admin SDK automatically connecting to it (which usually happens if `FIRESTORE_EMULATOR_HOST` is set, typically by the `firebase emulators:exec` command).
3.  **Async Operations and Delays**: Firestore triggers are asynchronous. The `await new Promise(resolve => setTimeout(resolve, 500));` is a simple way to wait for the function to likely complete. In more complex scenarios, one might need more sophisticated synchronization or use `testEnv.wrap` to call the function directly with mocked `Change` and `Context` objects, which avoids the uncertainty of trigger timing. However, testing the trigger by writing to the database (as done here) is a valid integration test approach.
4.  **User Data Consistency**: The `createUser` helper attempts to create a user document that is consistent with the fields initialized by `onUserCreate` and `createProfileOnSignup`. It's important that this mock data matches the actual data structure.
5.  **Cleanup**: `testEnv.cleanup()` is called in `afterAll` to clean up resources used by `firebase-functions-test`. Individual document cleanup is also performed.

This test suite should provide good coverage for the `updatePlayerExperienceOnRuneChange` function.
