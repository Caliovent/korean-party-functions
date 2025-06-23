import * as admin from "firebase-admin";

// Initialiser admin AVANT d'importer les modules qui pourraient l'utiliser ou le réinitialiser
if (admin.apps.length === 0) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; // Firestore
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099"; // Auth
  admin.initializeApp({
    projectId: "test-hangeul-typhoon-project",
  });
}

// MAINTENANT importer les autres modules
import {
  Game,
  Player,
  SendTyphoonAttackRequest,
  SendTyphoonAttackSuccessResponse,
  SendTyphoonAttackFailureResponse,
  TyphoonBlock
} from "./types";
// Importer sendTyphoonAttackLogic au lieu de sendTyphoonAttack
import { sendTyphoonAttackLogic } from "./index";

// Initialiser l'application admin de Firebase si ce n'est pas déjà fait
// admin est déjà importé, donc on peut l'utiliser directement.
if (admin.apps.length === 0) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  admin.initializeApp({
    projectId: "test-hangeul-typhoon-project",
  });
}

const db = admin.firestore();

interface BlockSetup {
  text: string;
  vulnerableAt: admin.firestore.Timestamp; // admin.firestore.Timestamp est correct
  isDestroyed?: boolean;
}

interface PlayerSetup {
  uid: string;
  displayName: string;
  blocks: BlockSetup[];
  groundHeight?: number;
}

/**
 * Initialise un état de duel dans l'émulateur Firestore pour les tests.
 * @param gameId L'ID du jeu de duel à créer.
 * @param player1Setup Configuration du joueur 1.
 * @param player2Setup Configuration du joueur 2.
 */
export async function setupDuelState(
  gameId: string,
  player1Setup: PlayerSetup,
  player2Setup: PlayerSetup
): Promise<void> {
  const players: Player[] = [player1Setup, player2Setup].map((setup) => ({
    uid: setup.uid,
    displayName: setup.displayName,
    position: 0, // Valeur par défaut, non pertinente pour sendTyphoonAttack
    mana: 100, // Valeur par défaut
    grimoires: [], // Valeur par défaut
    groundHeight: setup.groundHeight ?? 0,
    blocks: setup.blocks.map((b, index) => ({
      id: `block_${index}_${setup.uid}`, // ID de bloc unique
      text: b.text,
      vulnerableAt: b.vulnerableAt,
      isDestroyed: b.isDestroyed ?? false,
    })),
  }));

  const duelGame: Partial<Game> = { // Utilisation de Partial<Game> car nous ne définissons que les champs nécessaires au test
    // name: `Test Duel ${gameId}`, // Optionnel
    hostId: player1Setup.uid, // Arbitraire
    status: "playing", // Le jeu doit être en cours pour que les attaques soient valides
    players: players,
    // Les autres champs de Game ne sont pas nécessaires pour sendTyphoonAttack
  };

  await db.collection("games").doc(gameId).set(duelGame);
  console.log(`Duel state for game ${gameId} initialized in Firestore emulator.`);
}

// Les imports ont été déplacés en haut du fichier. Ces lignes sont maintenant redondantes.
// import { sendTyphoonAttack } from "./index";
// import { SendTyphoonAttackRequest, SendTyphoonAttackSuccessResponse, Player } from "./types";

const TEST_GAME_ID = "test-duel-scenario1";
const ATTACKER_UID = "player1-attacker";
const TARGET_UID = "player2-target";

describe("sendTyphoonAttack Cloud Function", () => {
  // Nettoyer la base de données après chaque test
  afterEach(async () => {
    const gameDocRef = db.collection("games").doc(TEST_GAME_ID);
    const gameDoc = await gameDocRef.get();
    if (gameDoc.exists) {
      await gameDocRef.delete();
    }
    // Vous pouvez ajouter ici le nettoyage d'autres gameId si nécessaire pour d'autres tests
  });

  test("Scénario 1: Attaque Réussie sur Bloc Vulnérable", async () => {
    // Arrange
    const vulnerableWord = "승리";
    const initialTargetGroundHeight = 10;
    const initialAttackerGroundHeight = 5;

    await setupDuelState(TEST_GAME_ID,
      { // Attaquant
        uid: ATTACKER_UID,
        displayName: "Attaquant Test",
        blocks: [{ text: "someblock", vulnerableAt: admin.firestore.Timestamp.now() }], // Blocs non pertinents pour ce test
        groundHeight: initialAttackerGroundHeight,
      },
      { // Cible
        uid: TARGET_UID,
        displayName: "Cible Test",
        blocks: [
          { text: "autrebloc", vulnerableAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 3600000)) }, // Protégé
          { text: vulnerableWord, vulnerableAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1000)) }, // Vulnérable
          { text: "encoreun", vulnerableAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 500)) }, // Autre vulnérable
        ],
        groundHeight: initialTargetGroundHeight,
      }
    );

    const attackRequestData: SendTyphoonAttackRequest = {
      gameId: TEST_GAME_ID,
      attackerPlayerId: ATTACKER_UID,
      targetPlayerId: TARGET_UID,
      attackWord: vulnerableWord,
    };

    // Act
    // Appeler la logique de la fonction directement
    const result = await sendTyphoonAttackLogic(
      attackRequestData,
      { uid: ATTACKER_UID } // Simuler le contexte d'authentification
    );

    // Assert
    // 1. Vérifier que la fonction retourne un statut success
    expect(result.status).toBe("success");
    const successResult = result as SendTyphoonAttackSuccessResponse;
    expect(successResult.message).toBe("Attack successful. Target's block destroyed.");
    expect(successResult.destroyedBlockWord).toBe(vulnerableWord);
    expect(successResult.targetGroundRiseAmount).toBeGreaterThan(0); // DEFAULT_GROUND_RISE_AMOUNT

    // 2. Vérifier que dans Firestore, le groundHeight de l'adversaire a augmenté
    const gameDoc = await db.collection("games").doc(TEST_GAME_ID).get();
    expect(gameDoc.exists).toBe(true);
    const gameData = gameDoc.data() as Game;

    const targetPlayer = gameData.players.find(p => p.uid === TARGET_UID);
    expect(targetPlayer).toBeDefined();
    expect(targetPlayer!.groundHeight).toBe(initialTargetGroundHeight + successResult.targetGroundRiseAmount);

    // 3. Vérifier que le groundHeight de l'attaquant n'a pas changé
    const attackerPlayer = gameData.players.find(p => p.uid === ATTACKER_UID);
    expect(attackerPlayer).toBeDefined();
    expect(attackerPlayer!.groundHeight).toBe(initialAttackerGroundHeight);

    // 4. Vérifier que le bloc "승리" de l'adversaire est marqué comme détruit
    const targetBlock = targetPlayer!.blocks.find(b => b.text === vulnerableWord);
    expect(targetBlock).toBeDefined();
    expect(targetBlock!.isDestroyed).toBe(true);

    // Optionnel: vérifier que les autres blocs ne sont pas détruits
    const otherBlock = targetPlayer!.blocks.find(b => b.text === "autrebloc");
    expect(otherBlock).toBeDefined();
    expect(otherBlock!.isDestroyed).toBe(false);
  });

  test("Scénario 2: Attaque Échouée sur Bloc Protégé", async () => {
    // Arrange
    const protectedWord = "방어";
    const initialTargetGroundHeight = 15;
    const initialAttackerGroundHeight = 8;

    // Utiliser des UID et GameID différents ou s'assurer d'un nettoyage correct
    // Pour l'instant, on réutilise TEST_GAME_ID car afterEach le nettoie.
    // Si les tests tournent en parallèle, il faudra des ID uniques par test.

    await setupDuelState(TEST_GAME_ID, // Réutilise TEST_GAME_ID, nettoyé par afterEach
      { // Attaquant
        uid: ATTACKER_UID,
        displayName: "Attaquant Test",
        blocks: [], // Blocs non pertinents
        groundHeight: initialAttackerGroundHeight,
      },
      { // Cible
        uid: TARGET_UID,
        displayName: "Cible Test",
        blocks: [
          { text: protectedWord, vulnerableAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600000) }, // Protégé (futur)
          { text: "vulnérable_non_cible", vulnerableAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) }, // Vulnérable
        ],
        groundHeight: initialTargetGroundHeight,
      }
    );

    const attackRequestData: SendTyphoonAttackRequest = {
      gameId: TEST_GAME_ID,
      attackerPlayerId: ATTACKER_UID,
      targetPlayerId: TARGET_UID,
      attackWord: protectedWord,
    };

    // Act
    const result = await sendTyphoonAttackLogic(
      attackRequestData,
      { uid: ATTACKER_UID }
    );

    // Assert
    // 1. Vérifier que la fonction retourne un statut failure
    expect(result.status).toBe("failure");
    const failureResult = result as SendTyphoonAttackFailureResponse;
    expect(failureResult.reason).toBe("BLOCK_NOT_VULNERABLE");
    expect(failureResult.message).toBe("Attack failed. Attacker penalized.");
    expect(failureResult.attackerPenaltyGroundRiseAmount).toBeGreaterThan(0); // DEFAULT_PENALTY_RISE_AMOUNT

    // 2. Vérifier que le groundHeight de l'attaquant a augmenté (pénalité)
    const gameDoc = await db.collection("games").doc(TEST_GAME_ID).get();
    expect(gameDoc.exists).toBe(true);
    const gameData = gameDoc.data() as Game;

    const attackerPlayer = gameData.players.find(p => p.uid === ATTACKER_UID);
    expect(attackerPlayer).toBeDefined();
    expect(attackerPlayer!.groundHeight).toBe(initialAttackerGroundHeight + failureResult.attackerPenaltyGroundRiseAmount);

    // 3. Vérifier que l'état de l'adversaire (sol et blocs) est inchangé
    const targetPlayer = gameData.players.find(p => p.uid === TARGET_UID);
    expect(targetPlayer).toBeDefined();
    expect(targetPlayer!.groundHeight).toBe(initialTargetGroundHeight); // Inchangé

    const targetBlockProtected = targetPlayer!.blocks.find(b => b.text === protectedWord);
    expect(targetBlockProtected).toBeDefined();
    expect(targetBlockProtected!.isDestroyed).toBe(false); // Inchangé

    const targetBlockVulnerable = targetPlayer!.blocks.find(b => b.text === "vulnérable_non_cible");
    expect(targetBlockVulnerable).toBeDefined();
    expect(targetBlockVulnerable!.isDestroyed).toBe(false); // Inchangé aussi
  });

  test("Scénario 3: Attaque Échouée (Mot Incorrect)", async () => {
    // Arrange
    const incorrectWord = "오답"; // Un mot qui n'existe pas chez la cible
    const initialAttackerGroundHeight = 12;
    const initialTargetGroundHeight = 20; // La cible aura des blocs, mais aucun ne correspondra

    await setupDuelState(TEST_GAME_ID,
      { // Attaquant
        uid: ATTACKER_UID,
        displayName: "Attaquant Test",
        blocks: [],
        groundHeight: initialAttackerGroundHeight,
      },
      { // Cible
        uid: TARGET_UID,
        displayName: "Cible Test",
        blocks: [
          { text: "단어1", vulnerableAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) }, // Vulnérable
          { text: "단어2", vulnerableAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600000) }, // Protégé
        ],
        groundHeight: initialTargetGroundHeight,
      }
    );

    const attackRequestData: SendTyphoonAttackRequest = {
      gameId: TEST_GAME_ID,
      attackerPlayerId: ATTACKER_UID,
      targetPlayerId: TARGET_UID,
      attackWord: incorrectWord,
    };

    // Act
    const result = await sendTyphoonAttackLogic(
      attackRequestData,
      { uid: ATTACKER_UID }
    );

    // Assert
    // 1. Vérifier que la fonction retourne un statut failure
    expect(result.status).toBe("failure");
    const failureResult = result as SendTyphoonAttackFailureResponse;
    // La raison exacte dépend de l'implémentation, "WORD_NOT_FOUND_OR_DESTROYED" est probable
    expect(failureResult.reason).toBe("WORD_NOT_FOUND_OR_DESTROYED");
    expect(failureResult.message).toBe("Attack failed. Attacker penalized.");
    expect(failureResult.attackerPenaltyGroundRiseAmount).toBeGreaterThan(0);

    // 2. Vérifier que le groundHeight de l'attaquant a augmenté (pénalité)
    const gameDoc = await db.collection("games").doc(TEST_GAME_ID).get();
    expect(gameDoc.exists).toBe(true);
    const gameData = gameDoc.data() as Game;

    const attackerPlayer = gameData.players.find(p => p.uid === ATTACKER_UID);
    expect(attackerPlayer).toBeDefined();
    expect(attackerPlayer!.groundHeight).toBe(initialAttackerGroundHeight + failureResult.attackerPenaltyGroundRiseAmount);

    // 3. Vérifier que l'état de l'adversaire (sol et blocs) est inchangé (optionnel mais bon à vérifier)
    const targetPlayer = gameData.players.find(p => p.uid === TARGET_UID);
    expect(targetPlayer).toBeDefined();
    expect(targetPlayer!.groundHeight).toBe(initialTargetGroundHeight);
    targetPlayer!.blocks.forEach(block => {
      expect(block.isDestroyed).toBe(false);
    });
  });
});
