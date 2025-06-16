# Test Suite: `sendTyphoonAttack` Cloud Function

This document outlines the unit test cases for the `sendTyphoonAttack` Cloud Function. These tests will generally require mocking Firestore database interactions and Firebase Authentication context.

## I. Authentication & Authorization

1.  **Test Case:** Unauthenticated request
    *   **Condition:** `request.auth` is undefined or null.
    *   **Expected Outcome:** The function throws an `HttpsError` with the code 'unauthenticated'.
    *   **Verification:** Check error code and message.

2.  **Test Case:** Attacker ID mismatch
    *   **Condition:** The UID from `request.auth.uid` does not match the `attackerPlayerId` provided in `request.data`.
    *   **Expected Outcome:** The function throws an `HttpsError` with the code 'permission-denied'.
    *   **Verification:** Check error code and message.

## II. Input Validation

1.  **Test Case:** Missing `gameId`
    *   **Condition:** `request.data.gameId` is null, undefined, or an empty string.
    *   **Expected Outcome:** Throws `HttpsError` with code 'invalid-argument'.
    *   **Verification:** Check error code and message.

2.  **Test Case:** Missing `attackerPlayerId`
    *   **Condition:** `request.data.attackerPlayerId` is null, undefined, or an empty string.
    *   **Expected Outcome:** Throws `HttpsError` with code 'invalid-argument'.
    *   **Verification:** Check error code and message.

3.  **Test Case:** Missing `targetPlayerId`
    *   **Condition:** `request.data.targetPlayerId` is null, undefined, or an empty string.
    *   **Expected Outcome:** Throws `HttpsError` with code 'invalid-argument'.
    *   **Verification:** Check error code and message.

4.  **Test Case:** Missing `attackWord`
    *   **Condition:** `request.data.attackWord` is null, undefined, or an empty string.
    *   **Expected Outcome:** Throws `HttpsError` with code 'invalid-argument'.
    *   **Verification:** Check error code and message.

5.  **Test Case:** Attacker and Target are the same player
    *   **Condition:** `request.data.attackerPlayerId` is strictly equal to `request.data.targetPlayerId`.
    *   **Expected Outcome:** Throws `HttpsError` with code 'invalid-argument'.
    *   **Verification:** Check error code and message.

## III. Game State Validation (Requires Firestore Mocking)

1.  **Test Case:** Game not found
    *   **Setup:** Mock Firestore `db.collection("games").doc(gameId).get()` to return a snapshot where `exists` is `false`.
    *   **Expected Outcome:** Throws `HttpsError` with code 'not-found'.
    *   **Verification:** Check error code and message.

2.  **Test Case:** Game not in 'playing' status
    *   **Setup:** Mock Firestore game document to have a `status` other than 'playing' (e.g., 'waiting', 'finished').
    *   **Expected Outcome:** Throws `HttpsError` with code 'failed-precondition'.
    *   **Verification:** Check error code and message.

3.  **Test Case:** Attacker not in game
    *   **Setup:** Mock Firestore game document's `players` array to not include the `attackerPlayerId`.
    *   **Expected Outcome:** Throws `HttpsError` with code 'failed-precondition' (or 'internal' if the function assumes player existence after auth checks, as per current implementation detail).
    *   **Verification:** Check error code and message.

4.  **Test Case:** Target not in game
    *   **Setup:** Mock Firestore game document's `players` array to not include the `targetPlayerId`.
    *   **Expected Outcome:** Throws `HttpsError` with code 'failed-precondition' (or 'internal' as per current implementation detail).
    *   **Verification:** Check error code and message.

5.  **Test Case:** Target player blocks data missing/inconsistent (if applicable)
    *   **Setup:** Mock `targetPlayer` object within `gameData.players` to have `blocks: null` or `blocks: undefined` if this state is possible and not caught by TypeScript.
    *   **Expected Outcome:** Throws `HttpsError` with code 'internal' due to data inconsistency.
    *   **Verification:** Check error code and message.

## IV. Attack Logic & Validation (Requires Firestore Mocking for game state)

For these tests, `admin.firestore.Timestamp.now()` will be used. Mocking time might be necessary for precise control over vulnerability checks.

1.  **Test Case:** Successful Attack
    *   **Setup:**
        *   Mock `attackerPlayer` and `targetPlayer` within `gameData.players`.
        *   `targetPlayer.blocks` contains a `TyphoonBlock` where `text` matches `attackWord`, `isDestroyed` is `false`.
        *   `vulnerableAt` timestamp of the target block is less than or equal to the current mocked time.
        *   Initial `targetPlayer.groundHeight` is known.
    *   **Expected Outcome:**
        *   Returns a `SendTyphoonAttackSuccessResponse` with `status: "success"`.
        *   Response includes `attackerPlayerId`, `targetPlayerId`, `destroyedBlockWord` (matching `attackWord`), and `targetGroundRiseAmount` equal to `DEFAULT_GROUND_RISE_AMOUNT`.
        *   Firestore `gameRef.update()` is called.
    *   **Verification:** Check response properties. Verify arguments to `gameRef.update()` (see Section V).

2.  **Test Case:** Attack Fails - Word Not Found
    *   **Setup:**
        *   `targetPlayer.blocks` does not contain any non-destroyed block whose `text` matches `attackWord`.
        *   Initial `attackerPlayer.groundHeight` is known.
    *   **Expected Outcome:**
        *   Returns a `SendTyphoonAttackFailureResponse` with `status: "failure"` and `reason: "WORD_NOT_FOUND_OR_DESTROYED"`.
        *   Response includes `attackerPlayerId` and `attackerPenaltyGroundRiseAmount` equal to `DEFAULT_PENALTY_RISE_AMOUNT`.
        *   Firestore `gameRef.update()` is called.
    *   **Verification:** Check response properties. Verify arguments to `gameRef.update()` (see Section V).

3.  **Test Case:** Attack Fails - Block Already Destroyed
    *   **Setup:**
        *   `targetPlayer.blocks` contains a `TyphoonBlock` where `text` matches `attackWord`, but `isDestroyed` is `true`.
        *   Initial `attackerPlayer.groundHeight` is known.
    *   **Expected Outcome:**
        *   Returns a `SendTyphoonAttackFailureResponse` with `status: "failure"` and `reason: "WORD_NOT_FOUND_OR_DESTROYED"`.
        *   Response includes `attackerPlayerId` and `attackerPenaltyGroundRiseAmount` equal to `DEFAULT_PENALTY_RISE_AMOUNT`.
        *   Firestore `gameRef.update()` is called.
    *   **Verification:** Check response properties. Verify arguments to `gameRef.update()` (see Section V).

4.  **Test Case:** Attack Fails - Block Not Vulnerable
    *   **Setup:**
        *   `targetPlayer.blocks` contains a `TyphoonBlock` where `text` matches `attackWord`, `isDestroyed` is `false`.
        *   `vulnerableAt` timestamp of the target block is greater than the current mocked time.
        *   Initial `attackerPlayer.groundHeight` is known.
    *   **Expected Outcome:**
        *   Returns a `SendTyphoonAttackFailureResponse` with `status: "failure"` and `reason: "BLOCK_NOT_VULNERABLE"`.
        *   Response includes `attackerPlayerId` and `attackerPenaltyGroundRiseAmount` equal to `DEFAULT_PENALTY_RISE_AMOUNT`.
        *   Firestore `gameRef.update()` is called.
    *   **Verification:** Check response properties. Verify arguments to `gameRef.update()` (see Section V).

## V. Firestore Updates (Verify mock calls)

These tests focus on the arguments passed to `gameRef.update()`.

1.  **Test Case:** Successful Attack - Firestore `update` payload
    *   **Condition:** Same as Test Case 4.1 (Successful Attack).
    *   **Expected Outcome:** `gameRef.update()` is called with a `players` array where:
        *   The target player's entry has their `blocks` array updated: the attacked block now has `isDestroyed: true`.
        *   The target player's entry has their `groundHeight` increased by `DEFAULT_GROUND_RISE_AMOUNT`.
        *   Other players' data remains unchanged.
    *   **Verification:** Spy on `gameRef.update()` and inspect its arguments.

2.  **Test Case:** Failed Attack - Firestore `update` payload
    *   **Condition:** Same as Test Cases 4.2, 4.3, or 4.4 (Failed Attack).
    *   **Expected Outcome:** `gameRef.update()` is called with a `players` array where:
        *   The attacker player's entry has their `groundHeight` increased by `DEFAULT_PENALTY_RISE_AMOUNT`.
        *   Other players' data (including the target's blocks and ground height) remains unchanged from the state before the penalty.
    *   **Verification:** Spy on `gameRef.update()` and inspect its arguments.

## VI. General Error Handling (Requires Firestore Mocking)

1.  **Test Case:** Firestore `gameRef.get()` fails (other than not found)
    *   **Setup:** Mock `db.collection("games").doc(gameId).get()` to throw a generic error (e.g., Firestore unavailable).
    *   **Expected Outcome:** Throws `HttpsError` with code 'internal'. The original error message might be in `details`.
    *   **Verification:** Check error code, message, and potentially `details.details`. Server logs should contain the original error.

2.  **Test Case:** Firestore `gameRef.update()` fails
    *   **Setup:** Mock `gameRef.update()` to throw a generic error during either a successful or failed attack path that attempts a write.
    *   **Expected Outcome:** Throws `HttpsError` with code 'internal'. The original error message might be in `details`.
    *   **Verification:** Check error code, message, and potentially `details.details`. Server logs should contain the original error.

3.  **Test Case:** Unexpected internal error (e.g., runtime error in non-mocked part)
    *   **Setup:** Introduce a deliberate runtime error in a part of the code that is not directly related to Firestore calls (if possible and makes sense for testing robustness).
    *   **Expected Outcome:** Throws `HttpsError` with code 'internal'.
    *   **Verification:** Check error code and message. Server logs should contain the original error.

---

**Note on Mocking Timestamps:**
For tests involving `vulnerableAt` (4.1, 4.4), ensure consistent handling of `admin.firestore.Timestamp.now()`. This might involve:
*   Mocking `admin.firestore.Timestamp.now()` to return a fixed timestamp.
*   Setting `vulnerableAt` relative to a known (mocked) current time.
The specific strategy will depend on the testing framework and utilities used (e.g., Jest, Sinon).
