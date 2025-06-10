# Guild System Cloud Functions - Unit Test Plan

This document outlines the conceptual unit tests for the guild management Cloud Functions: `createGuild`, `joinGuild`, and `leaveGuild`.

**Project Context & Assumptions for Test Implementation:**
- Tests would typically be written using a framework like Jest or Mocha, along with `firebase-functions-test` for offline testing of Cloud Functions.
- Firestore interactions would be mocked or tested against a Firestore emulator.
- Authentication context (e.g., `request.auth.uid`) would be mocked for each test case.

---

**I. Tests for `createGuild`**

1.  **Success Case:**
    *   **Scenario:** A new user (no existing `guildId` in their profile) attempts to create a guild with a unique name and tag.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` without a `guildId`.
        *   `guilds` collection does not contain documents with the proposed name or tag.
    *   **Expected Outcome:**
        *   A new document is created in the `guilds` collection with:
            *   `id` matching the document's auto-generated ID.
            *   `name` matching the input.
            *   `tag` matching the input.
            *   `leaderId` matching `auth.uid`.
            *   `members` array containing one `GuildMember` object: `{ uid: auth.uid, displayName: user.pseudo }`.
            *   `createdAt` is a valid Firestore Timestamp.
        *   The user's document in the `users` collection is updated to include `guildId` (matching the new guild's ID).
        *   The function returns an object like `{ guildId: "new-guild-id", message: "Guilde créée avec succès !" }`.

2.  **Error: Guild Name Already Exists**
    *   **Scenario:** User attempts to create a guild with a name that is already in use by another guild.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` without a `guildId`.
        *   A guild document already exists in `guilds` with the same `name`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `already-exists`.
        *   No new document is created in the `guilds` collection.
        *   The user's document in `users` is not modified.

3.  **Error: Guild Tag Already Exists**
    *   **Scenario:** User attempts to create a guild with a tag that is already in use by another guild.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` without a `guildId`.
        *   A guild document already exists in `guilds` with the same `tag`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `already-exists`.
        *   No new document is created in the `guilds` collection.
        *   The user's document in `users` is not modified.

4.  **Error: User Already in a Guild**
    *   **Scenario:** User who already has a `guildId` in their profile attempts to create a new guild.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` and has a `guildId` field.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `failed-precondition`.
        *   No new document is created in the `guilds` collection.

5.  **Error: Invalid Input - Name Length (Too Short/Long)**
    *   **Scenario:** User attempts to create a guild with a name shorter than 3 characters or longer than 30 characters.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `invalid-argument`.
        *   No new document is created.
        *   User's profile is not modified.

6.  **Error: Invalid Input - Tag Length (Too Short/Long)**
    *   **Scenario:** User attempts to create a guild with a tag shorter than 2 characters or longer than 5 characters.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `invalid-argument`.
        *   No new document is created.
        *   User's profile is not modified.

7.  **Error: Unauthenticated User**
    *   **Scenario:** The function is called without an `auth` context in the `request` object.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `unauthenticated`.
        *   No Firestore operations are attempted.

8.  **Error: User Profile Not Found**
    *   **Scenario:** An authenticated user attempts to create a guild, but their user profile document does not exist in the `users` collection.
    *   **Mocked Data:**
        *   `request.auth` is provided.
        *   No document exists in `users` for `auth.uid`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `not-found`.
        *   No new guild is created.

---

**II. Tests for `joinGuild`**

1.  **Success Case:**
    *   **Scenario:** A user (not currently in a guild) attempts to join an existing guild that has space.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` without a `guildId`.
        *   Target guild document exists in `guilds` with a `members` array.
    *   **Expected Outcome:**
        *   The user's `GuildMember` object (`{ uid: auth.uid, displayName: user.pseudo }`) is added to the target guild's `members` array using `FieldValue.arrayUnion`.
        *   The user's document in the `users` collection is updated with `guildId` (matching the target guild's ID).
        *   The function returns an object like `{ message: "Vous avez rejoint la guilde \"Guild Name\" avec succès !" }`.

2.  **Error: User Already in a Guild**
    *   **Scenario:** User who already has a `guildId` in their profile attempts to join another guild.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` and has a `guildId` field.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `failed-precondition`.
        *   Target guild's `members` array is not modified.

3.  **Error: Guild Not Found**
    *   **Scenario:** User attempts to join a guild using a `guildId` that does not correspond to any existing guild.
    *   **Mocked Data:**
        *   User profile exists for `auth.uid` without a `guildId`.
        *   No guild document exists in `guilds` for the provided `guildId`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `not-found`.
        *   User's profile is not modified.

4.  **Error: Invalid Input - Guild ID (Empty/Malformed)**
    *   **Scenario:** User provides an empty string or a malformed `guildId`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `invalid-argument`.
        *   No Firestore operations are attempted if validation catches it early.

5.  **Error: Unauthenticated User**
    *   **Scenario:** The function is called without an `auth` context.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `unauthenticated`.

6.  **Data Inconsistency: User Already in Guild's Member List (but not in their profile)**
    *   **Scenario:** User's profile does *not* show a `guildId`, but they are somehow already in the target guild's `members` array. This is an edge case.
    *   **Mocked Data:**
        *   User profile for `auth.uid` has no `guildId`.
        *   Target guild exists, and its `members` array *already contains* the user's UID.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `failed-precondition` (as per current implementation: "Vous êtes déjà listé comme membre...").
        *   The user's profile is updated with the `guildId` as a corrective measure.

7.  **Error: User Profile Not Found**
    *   **Scenario:** An authenticated user attempts to join a guild, but their user profile document does not exist.
    *   **Mocked Data:**
        *   `request.auth` is provided.
        *   No document exists in `users` for `auth.uid`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `not-found`.
        *   Target guild's `members` array is not modified.

---

**III. Tests for `leaveGuild`**

1.  **Success Case: Non-Leader Leaves**
    *   **Scenario:** A regular member (not the leader) of a guild leaves.
    *   **Mocked Data:**
        *   User profile for `auth.uid` has a `guildId`.
        *   Guild document exists for `guildId`, user is in `members` array, and `leaderId` is a different UID.
    *   **Expected Outcome:**
        *   The user's `GuildMember` object is removed from the guild's `members` array using `FieldValue.arrayRemove`.
        *   The `guildId` field is removed from the user's profile in `users` using `FieldValue.delete()`.
        *   The guild's `leaderId` remains unchanged.
        *   The function returns an object like `{ message: "Vous avez quitté la guilde \"Guild Name\"." }`.

2.  **Success Case: Leader Leaves, Other Members Remain**
    *   **Scenario:** The leader of a guild leaves, but other members are still in the guild.
    *   **Mocked Data:**
        *   User profile for `auth.uid` has a `guildId`.
        *   Guild document exists for `guildId`, user is in `members` array, and `leaderId` is `auth.uid`.
        *   The `members` array contains other members besides the leader.
    *   **Expected Outcome:**
        *   The leader's `GuildMember` object is removed from the guild's `members` array.
        *   The `guildId` field is removed from the leader's profile.
        *   The guild's `leaderId` field is updated to `null`.
        *   The function returns an object like `{ message: "Vous avez quitté la guilde \"Guild Name\" en tant que leader. La guilde est maintenant sans leader." }`.

3.  **Success Case: Leader Leaves, Is Last Member (Guild Deletes)**
    *   **Scenario:** The leader of a guild, who is the sole member, leaves.
    *   **Mocked Data:**
        *   User profile for `auth.uid` has a `guildId`.
        *   Guild document exists for `guildId`, `leaderId` is `auth.uid`.
        *   The `members` array contains only the leader.
    *   **Expected Outcome:**
        *   The guild document is deleted from the `guilds` collection.
        *   The `guildId` field is removed from the leader's profile.
        *   The function returns an object like `{ message: "Vous avez quitté la guilde \"Guild Name\" et étiez le dernier membre. La guilde a été dissoute." }`.

4.  **Error: User Not in a Guild**
    *   **Scenario:** A user whose profile does not have a `guildId` attempts to leave a guild.
    *   **Mocked Data:**
        *   User profile for `auth.uid` does not have a `guildId` field.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `failed-precondition`.

5.  **Data Inconsistency: User's Guild Not Found (Profile Cleared)**
    *   **Scenario:** User's profile has a `guildId`, but the corresponding guild document does not exist in the `guilds` collection.
    *   **Mocked Data:**
        *   User profile for `auth.uid` has a `guildId`.
        *   No guild document exists in `guilds` for that `guildId`.
    *   **Expected Outcome:**
        *   The `guildId` field is removed from the user's profile.
        *   The function throws an `HttpsError` with code `not-found` and a message indicating the profile was updated.

6.  **Data Inconsistency: User in Guild (Profile) but Not in Member List (Profile Cleared)**
    *   **Scenario:** User's profile has a `guildId`, the guild exists, but the user is not found in the guild's `members` array.
    *   **Mocked Data:**
        *   User profile for `auth.uid` has a `guildId`.
        *   Guild document exists for `guildId`, but `auth.uid` is not in its `members` array.
    *   **Expected Outcome:**
        *   The `guildId` field is removed from the user's profile.
        *   The function throws an `HttpsError` with code `internal` and a message indicating the profile was updated.

7.  **Error: Unauthenticated User**
    *   **Scenario:** The function is called without an `auth` context.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `unauthenticated`.

8.  **Error: User Profile Not Found**
    *   **Scenario:** An authenticated user attempts to leave a guild, but their user profile document does not exist.
    *   **Mocked Data:**
        *   `request.auth` is provided.
        *   No document exists in `users` for `auth.uid`.
    *   **Expected Outcome:**
        *   The function throws an `HttpsError` with code `not-found`.

---

This outline provides a comprehensive set of scenarios to ensure the robustness of the guild management functions.
```
