import * as admin from "firebase-admin";
import testFunctions from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";
import { SrsItem } from "../types"; // Assurez-vous que le chemin est correct

// Initialiser firebase-functions-test
const testEnv = testFunctions({
  projectId: "korean-party-dev",
}, /* Pas de service-account.json pour les émulateurs */);

// Importer la fonction Cloud après l'initialisation de testEnv
import { submitSrsReview } from "../index"; // Assurez-vous que le chemin est correct

// Helper pour l'émulateur Firestore
const FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

let db: admin.firestore.Firestore;

const USER_UID = "srsUser123";
const SRS_ITEM_ID = "srsItemABC";

const initialSrsItemData: SrsItem = {
  id: SRS_ITEM_ID,
  userId: USER_UID,
  content: "안녕하세요",
  lastReviewedAt: null,
  // Pour le premier test, on veut un item "nouveau" ou dont l'intervalle est 0
  nextReviewTimestamp: admin.firestore.Timestamp.now(), // Prêt à être revu
  interval: 0, // Intervalle initial avant la première révision
  easeFactor: 2.5,
};

beforeAll(() => {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "korean-party-dev" });
  }
  db = admin.firestore();
});

beforeEach(async () => {
  // Nettoyer et initialiser les données de test
  const userSrsCollection = db.collection("users").doc(USER_UID).collection("srsItems");

  // Supprimer l'item précédent s'il existe
  await userSrsCollection.doc(SRS_ITEM_ID).delete().catch(() => {});

  // Créer l'item SRS initial pour le test
  // Copier initialSrsItemData pour éviter les modifications persistantes entre les tests
  const currentSrsItemData = { ...initialSrsItemData, nextReviewTimestamp: admin.firestore.Timestamp.now(), interval: 0, easeFactor: 2.5 };
  await userSrsCollection.doc(SRS_ITEM_ID).set(currentSrsItemData);

  // Assurer que l'utilisateur existe (nécessaire si la fonction vérifie le doc utilisateur)
  await db.collection("users").doc(USER_UID).set({ displayName: "SRS User" }).catch(() => {});
});

afterAll(async () => {
  testEnv.cleanup();
  // Nettoyer la base de données
  await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).delete().catch(() => {});
  await db.collection("users").doc(USER_UID).delete().catch(() => {});
});

describe("submitSrsReview Cloud Function", () => {
  const wrappedSubmitSrsReview = testEnv.wrap(submitSrsReview);

  it("should update nextReviewTimestamp and interval correctly for a correct answer on a new item", async () => {
    const context = { auth: { uid: USER_UID, token: {} as admin.auth.DecodedIdToken } };
    const data = { srsItemId: SRS_ITEM_ID, wasCorrect: true };

    const initialDoc = await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).get();
    const initialTimestampMillis = initialDoc.data()?.nextReviewTimestamp.toMillis();

    const result = await wrappedSubmitSrsReview({ data: data, auth: context.auth });

    const srsItemDoc = await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).get();
    const srsItemData = srsItemDoc.data() as SrsItem;

    expect(result.success).toBe(true);
    expect(srsItemData.interval).toBe(1); // Premier interval après correct: 1 jour

    const expectedNextReviewMillis = srsItemData.lastReviewedAt!.toMillis() + (1 * 24 * 60 * 60 * 1000);
    expect(srsItemData.nextReviewTimestamp.toMillis()).toBe(expectedNextReviewMillis);
    expect(srsItemData.lastReviewedAt).not.toBeNull();
  });

  it("should update nextReviewTimestamp and interval correctly for a second correct answer", async () => {
    // Simuler une première réponse correcte
    let srsItem = (await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).get()).data() as SrsItem;
    srsItem.interval = 1; // Intervalle après la première réponse correcte
    srsItem.lastReviewedAt = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000); // Revu hier
    srsItem.nextReviewTimestamp = admin.firestore.Timestamp.now(); // Prêt pour la révision
    await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).set(srsItem);

    const context = { auth: { uid: USER_UID, token: {} as admin.auth.DecodedIdToken } };
    const data = { srsItemId: SRS_ITEM_ID, wasCorrect: true };

    await wrappedSubmitSrsReview({ data: data, auth: context.auth });

    const updatedSrsItemDoc = await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).get();
    const updatedSrsItemData = updatedSrsItemDoc.data() as SrsItem;

    expect(updatedSrsItemData.interval).toBe(6); // Deuxième intervalle correct: 6 jours
    const expectedNextReviewMillis = updatedSrsItemData.lastReviewedAt!.toMillis() + (6 * 24 * 60 * 60 * 1000);
    expect(updatedSrsItemData.nextReviewTimestamp.toMillis()).toBe(expectedNextReviewMillis);
  });


  it("should reset interval for an incorrect answer", async () => {
    // Simuler un état où l'intervalle est plus grand (ex: après plusieurs bonnes réponses)
    let srsItem = (await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).get()).data() as SrsItem;
    srsItem.interval = 10;
    srsItem.lastReviewedAt = admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 24 * 60 * 60 * 1000);
    srsItem.nextReviewTimestamp = admin.firestore.Timestamp.now();
    await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).set(srsItem);

    const context = { auth: { uid: USER_UID, token: {} as admin.auth.DecodedIdToken } };
    const data = { srsItemId: SRS_ITEM_ID, wasCorrect: false };

    await wrappedSubmitSrsReview({ data: data, auth: context.auth });

    const srsItemDoc = await db.collection("users").doc(USER_UID).collection("srsItems").doc(SRS_ITEM_ID).get();
    const srsItemData = srsItemDoc.data() as SrsItem;

    expect(srsItemData.interval).toBe(1); // L'intervalle est réinitialisé à 1
    const expectedNextReviewMillis = srsItemData.lastReviewedAt!.toMillis() + (1 * 24 * 60 * 60 * 1000);
    expect(srsItemData.nextReviewTimestamp.toMillis()).toBe(expectedNextReviewMillis);
  });

  it("should throw HttpsError if srsItemId is missing", async () => {
    const context = { auth: { uid: USER_UID, token: {} as admin.auth.DecodedIdToken } };
    const data = { wasCorrect: true }; // srsItemId manquant

    await expect(wrappedSubmitSrsReview({ data: data, auth: context.auth })).rejects.toThrow(
      new HttpsError("invalid-argument", "L'ID de l'item SRS (srsItemId) est requis.")
    );
  });

  it("should throw HttpsError if wasCorrect is missing", async () => {
    const context = { auth: { uid: USER_UID, token: {} as admin.auth.DecodedIdToken } };
    const data = { srsItemId: SRS_ITEM_ID }; // wasCorrect manquant

    await expect(wrappedSubmitSrsReview({ data: data, auth: context.auth })).rejects.toThrow(
      new HttpsError("invalid-argument", "Le champ 'wasCorrect' (booléen) est requis.")
    );
  });

  it("should throw HttpsError if user is not authenticated", async () => {
    const context = {}; // Pas d'auth
    const data = { srsItemId: SRS_ITEM_ID, wasCorrect: true };

    await expect(wrappedSubmitSrsReview({ data: data, auth: (context as any).auth })).rejects.toThrow(
      new HttpsError("unauthenticated", "Vous devez être connecté pour soumettre une révision SRS.")
    );
  });

  it("should throw HttpsError if srsItem does not exist", async () => {
    const context = { auth: { uid: USER_UID, token: {} as admin.auth.DecodedIdToken } };
    const data = { srsItemId: "nonExistentId", wasCorrect: true };

    await expect(wrappedSubmitSrsReview({ data: data, auth: context.auth })).rejects.toThrow(
      new HttpsError("not-found", `L'item SRS avec l'ID "nonExistentId" n'a pas été trouvé.`)
    );
  });
});
