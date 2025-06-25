import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import { describe, it, before, after, beforeEach, afterEach } from "mocha";
import { expect } from "chai";

import { initializeApp, FirebaseApp, deleteApp } from "firebase/app";
import { getFirestore, doc, getDoc, Firestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable, Functions } from "firebase/functions";
import { getAuth, connectAuthEmulator, signInWithCustomToken, Auth } from "firebase/auth";

import * as admin from "firebase-admin";

import { PlayerActiveQuest, QuestDefinition, UserProfile } from "../src/types";

// Configuration
const PROJECT_ID = "firestore-emulator-example";
const COVERAGE_URL = `http://localhost:8080/emulator/v1/projects/${PROJECT_ID}:ruleCoverage.html`;

const QUEST_FOOD_1_ID = "QUEST_FOOD_1";
const QUEST_FOOD_1_DATA: QuestDefinition = {
  id: QUEST_FOOD_1_ID,
  title: "Maîtrise Culinaire",
  description: "Réussir 3 mini-jeux sur le thème de la nourriture.",
  rewards: {
    xp: 25,
  },
  objectives: [
    {
      description: "Réussir 3 mini-jeux sur le thème de la nourriture",
      target: 3,
      type: "minigame_food_completed",
    },
  ],
};

const USER_ID_ALICE = "alice";


let testEnv: RulesTestEnvironment;
let adminFirestore: admin.firestore.Firestore;

let aliceApp: FirebaseApp;
let aliceFunctions: Functions;
let aliceDb: Firestore;


describe("Gestion des Quêtes - Cloud Functions (Tests Unitaires)", () => {
  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8"),
        host: "localhost",
        port: 8080,
      },
    });

    if (!admin.apps.length) {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
    adminFirestore = admin.firestore();
  });

  after(async () => {
    await testEnv.cleanup();
    const allApps = admin.apps.slice();
    for (const app of allApps) {
      if (app) await app.delete();
    }
    console.log(`View rule coverage information at ${COVERAGE_URL}`);
  });

  beforeEach(async () => {
    const collections = await adminFirestore.listCollections();
    for (const coll of collections) {
      const docs = await coll.get();
      const batch = adminFirestore.batch();
      docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    const firebaseConfig = { projectId: PROJECT_ID, apiKey: "test-api-key" };
    aliceApp = initializeApp(firebaseConfig, `alice-app-${USER_ID_ALICE}-${Date.now()}`);

    const authInstance: Auth = getAuth(aliceApp);
    connectAuthEmulator(authInstance, "http://localhost:9099", { disableWarnings: true });

    try {
      const customToken = await admin.auth().createCustomToken(USER_ID_ALICE);
      await signInWithCustomToken(authInstance, customToken);
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(`Erreur lors de l'authentification d'Alice (${USER_ID_ALICE}): ${error.message}`);
      } else {
        console.error(`Erreur lors de l'authentification d'Alice (${USER_ID_ALICE}):`, error);
      }
    }

    aliceFunctions = getFunctions(aliceApp, "europe-west1");
    connectFunctionsEmulator(aliceFunctions, "localhost", 5001);

    aliceDb = getFirestore(aliceApp);
    connectFirestoreEmulator(aliceDb, "localhost", 8080);

    const questDefRef = adminFirestore.collection("questDefinitions").doc(QUEST_FOOD_1_ID);
    await questDefRef.set(QUEST_FOOD_1_DATA);
  });

  afterEach(async () => {
    if (aliceApp) await deleteApp(aliceApp);
  });


  describe("Scénario 1: Acceptation de la Quête", () => {
    it("devrait permettre à un joueur d'accepter une quête et de la voir dans son journal", async () => {
      const userId = USER_ID_ALICE;
      const acceptQuestCallable = httpsCallable(aliceFunctions, "acceptQuest");
      await acceptQuestCallable({ questId: QUEST_FOOD_1_ID });

      const playerQuestDocRef = doc(aliceDb, "playerQuests", userId, "activeQuests", QUEST_FOOD_1_ID);
      const playerQuestDoc = await getDoc(playerQuestDocRef);

      expect(playerQuestDoc.exists(), `Le document de quête active pour ${QUEST_FOOD_1_ID} devrait exister`).to.be.true;
      const questData = playerQuestDoc.data() as PlayerActiveQuest;
      expect(questData.questId).to.equal(QUEST_FOOD_1_ID);
      expect(questData.progress).to.equal(0);
      expect(questData.currentStep).to.equal(0);
      expect(questData.startedAt).to.exist;
    });
  });

  describe("Scénario 2: Progression de la Quête", () => {
    it("devrait mettre à jour la progression d'une quête après une action pertinente", async () => {
      const userId = USER_ID_ALICE;

      const playerQuestDocRefAdmin = adminFirestore.collection("playerQuests").doc(userId)
        .collection("activeQuests").doc(QUEST_FOOD_1_ID);
      const initialPlayerQuestData: Partial<PlayerActiveQuest> = {
        questId: QUEST_FOOD_1_ID,
        progress: 1,
        currentStep: 0,
        startedAt: admin.firestore.Timestamp.now(),
      };
      await playerQuestDocRefAdmin.set(initialPlayerQuestData);

      // ACT: Appeler submitGameAction
      const submitActionCallable = httpsCallable(aliceFunctions, "submitGameAction");
      await submitActionCallable({ actionType: "minigame_food_completed", actionDetails: {} });

      const playerQuestDocRef = doc(aliceDb, "playerQuests", userId, "activeQuests", QUEST_FOOD_1_ID);
      const updatedPlayerQuestDoc = await getDoc(playerQuestDocRef);

      expect(updatedPlayerQuestDoc.exists(), "Le document de quête active devrait toujours exister").to.be.true;
      expect(
        updatedPlayerQuestDoc.data()?.progress,
        "La progression de la quête aurait dû être mise à jour à 2"
      ).to.equal(2);
    });
  });

  describe("Scénario 3: L'Achèvement de la Quête", () => {
    it("devrait accorder des récompenses et marquer la quête comme terminée", async () => {
      const userId = USER_ID_ALICE;
      const initialXp = 50;
      const questRewardXp = QUEST_FOOD_1_DATA.rewards.xp || 0;
      const finalXp = initialXp + questRewardXp;

      const userProfileRefAdmin = adminFirestore.collection("users").doc(userId);
      await userProfileRefAdmin.set({
        userId: userId,
        xp: initialXp,
        displayName: "Alice",
        email: "alice@example.com",
        level: 1,
        manaCurrent: 100,
        manaMax: 100,
        fragments: { vocab: 0, grammar: 0, culture: 0 },
        createdAt: admin.firestore.Timestamp.now(),
        stats: {
          gamesPlayed: 0,
          gamesWon: 0,
          duelsWon: 0,
          spellsCast: 0,
          grimoiresCollected: 0,
          wordsTypedInTyphoon: 0,
          perfectQuizzes: 0,
        },
        ownedCosmetics: [],
        equippedCosmetics: {
          outfit: null,
          pet: null,
          spellEffect: null,
        },
      } as UserProfile);

      const playerActiveQuestDocRefAdmin = adminFirestore.collection("playerQuests").doc(userId)
        .collection("activeQuests").doc(QUEST_FOOD_1_ID);
      const presqueCompleteQuestData: Partial<PlayerActiveQuest> = {
        questId: QUEST_FOOD_1_ID,
        progress: 2,
        currentStep: 0,
        startedAt: admin.firestore.Timestamp.now(),
      };
      await playerActiveQuestDocRefAdmin.set(presqueCompleteQuestData);

      // ACT: Appeler submitGameAction pour compléter la quête
      const submitActionCallable = httpsCallable(aliceFunctions, "submitGameAction");
      await submitActionCallable({ actionType: "minigame_food_completed", actionDetails: {} });

      const activeQuestDocRef = doc(aliceDb, "playerQuests", userId, "activeQuests", QUEST_FOOD_1_ID);
      const activeQuestDoc = await getDoc(activeQuestDocRef);
      expect(activeQuestDoc.exists(), "La quête active aurait dû être supprimée").to.be.false;

      const completedQuestDocRef = doc(aliceDb, "playerQuests", userId, "completedQuests", QUEST_FOOD_1_ID);
      const completedQuestDoc = await getDoc(completedQuestDocRef);
      expect(completedQuestDoc.exists(), "La quête aurait dû être marquée comme complétée").to.be.true;

      const userProfileRef = doc(aliceDb, "users", userId);
      const userProfileDoc = await getDoc(userProfileRef);
      expect(userProfileDoc.exists(), "Le profil utilisateur devrait exister").to.be.true;
      expect(userProfileDoc.data()?.xp, `L'XP du joueur aurait dû être ${finalXp}`).to.equal(finalXp);
    });
  });
});

export {};
