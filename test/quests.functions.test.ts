import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestContext,
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";
import { describe, it, before, after, beforeEach } from "mocha";
import { expect } from "chai";
import firebase from "firebase/compat/app"; // Pour les types Firestore
import "firebase/compat/firestore";
import * as admin from "firebase-admin"; // Importer le SDK Admin

// Configuration de l'émulateur Firestore
const PROJECT_ID = "firestore-emulator-example"; // Utilisez un ID de projet cohérent
// process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; // Assurez-vous que l'émulateur est ciblé par le SDK Admin
const COVERAGE_URL = `http://localhost:8080/emulator/v1/projects/${PROJECT_ID}:ruleCoverage.html`;

// Interface pour une Quête (simplifiée pour les tests)
interface Quest {
  id: string;
  title: string;
  description: string;
  rewards: {
    xp?: number;
    // autres récompenses...
  };
  objectives: Array<{
    description: string;
    target: number;
    type: string; // ex: "minigame_food"
  }>;
}

// Interface pour le profil d'un joueur (simplifiée)
interface PlayerProfile {
  userId: string;
  xp: number;
  // autres champs...
}

// Interface pour une quête active d'un joueur
interface PlayerQuestActive {
  questId: string;
  progress: number;
  currentStep: number; // Pour les quêtes à étapes multiples, si applicable
  // autres données de suivi...
}

// Interface pour une quête complétée d'un joueur
interface PlayerQuestCompleted {
  questId: string;
  completedAt: Date; // ou Firebase Timestamp
  // autres données...
}


// --- Définition des données de test ---
const QUEST_FOOD_1_ID = "QUEST_FOOD_1";
const QUEST_FOOD_1_DATA: Quest = {
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
      type: "minigame_food",
    },
  ],
};

const USER_ID_ALICE = "alice";
const USER_ID_BOB = "bob";

// Helper pour initialiser l'environnement de test Firestore
// Ces fonctions dépendent de `testEnv` qui sera initialisé dans le `before` hook.
let getTestFirestore: any; // Sera assignée dans le before hook
let getAdminFirestore: any; // Sera assignée dans le before hook


describe("Gestion des Quêtes - Cloud Functions (Tests Unitaires)", () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    testEnv = await initializeTestEnvironment({ // Utilisation de la fonction importée directement
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8"), // Chemin relatif à la racine du projet
        host: "localhost",
        port: 8080,
      },
    });

    // Initialiser les helpers ici, une fois que testEnv est disponible
    getTestFirestore = (auth?: { uid: string; [key: string]: any }) => {
      if (auth && auth.uid) {
        return testEnv.authenticatedContext(auth.uid).firestore();
      } else {
        return testEnv.unauthenticatedContext().firestore();
      }
    };

    // Initialiser une app admin pour getAdminFirestore
    // Vérifier si l'app admin existe déjà pour éviter les erreurs de réinitialisation
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: PROJECT_ID }); // Pointe vers l'émulateur si FIRESTORE_EMULATOR_HOST est défini
    }

    getAdminFirestore = () => {
      return admin.firestore();
    };
  });

  after(async () => {
    await testEnv.cleanup();
    // Nettoyer aussi l'app admin si elle a été initialisée
    // await admin.app().delete(); // Peut causer des problèmes si d'autres tests tournent en parallèle
    console.log(`View rule coverage information at ${COVERAGE_URL}`);
  });

  beforeEach(async () => {
    await testEnv.clearFirestore(); // Efface les données via l'environnement de test (respecte les règles pour clear)

    // Pour vider la base de données via admin (si clearFirestore n'est pas suffisant ou pour être sûr)
    // Cette opération est plus lourde et généralement pas nécessaire si testEnv.clearFirestore() fonctionne.
    // await clearFirestoreWithAdmin();

    // Exemple de pré-remplissage si nécessaire, en utilisant l'accès "admin"
    // const adminDb = getAdminFirestore();
    // await adminDb.collection("quests").doc(QUEST_FOOD_1_ID).set(QUEST_FOOD_1_DATA);
  });

// Optionnel: Helper pour vider Firestore avec le SDK Admin (plus robuste que clearFirestore pour certains cas)
// async function clearFirestoreWithAdmin() {
//   const adminDb = getAdminFirestore();
//   const collections = await adminDb.listCollections();
//   for (const collection of collections) {
//     const snapshot = await collection.get();
//     const batch = adminDb.batch();
//     snapshot.docs.forEach(doc => batch.delete(doc.ref));
//     await batch.commit();
//   }
// }

  // --- Les tests seront ajoutés ici ---

  describe("Scénario 1: Acceptation de la Quête", () => {
    it("devrait permettre à un joueur d'accepter une quête et de la voir dans son journal", async () => {
      const userId = USER_ID_ALICE;
      const db = getTestFirestore({ uid: userId }); // Simule un utilisateur authentifié

      // ARRANGE: Initialiser le profil du joueur (si nécessaire pour la fonction acceptQuest)
      // Pour ce test, nous supposons que le profil existe ou que acceptQuest le crée/gère.
      // On pourrait pré-remplir le profil utilisateur ici si la fonction l'exigeait.
      // const userProfileRef = db.collection("users").doc(userId);
      // await userProfileRef.set({ userId: userId, xp: 0, name: "Alice" });

      // Pré-configurer la quête globale si elle n'est pas déjà dans la base de données
      // (dans un vrai scénario, cela pourrait être fait par un script de seeding ou manuellement)
      const adminDb = getAdminFirestore();
      await adminDb.collection("quests").doc(QUEST_FOOD_1_ID).set(QUEST_FOOD_1_DATA);


      // ACT: Simuler l'appel à la future Cloud Function acceptQuest
      // Puisque la fonction n'existe pas, nous allons directement vérifier l'état attendu
      // ou, si nous avions un client de fonctions, nous appellerions:
      // const functions = testEnv.functions(); // Nécessite une configuration plus poussée
      // try {
      //   await functions.httpsCallable('acceptQuest')({ questId: QUEST_FOOD_1_ID });
      // } catch (e) {
      //   // On s'attend à une erreur car la fonction n'est pas implémentée
      //   // console.log("Erreur attendue car acceptQuest n'est pas implémentée:", e.message);
      // }
      // Pour ce test TDD, nous allons directement vérifier l'effet attendu qui devrait échouer.

      // ASSERT (doit échouer car la logique n'existe pas encore)
      const playerQuestDocRef = db.collection("playerQuests").doc(userId)
                                  .collection("activeQuests").doc(QUEST_FOOD_1_ID);

      const playerQuestDoc = await playerQuestDocRef.get();

      // Ce test est conçu pour échouer ici initialement
      expect(playerQuestDoc.exists, `Le document de quête active pour ${QUEST_FOOD_1_ID} devrait exister`).to.be.true;
      expect(playerQuestDoc.data()).to.deep.equal({
        questId: QUEST_FOOD_1_ID, // On peut aussi stocker l'ID pour redondance/facilité
        progress: 0,
        currentStep: 0,
      });
    });
  });

  describe("Scénario 2: Progression de la Quête", () => {
    it("devrait mettre à jour la progression d'une quête après une action pertinente", async () => {
      const userId = USER_ID_ALICE;
      const db = getTestFirestore({ uid: userId });
      const adminDb = getAdminFirestore();

      // ARRANGE:
      // 1. Quête globale existe
      await adminDb.collection("quests").doc(QUEST_FOOD_1_ID).set(QUEST_FOOD_1_DATA);
      // 2. Le joueur a la QUEST_FOOD_1 active avec progress: 1
      const playerQuestDocRef = db.collection("playerQuests").doc(userId)
                                  .collection("activeQuests").doc(QUEST_FOOD_1_ID);
      const initialPlayerQuestData: PlayerQuestActive = {
        questId: QUEST_FOOD_1_ID,
        progress: 1,
        currentStep: 0, // ou l'étape correspondante si la quête a plusieurs étapes
      };
      await playerQuestDocRef.set(initialPlayerQuestData);

      // 3. (Optionnel) Profil du joueur existe
      // await db.collection("users").doc(userId).set({ userId: userId, xp: 0, name: "Alice" });

      // ACT: Simuler l'appel à la future fonction submitMiniGameOrChallengeResults
      // qui devrait, à terme, déclencher la mise à jour de la quête.
      // Comme pour acceptQuest, nous allons directement vérifier l'effet attendu.
      // Exemple d'appel (si la fonction existait):
      // const functions = testEnv.functions();
      // try {
      //   await functions.httpsCallable('submitMiniGameOrChallengeResults')({
      //     miniGameId: "some_food_minigame_id",
      //     score: 100, // score suffisant pour valider
      //     theme: QUEST_FOOD_1_DATA.objectives[0].type // "minigame_food"
      //   });
      // } catch (e) {
      //   // console.log("Erreur attendue car submitMiniGameOrChallengeResults n'est pas implémentée:", e.message);
      // }

      // ASSERT (doit échouer car la logique de progression n'existe pas encore)
      const updatedPlayerQuestDoc = await playerQuestDocRef.get();

      // Ce test est conçu pour échouer ici initialement (updatedPlayerQuestDoc.data().progress ne sera pas 2)
      expect(updatedPlayerQuestDoc.exists, "Le document de quête active devrait toujours exister").to.be.true;
      expect(updatedPlayerQuestDoc.data()?.progress, "La progression de la quête aurait dû être mise à jour à 2").to.equal(2);
    });
  });

  describe("Scénario 3: Achèvement de la Quête", () => {
    it("devrait accorder des récompenses et marquer la quête comme terminée", async () => {
      const userId = USER_ID_ALICE;
      const initialXp = 50;
      const questRewardXp = QUEST_FOOD_1_DATA.rewards.xp || 0;
      const finalXp = initialXp + questRewardXp;

      const db = getTestFirestore({ uid: userId });
      const adminDb = getAdminFirestore();

      // ARRANGE:
      // 1. Quête globale existe avec ses récompenses
      await adminDb.collection("quests").doc(QUEST_FOOD_1_ID).set(QUEST_FOOD_1_DATA);

      // 2. Profil du joueur existe avec XP initial
      const userProfileRef = db.collection("users").doc(userId);
      await userProfileRef.set({ userId: userId, xp: initialXp, name: "Alice" });

      // 3. Le joueur a la QUEST_FOOD_1 active avec progress: 2 (objectif est 3)
      const playerActiveQuestDocRef = db.collection("playerQuests").doc(userId)
                                        .collection("activeQuests").doc(QUEST_FOOD_1_ID);
      const presqueCompleteQuestData: PlayerQuestActive = {
        questId: QUEST_FOOD_1_ID,
        progress: 2,
        currentStep: 0, // Supposant un objectif de 3 basé sur QUEST_FOOD_1_DATA.objectives[0].target
      };
      await playerActiveQuestDocRef.set(presqueCompleteQuestData);

      // ACT: Simuler à nouveau la réussite d'un mini-jeu de nourriture (l'action qui complète la quête)
      // Comme précédemment, nous vérifions directement les effets attendus.
      // try {
      //   const functions = testEnv.functions();
      //   await functions.httpsCallable('submitMiniGameOrChallengeResults')({
      //     miniGameId: "another_food_minigame_id",
      //     score: 100,
      //     theme: QUEST_FOOD_1_DATA.objectives[0].type
      //   });
      // } catch (e) {
      //   // console.log("Erreur attendue car submitMiniGameOrChallengeResults n'est pas implémentée:", e.message);
      // }

      // ASSERT (toutes ces assertions doivent échouer initialement)

      // 1. Vérifier que le document activeQuests/QUEST_FOOD_1 a été supprimé.
      const activeQuestDoc = await playerActiveQuestDocRef.get();
      expect(activeQuestDoc.exists, "La quête active aurait dû être supprimée").to.be.false;

      // 2. Vérifier qu'un document a été créé dans playerQuests/{userId}/completedQuests/QUEST_FOOD_1.
      const completedQuestDocRef = db.collection("playerQuests").doc(userId)
                                     .collection("completedQuests").doc(QUEST_FOOD_1_ID);
      const completedQuestDoc = await completedQuestDocRef.get();
      expect(completedQuestDoc.exists, "La quête aurait dû être marquée comme complétée").to.be.true;
      // On pourrait aussi vérifier le contenu, par ex. la date d'achèvement si elle est stockée.
      // expect(completedQuestDoc.data()?.completedAt).to.exist;

      // 3. Vérifier que le profil du joueur (users/{userId}) a été mis à jour et que son champ xp est maintenant égal à 75.
      const userProfileDoc = await userProfileRef.get();
      expect(userProfileDoc.exists, "Le profil utilisateur devrait exister").to.be.true;
      expect(userProfileDoc.data()?.xp, `L'XP du joueur aurait dû être ${finalXp}`).to.equal(finalXp);
    });
  });
});

// Placeholder pour les futures fonctions (simulées pour l'instant)
// Ces fonctions ne seront pas implémentées ici, mais les tests les appelleront.
// Dans un vrai scénario, elles seraient dans votre code Cloud Functions (ex: src/index.ts)

// async function acceptQuest(data: { questId: string }, context: any) {
//   // Logique (future) pour accepter une quête
//   // Pour les tests, nous allons directement manipuler la DB pour simuler l'appel
//   // ou espérer que la fonction (non existante) échoue comme prévu.
//   console.log("Simulating acceptQuest call with:", data, "by user:", context.auth.uid);
//   throw new Error("acceptQuest function not implemented");
// }

// async function submitMiniGameOrChallengeResults(data: { miniGameId: string; score: number; theme?: string }, context: any) {
//   // Logique (future) pour traiter les résultats d'un mini-jeu
//   // et potentiellement mettre à jour la progression des quêtes.
//   console.log("Simulating submitMiniGameOrChallengeResults call with:", data, "by user:", context.auth.uid);
//   throw new Error("submitMiniGameOrChallengeResults function not implemented");
// }

// Pour que TypeScript ne se plaigne pas du fichier vide au début
export {};
