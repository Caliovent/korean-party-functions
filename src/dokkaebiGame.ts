import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({
      projectId: "test-hangeul-typhoon-project",
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

// --- Constants ---
export const ACTION_VERB_DEFINITIONS_COLLECTION = "actionVerbDefinitions";
export const PLAYERS_COLLECTION = "players";

// --- Interfaces ---
export interface ActionVerbDefinition {
  id?: string;
  verb: string;
  imperative: string;
  target: string;
}

export interface GetDokkaebiGameDataRequest {
  level: number;
  playerId?: string;
}

export interface DokkaebiGameDataResponse {
  commandText: string;
  commandAudio: string;
  correctTarget: string;
  actionOptions: string[];
  isSimonSays: boolean;
  coreImperativeForSubmit?: string;
}

export interface SubmitDokkaebiGameResultsRequest {
  playerId: string;
  command: string;
  clickedTarget: string;
  isSimonSays: boolean;
  simonSaysConditionMet: boolean;
}

export interface DokkaebiGameResultsResponse {
  result: "success" | "failure";
  score: number;
  message?: string;
  newMana?: number;
  newVerbsMastered?: number;
}

export interface PlayerProfile {
  uid: string;
  mana: number;
  stats: {
    verbsMastered?: number;
    [key: string]: any;
  };
}

const SIMON_SAYS_PREFIX = "도깨비 말하길 "; // Dokkaebi says

export const getDokkaebiGameDataLogic = async (
  request: GetDokkaebiGameDataRequest
): Promise<DokkaebiGameDataResponse> => {
  const { level } = request;

  const verbDocsSnapshot = await db.collection(ACTION_VERB_DEFINITIONS_COLLECTION).get();
  if (verbDocsSnapshot.empty) {
    throw new Error("No verb definitions found in the database. Please populate the 'actionVerbDefinitions' collection.");
  }

  const allVerbs: ActionVerbDefinition[] = verbDocsSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data() as ActionVerbDefinition,
  }));

  if (allVerbs.length === 0) {
    // This case should ideally be caught by verbDocsSnapshot.empty, but as a safeguard:
    throw new Error("Verb definitions array is empty after fetching and mapping.");
  }

  // 1. Randomly select a verb
  const randomIndex = Math.floor(Math.random() * allVerbs.length);
  const selectedVerbDef = allVerbs[randomIndex];

  // 2. Determine isSimonSays mode for the round
  let isSimonSaysRoundMode = false;
  // For test scenario 1 (level 1), isSimonSays is strictly false.
  if (level === 1) {
      isSimonSaysRoundMode = false;
  } else {
    // For levels > 1, apply probability.
    // STRETCH GOAL/REFINEMENT: Probability could increase with level.
    // e.g., level 2 might be 30%, level 3 50%, level 4 70%, etc.
    // For now, using a flat 50% for any level > 1.
    isSimonSaysRoundMode = Math.random() < 0.5;
  }

  // 3. Determine actual commandText (with or without prefix)
  let commandText = selectedVerbDef.imperative;
  // This variable indicates if the "Dokkaebi dit..." prefix was actually used in the command text.
  // This is what the client would use to determine `simonSaysConditionMet` for the submission.
  let simonSaysPrefixActuallyUsedInCommand = false; // Default to false

  if (isSimonSaysRoundMode) {
    // If it's a Simon Says round, decide whether to actually include the prefix.
    // This creates the trap condition where isSimonSaysRoundMode is true, but prefix is not used.
    // STRETCH GOAL/REFINEMENT: Probability of using prefix (trap severity) could also be level-dependent.
    // For now, using a flat 50% chance to include the prefix if it's a Simon Says round.
    if (Math.random() < 0.5) {
        commandText = SIMON_SAYS_PREFIX + selectedVerbDef.imperative;
        simonSaysPrefixActuallyUsedInCommand = true;
    } else {
        // It's a Simon Says round, but we don't use the prefix (trap!)
        // commandText remains selectedVerbDef.imperative
        simonSaysPrefixActuallyUsedInCommand = false; // Explicitly false
    }
  }
  // If not a Simon Says round (isSimonSaysRoundMode is false),
  // commandText is just selectedVerbDef.imperative, and simonSaysPrefixActuallyUsedInCommand remains false.
  // If not a Simon Says round (isSimonSaysRoundMode is false),
  // commandText is just selectedVerbDef.imperative, and simonSaysPrefixActuallyUsedInCommand remains false.
  // This is consistent with the expectation for `simonSaysConditionMet` in tests.

  // 4. Generate actionOptions
  const actionOptions: string[] = [selectedVerbDef.target];
  const distractorTargets = allVerbs
    .map(v => v.target)
    .filter(t => t !== selectedVerbDef.target);

  // Shuffle unique distractor targets
  const uniqueDistractorTargets = Array.from(new Set(distractorTargets));
  for (let i = uniqueDistractorTargets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniqueDistractorTargets[i], uniqueDistractorTargets[j]] = [uniqueDistractorTargets[j], uniqueDistractorTargets[i]];
  }

  // Add up to 3 unique distractors, ensuring options.length <= 4 (or fewer if not enough unique targets)
  for (let i = 0; i < uniqueDistractorTargets.length && actionOptions.length < 4; i++) {
    actionOptions.push(uniqueDistractorTargets[i]);
  }
   // Shuffle the final action options so the correct answer isn't always first
   for (let i = actionOptions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [actionOptions[i], actionOptions[j]] = [actionOptions[j], actionOptions[i]];
  }

  return {
    commandText: commandText,
    commandAudio: `${selectedVerbDef.imperative}.mp3`, // Placeholder audio
    correctTarget: selectedVerbDef.target,
    actionOptions: actionOptions,
    isSimonSays: isSimonSaysRoundMode, // The mode of the round
    coreImperativeForSubmit: selectedVerbDef.imperative,
  };
};

export const submitDokkaebiGameResultsLogic = async (
  request: SubmitDokkaebiGameResultsRequest
): Promise<DokkaebiGameResultsResponse> => {
  const {
    playerId,
    command: coreImperative, // e.g. "자!"
    clickedTarget,
    isSimonSays: isSimonSaysRoundMode, // Mode of the round
    simonSaysConditionMet // Prefix was in command text
  } = request;

  let score = 0;
  let resultStatus: "success" | "failure" = "failure";
  let message: string | undefined = undefined;

  // Fetch the verb definition to know the correct target for the given coreImperative
  const verbDefDoc = await db.collection(ACTION_VERB_DEFINITIONS_COLLECTION).doc(coreImperative).get();
  // Note: In tests, setupActionVerbDefinitions uses verbDef.verb as ID, so imperative should be the ID.
  // If ActionVerbDefinition had `id: imperative`, this would work.
  // Let's assume ActionVerbDefinition doc ID is the `verb` (e.g. "자다"), not imperative.
  // The `coreImperativeForSubmit` from `getDokkaebiGameDataLogic` is `selectedVerbDef.imperative`.
  // We need to find the ActionVerbDefinition that has this imperative.

  const verbDefsSnapshot = await db.collection(ACTION_VERB_DEFINITIONS_COLLECTION)
                                   .where("imperative", "==", coreImperative)
                                   .limit(1)
                                   .get();

  if (verbDefsSnapshot.empty) {
    // This should not happen if coreImperative came from a valid game round
    throw new Error(`Verb definition not found for imperative: ${coreImperative}`);
  }
  const verbDef = verbDefsSnapshot.docs[0].data() as ActionVerbDefinition;
  const correctTargetForCommand = verbDef.target;

  // --- Validation Logic ---
  const playerActed = !!clickedTarget; // Player clicked something

  if (isSimonSaysRoundMode) {
    if (simonSaysConditionMet) { // "Dokkaebi dit..." WAS in command, player SHOULD act correctly
      if (playerActed && clickedTarget === correctTargetForCommand) {
        resultStatus = "success";
        score = 100;
        message = "Correct action for 'Dokkaebi dit...'!";
      } else if (playerActed && clickedTarget !== correctTargetForCommand) {
        resultStatus = "failure";
        score = -25; // Penalty for wrong action when should have acted correctly
        message = "Wrong target for 'Dokkaebi dit...'!";
      } else { // Did not act, but should have
        resultStatus = "failure";
        score = -30; // Penalty for not acting when should have (adjust as needed)
        message = "You should have acted when 'Dokkaebi dit...'!";
      }
    } else { // "Dokkaebi dit..." WAS NOT in command (trap), player should NOT act
      if (playerActed) { // Player fell for the trap
        resultStatus = "failure";
        score = -50; // Scenario 3 penalty
        message = "Oops! Acted when 'Dokkaebi dit...' was not completed!";
      } else { // Player correctly did not act
        resultStatus = "success"; // Or a neutral outcome, let's say small reward for avoiding trap
        score = 10; // Small score for correctly not acting
        message = "Good job not falling for the trap!";
      }
    }
  } else { // Not a Simon Says round, simple command
    if (playerActed && clickedTarget === correctTargetForCommand) {
      resultStatus = "success";
      score = 100; // Scenario 2 score
      message = "Correct action!";
    } else if (playerActed && clickedTarget !== correctTargetForCommand){
      resultStatus = "failure";
      score = -25; // Penalty for wrong action
      message = "Wrong target!";
    } else { // Did not act, but should have
        resultStatus = "failure";
        score = -30; // Penalty for not acting (adjust as needed)
        message = "You need to act on the command!";
    }
  }

  // --- Database Updates ---
  const playerRef = db.collection(PLAYERS_COLLECTION).doc(playerId);
  try {
    let finalNewMana = 0;
    let finalNewVerbsMastered: number | undefined = undefined;

    await db.runTransaction(async (transaction) => {
      const playerDoc = await transaction.get(playerRef);
      if (!playerDoc.exists) {
        // In a real scenario, might create a default profile or error.
        // For tests, profile is expected to be set up.
        throw new Error(`Player profile not found for UID: ${playerId}`);
      }
      const playerData = playerDoc.data() as PlayerProfile;
      const currentMana = playerData.mana || 0;
      const currentVerbsMastered = playerData.stats?.verbsMastered || 0;

      const updateData: { mana: FirebaseFirestore.FieldValue, stats?: { verbsMastered?: FirebaseFirestore.FieldValue } } = {
        mana: admin.firestore.FieldValue.increment(score),
      };

      finalNewMana = currentMana + score;

      if (resultStatus === "success" && score > 0) { // Only increment verbsMastered on positive success
        updateData.stats = {
          verbsMastered: admin.firestore.FieldValue.increment(1)
        };
        finalNewVerbsMastered = currentVerbsMastered + 1;
      } else {
        finalNewVerbsMastered = currentVerbsMastered;
      }
      transaction.update(playerRef, updateData);
    });

    return { result: resultStatus, score, message, newMana: finalNewMana, newVerbsMastered: finalNewVerbsMastered };

  } catch (error) {
    console.error("Transaction failed or player not found:", error);
    // Fallback response or re-throw, depending on desired error handling
    // For now, let's indicate failure without score if DB update fails.
    // The tests expect specific return values even if DB part fails, so this needs care.
    // The original tests only check for returned score and result, not newMana/newVerbsMastered directly from response.
    // They check DB separately.
    // So, the primary return should be { result, score, message }
    // If error is specific to player not found, we might customize.
    if (error instanceof Error && error.message.includes("Player profile not found")) {
        return { result: "failure", score: 0, message: error.message };
    } // Otherwise, rethrow or handle generally
    return { result: "failure", score: 0, message: "Database update failed."}; // Generic error for now
  }
};

console.log("src/dokkaebiGame.ts updated with submitDokkaebiGameResultsLogic");
