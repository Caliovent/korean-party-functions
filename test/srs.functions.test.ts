import * as admin from "firebase-admin";
import * as fft from "firebase-functions-test";
import { getReviewItems, updateReviewItem } from "../src/index"; // Adjust path as needed
import { SpellMasteryItem } from "../src/types"; // Adjust path as needed

// Initialize firebase-functions-test
const testEnv = fft({
  projectId: "korean-party-srs-test", // Mock project ID
});

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- Constants for testing ---
const USER_ID = "testUserSRS";
const USER_EMAIL = "srs.user@example.com";
const DEFAULT_EASE_FACTOR_TEST = 2.5;
const INITIAL_INTERVAL_DAYS_TEST = 1;
const REVIEW_ITEMS_LIMIT_TEST = 20; // Should match the constant in src/index.ts

// --- Helper Functions ---
const createTestUser = async (userId: string = USER_ID) => {
  await db.collection("users").doc(userId).set({
    uid: userId,
    email: USER_EMAIL,
    displayName: "SRS Test User",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // Add other fields as per your UserProfile structure if needed by functions
  });
};

const cleanupTestUser = async (userId: string = USER_ID) => {
  // Delete all spellMastery items for the user
  const spellMasterySnapshot = await db.collection("users").doc(userId).collection("spellMastery").get();
  const batch = db.batch();
  spellMasterySnapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  // Delete the user
  await db.collection("users").doc(userId).delete();
};

const addSpellMasteryItem = async (userId: string, itemId: string, itemData: Partial<SpellMasteryItem>) => {
  const now = admin.firestore.Timestamp.now();
  const fullItemData: SpellMasteryItem = {
    id: itemId,
    userId: userId,
    word: `Word ${itemId}`,
    translation: `Translation for ${itemId}`,
    masteryLevel: 0,
    nextReviewDate: itemData.nextReviewDate || now, // Default to now if not provided
    easeFactor: itemData.easeFactor || DEFAULT_EASE_FACTOR_TEST,
    interval: itemData.interval || 0,
    reviews: itemData.reviews || 0,
    lapses: itemData.lapses || 0,
    lastReviewedDate: itemData.lastReviewedDate,
    ...itemData, // Override defaults with provided data
  };
  await db.collection("users").doc(userId).collection("spellMastery").doc(itemId).set(fullItemData);
  return fullItemData;
};

const getSpellMasteryItem = async (userId: string, itemId: string): Promise<SpellMasteryItem | null> => {
  const doc = await db.collection("users").doc(userId).collection("spellMastery").doc(itemId).get();
  if (!doc.exists) return null;
  return doc.data() as SpellMasteryItem;
};

// --- Test Suite ---
describe("SRS Cloud Functions", () => {
  // Wrapped functions
  const wrappedGetReviewItems = testEnv.wrap(getReviewItems);
  const wrappedUpdateReviewItem = testEnv.wrap(updateReviewItem);

  beforeAll(async () => {
    // Optional: Clear entire emulator data if needed, but cleanupTestUser should handle per-suite cleanup
  });

  afterAll(() => {
    testEnv.cleanup();
  });

  describe("getReviewItems", () => {
    beforeEach(async () => {
      await createTestUser(USER_ID);
    });

    afterEach(async () => {
      await cleanupTestUser(USER_ID);
    });

    test("should return an empty list if no items are due", async () => {
      const futureDate = admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000 * 5); // 5 days in future
      await addSpellMasteryItem(USER_ID, "item1", { nextReviewDate: futureDate });

      const result = await wrappedGetReviewItems({}, { auth: { uid: USER_ID } });
      expect(result.items).toBeInstanceOf(Array);
      expect(result.items.length).toBe(0);
    });

    test("should return items due for review, ordered by nextReviewDate", async () => {
      const pastDate1 = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000 * 2); // 2 days ago
      const pastDate2 = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000 * 1); // 1 day ago
      const futureDate = admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000 * 1); // 1 day in future

      await addSpellMasteryItem(USER_ID, "itemDue1", { nextReviewDate: pastDate1, word: "Oldest" });
      await addSpellMasteryItem(USER_ID, "itemDue2", { nextReviewDate: pastDate2, word: "Newer" });
      await addSpellMasteryItem(USER_ID, "itemFuture", { nextReviewDate: futureDate, word: "Future" });

      const result = await wrappedGetReviewItems({}, { auth: { uid: USER_ID } });
      expect(result.items.length).toBe(2);
      expect(result.items[0].id).toBe("itemDue1");
      expect(result.items[1].id).toBe("itemDue2");
      expect(result.items.every((item: any) => item.word && item.translation)).toBe(true);
    });

    test("should limit the number of returned items to REVIEW_ITEMS_LIMIT", async () => {
      for (let i = 0; i < REVIEW_ITEMS_LIMIT_TEST + 5; i++) {
        await addSpellMasteryItem(USER_ID, `item${i}`, {
          nextReviewDate: admin.firestore.Timestamp.fromMillis(Date.now() - (i + 1) * 60000) // Staggered past dates
        });
      }
      const result = await wrappedGetReviewItems({}, { auth: { uid: USER_ID } });
      expect(result.items.length).toBe(REVIEW_ITEMS_LIMIT_TEST);
    });

    test("should throw 'unauthenticated' if user is not authenticated", async () => {
      try {
        await wrappedGetReviewItems({}, {}); // No auth context
      } catch (e: any) {
        expect(e.code).toBe("unauthenticated");
      }
    });
  });

  describe("updateReviewItem", () => {
    beforeEach(async () => {
      await createTestUser(USER_ID);
    });

    afterEach(async () => {
      await cleanupTestUser(USER_ID);
    });

    test("correct answer for a new item (first review)", async () => {
      const item = await addSpellMasteryItem(USER_ID, "newItem", { masteryLevel: 0, interval: 0, easeFactor: DEFAULT_EASE_FACTOR_TEST, reviews: 0, lapses: 0 });
      const result = await wrappedUpdateReviewItem({ itemId: "newItem", isCorrect: true }, { auth: { uid: USER_ID } });
      expect(result.success).toBe(true);

      const updatedItem = await getSpellMasteryItem(USER_ID, "newItem");
      expect(updatedItem?.masteryLevel).toBe(1);
      expect(updatedItem?.interval).toBe(INITIAL_INTERVAL_DAYS_TEST);
      expect(updatedItem?.easeFactor).toBe(DEFAULT_EASE_FACTOR_TEST);
      expect(updatedItem?.reviews).toBe(1);
      expect(updatedItem?.lapses).toBe(0);
      const expectedNextReviewMillis = Date.now() + INITIAL_INTERVAL_DAYS_TEST * 24 * 60 * 60 * 1000;
      expect(updatedItem?.nextReviewDate.toMillis()).toBeGreaterThanOrEqual(expectedNextReviewMillis - 5000); // Allow 5s diff for execution time
      expect(updatedItem?.nextReviewDate.toMillis()).toBeLessThanOrEqual(expectedNextReviewMillis + 5000);
    });

    test("correct answer for an item reviewed once correctly (second review)", async () => {
      await addSpellMasteryItem(USER_ID, "item1Correct", { masteryLevel: 1, interval: INITIAL_INTERVAL_DAYS_TEST, easeFactor: DEFAULT_EASE_FACTOR_TEST, reviews: 1 });
      const result = await wrappedUpdateReviewItem({ itemId: "item1Correct", isCorrect: true }, { auth: { uid: USER_ID } });
      expect(result.success).toBe(true);

      const updatedItem = await getSpellMasteryItem(USER_ID, "item1Correct");
      expect(updatedItem?.masteryLevel).toBe(2);
      const expectedInterval = Math.ceil(INITIAL_INTERVAL_DAYS_TEST * 2.5);
      expect(updatedItem?.interval).toBe(expectedInterval);
      expect(updatedItem?.reviews).toBe(2);
    });

    test("correct answer for an item reviewed multiple times correctly (third review)", async () => {
      const initialInterval = Math.ceil(INITIAL_INTERVAL_DAYS_TEST * 2.5);
      await addSpellMasteryItem(USER_ID, "itemMultiCorrect", { masteryLevel: 2, interval: initialInterval, easeFactor: DEFAULT_EASE_FACTOR_TEST, reviews: 2 });
      const result = await wrappedUpdateReviewItem({ itemId: "itemMultiCorrect", isCorrect: true }, { auth: { uid: USER_ID } });
      expect(result.success).toBe(true);

      const updatedItem = await getSpellMasteryItem(USER_ID, "itemMultiCorrect");
      expect(updatedItem?.masteryLevel).toBe(3);
      const expectedInterval = Math.ceil(initialInterval * DEFAULT_EASE_FACTOR_TEST);
      expect(updatedItem?.interval).toBe(expectedInterval);
      expect(updatedItem?.reviews).toBe(3);
    });

    test("incorrect answer for a known item", async () => {
      const initialEaseFactor = 2.5;
      await addSpellMasteryItem(USER_ID, "itemIncorrect", { masteryLevel: 3, interval: 10, easeFactor: initialEaseFactor, reviews: 5, lapses: 0 });
      const result = await wrappedUpdateReviewItem({ itemId: "itemIncorrect", isCorrect: false }, { auth: { uid: USER_ID } });
      expect(result.success).toBe(true);

      const updatedItem = await getSpellMasteryItem(USER_ID, "itemIncorrect");
      expect(updatedItem?.masteryLevel).toBe(0);
      expect(updatedItem?.interval).toBe(INITIAL_INTERVAL_DAYS_TEST);
      expect(updatedItem?.easeFactor).toBe(Math.max(1.3, initialEaseFactor - 0.2));
      expect(updatedItem?.reviews).toBe(6);
      expect(updatedItem?.lapses).toBe(1);
    });

    test("should throw 'not-found' if item does not exist", async () => {
      try {
        await wrappedUpdateReviewItem({ itemId: "nonExistentItem", isCorrect: true }, { auth: { uid: USER_ID } });
      } catch (e: any) {
        expect(e.code).toBe("not-found");
      }
    });

    test("should throw 'unauthenticated' if user is not authenticated", async () => {
      try {
        await wrappedUpdateReviewItem({ itemId: "anyItem", isCorrect: true }, {}); // No auth context
      } catch (e: any) {
        expect(e.code).toBe("unauthenticated");
      }
    });

    test("should throw 'invalid-argument' for missing itemId", async () => {
      try {
        await wrappedUpdateReviewItem({ isCorrect: true }, { auth: { uid: USER_ID } });
      } catch (e: any) {
        expect(e.code).toBe("invalid-argument");
      }
    });

    test("should throw 'invalid-argument' for missing isCorrect", async () => {
      try {
        await wrappedUpdateReviewItem({ itemId: "anyItem" }, { auth: { uid: USER_ID } });
      } catch (e: any) {
        expect(e.code).toBe("invalid-argument");
      }
    });
  });
});
