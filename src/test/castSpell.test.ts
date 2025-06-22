import * as admin from "firebase-admin";
import testFunctions from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";
import { Game, Player } from "../types"; // Assurez-vous que le chemin est correct

// Initialiser firebase-functions-test
const testEnv = testFunctions({
  projectId: "korean-party-dev", // Remplacez par votre ID de projet réel ou un ID de projet de test
}, /* Pas de fichier service-account.json nécessaire pour les émulateurs */);

// Importer les fonctions Cloud après l'initialisation de testEnv
import { castSpell } from "../index"; // Assurez-vous que le chemin est correct

// Helper pour l'émulateur Firestore
const FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

// Instance de Firestore pour les tests
let db: admin.firestore.Firestore;

// Données de test
const GAME_ID = "testGame123";
const PLAYER_A_UID = "playerAuid";
const PLAYER_B_UID = "playerBuid";

const initialPlayerA: Player = {
  uid: PLAYER_A_UID,
  displayName: "Player A",
  mana: 100,
  position: 0,
  grimoires: [],
  groundHeight: 0,
  blocks: [],
};

const initialPlayerB: Player = {
  uid: PLAYER_B_UID,
  displayName: "Player B",
  mana: 100,
  position: 1,
  grimoires: [],
  groundHeight: 0,
  blocks: [],
};

const initialGameData: Partial<Game> = {
  // id: GAME_ID, // L'ID est le nom du document
  name: "Test Game",
  hostId: PLAYER_A_UID,
  status: "playing",
  players: [initialPlayerA, initialPlayerB],
  currentPlayerId: PLAYER_A_UID,
  turnState: "AWAITING_ROLL",
  board: [{ type: "SAFE_ZONE" }, { type: "SAFE_ZONE" }], // Plateau simple pour le test
};

// Configuration avant tous les tests
beforeAll(async () => {
  // admin.initializeApp() est généralement appelé dans votre index.ts.
  // Si vous l'appelez ici aussi, assurez-vous que ce n'est pas redondant
  // ou qu'il est géré correctement (par exemple, vérifier si une app existe déjà).
  // Pour les tests avec émulateurs, firebase-functions-test s'en charge souvent.
  // db = admin.firestore(); // Initialisé après l'initialisation de l'app par testEnv
});

// Nettoyage avant chaque test
beforeEach(async () => {
  // Initialiser la base de données émulée avec un état de partie
  // Note: testEnv.firestore.clearFirestoreData n'existe pas. Utilisez admin.firestore().collection().delete()
  // ou une fonction helper pour nettoyer les collections.
  // Pour l'instant, on va juste s'assurer que le document de jeu est (ré)initialisé.
  if (!admin.apps.length) {
     admin.initializeApp({ projectId: "korean-party-dev" }); // Assurez-vous que projectId correspond
  }
  db = admin.firestore();

  // Effacer les données de test précédentes s'il y en a
  const gameRef = db.collection("games").doc(GAME_ID);
  await gameRef.delete().catch(() => {}); // Ignore delete errors if doc doesn't exist

  // Créer les données de jeu initiales
  await gameRef.set(initialGameData);

  // Initialiser les profils utilisateurs si nécessaire pour les stats
  const playerARef = db.collection("users").doc(PLAYER_A_UID);
  await playerARef.set({ displayName: "Player A", stats: { spellsCast: 0 } }).catch(() => {});
  const playerBRef = db.collection("users").doc(PLAYER_B_UID);
  await playerBRef.set({ displayName: "Player B" }).catch(() => {});
});

// Nettoyage après tous les tests
afterAll(async () => {
  testEnv.cleanup();
  // Vous pouvez aussi supprimer les données de la base de données ici
  const gameRef = db.collection("games").doc(GAME_ID);
  await gameRef.delete().catch(() => {});
  await db.collection("users").doc(PLAYER_A_UID).delete().catch(() => {});
  await db.collection("users").doc(PLAYER_B_UID).delete().catch(() => {});
});


describe("castSpell Cloud Function", () => {
  describe("MANA_STEAL spell", () => {
    it("should allow Player A to steal mana from Player B", async () => {
      const wrappedCastSpell = testEnv.wrap(castSpell);

      // Simuler l'appel en tant que Player A
      const context = { auth: { uid: PLAYER_A_UID, token: {} as admin.auth.DecodedIdToken } };
      const data = {
        gameId: GAME_ID,
        spellId: "MANA_STEAL",
        targetId: PLAYER_B_UID,
      };

      await wrappedCastSpell({ data: data, auth: context.auth });

      // Vérifier l'état de la base de données
      const gameDoc = await db.collection("games").doc(GAME_ID).get();
      const gameData = gameDoc.data() as Game;

      const playerA = gameData.players.find(p => p.uid === PLAYER_A_UID);
      const playerB = gameData.players.find(p => p.uid === PLAYER_B_UID);

      // Le sort coûte 25 Mana, vole 20 Mana.
      // Joueur A: 100 - 25 (coût) + 20 (volé) = 95
      // Joueur B: 100 - 20 (volé) = 80
      expect(playerA?.mana).toBe(95);
      expect(playerB?.mana).toBe(80);

      // Vérifier que la stat spellsCast a été incrémentée pour le joueur A
      const playerAProfile = await db.collection("users").doc(PLAYER_A_UID).get();
      expect(playerAProfile.data()?.stats.spellsCast).toBe(1);
    });

    it("should not allow stealing more mana than the target has", async () => {
      // Modifier le mana initial du joueur B
      const lowManaPlayerB: Player = { ...initialPlayerB, mana: 10 };
      await db.collection("games").doc(GAME_ID).update({
        players: [initialPlayerA, lowManaPlayerB],
      });

      const wrappedCastSpell = testEnv.wrap(castSpell);
      const context = { auth: { uid: PLAYER_A_UID, token: {} as admin.auth.DecodedIdToken } };
      const data = {
        gameId: GAME_ID,
        spellId: "MANA_STEAL",
        targetId: PLAYER_B_UID,
      };

      await wrappedCastSpell({data: data, auth: context.auth });

      const gameDoc = await db.collection("games").doc(GAME_ID).get();
      const gameData = gameDoc.data() as Game;
      const playerA = gameData.players.find(p => p.uid === PLAYER_A_UID);
      const playerB = gameData.players.find(p => p.uid === PLAYER_B_UID);

      // Joueur A: 100 - 25 (coût) + 10 (volé, car Joueur B n'a que 10) = 85
      // Joueur B: 10 - 10 (volé) = 0
      expect(playerA?.mana).toBe(85);
      expect(playerB?.mana).toBe(0);
    });

    it("should throw an error if caster targets self", async () => {
        const wrappedCastSpell = testEnv.wrap(castSpell);
        const context = { auth: { uid: PLAYER_A_UID, token: {} as admin.auth.DecodedIdToken } };
        const data = {
          gameId: GAME_ID,
          spellId: "MANA_STEAL",
          targetId: PLAYER_A_UID, // Caster cible soi-même
        };

        await expect(wrappedCastSpell({ data: data, auth: context.auth })).rejects.toThrow(
            new HttpsError("invalid-argument", "Ne peut pas se cibler soi-même avec MANA_STEAL.")
        );
    });

    it("should throw an error if caster has insufficient mana", async () => {
        // Modifier le mana initial du joueur A
        const lowManaPlayerA: Player = { ...initialPlayerA, mana: 10 }; // Coût du sort est 25
        await db.collection("games").doc(GAME_ID).update({
          players: [lowManaPlayerA, initialPlayerB],
        });

        const wrappedCastSpell = testEnv.wrap(castSpell);
        const context = { auth: { uid: PLAYER_A_UID, token: {} as admin.auth.DecodedIdToken } };
        const data = {
          gameId: GAME_ID,
          spellId: "MANA_STEAL",
          targetId: PLAYER_B_UID,
        };

        await expect(wrappedCastSpell({ data: data, auth: context.auth })).rejects.toThrow(
          new HttpsError("failed-precondition", "Mana insuffisant.")
        );
      });
  });
  // Ajoutez d'autres `describe` pour d'autres sorts si nécessaire
});
