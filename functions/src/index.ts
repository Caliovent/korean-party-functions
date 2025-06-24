import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Initialiser Firebase Admin SDK (une seule fois par instance de fonction)
// Il est recommandé de le faire en dehors de la fonction elle-même
// si ce n'est pas déjà fait dans un fichier d'initialisation global.
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface PurchaseShopItemData {
  itemId: string;
}

interface UserDoc {
  moonShards: number;
  ownedCosmetics: string[];
  // ... autres champs potentiels de l'utilisateur
}

interface ShopItemDoc {
  name: string;
  category: string;
  price: number;
  imageUrl: string;
  description: string;
  // ... autres champs potentiels de l'article
}

export const purchaseShopItem = functions.https.onCall(async (data: PurchaseShopItemData, context) => {
  // 1. Valider que l'utilisateur est authentifié.
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour effectuer un achat."
    );
  }

  const userId = context.auth.uid;
  const { itemId } = data;

  if (!itemId || typeof itemId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "L'itemId est requis et doit être une chaîne de caractères."
    );
  }

  const userRef = db.collection("users").doc(userId);
  const itemRef = db.collection("shopItemDefinitions").doc(itemId);

  let itemName = "l'article"; // Valeur par défaut au cas où

  try {
    // 2. Exécuter une transaction atomique
    await db.runTransaction(async (transaction) => {
      const userDocSnapshot = await transaction.get(userRef);
      const itemDocSnapshot = await transaction.get(itemRef);

      if (!userDocSnapshot.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "Document utilisateur non trouvé."
        );
      }

      if (!itemDocSnapshot.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          `Article avec l'ID '${itemId}' non trouvé dans shopItemDefinitions.`
        );
      }

      const userData = userDocSnapshot.data() as UserDoc;
      const itemData = itemDocSnapshot.data() as ShopItemDoc;
      itemName = itemData.name; // Assigner le nom de l'article ici

      // Initialiser les champs si absents (robuste)
      const currentMoonShards = userData.moonShards || 0;
      const currentOwnedCosmetics = userData.ownedCosmetics || [];

      // 3. Vérifier si l'utilisateur a assez d'moonShards.
      if (currentMoonShards < itemData.price) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Solde de MoonShards insuffisant pour cet achat."
        );
      }

      // 4. Vérifier si l'utilisateur ne possède pas déjà l'article.
      if (currentOwnedCosmetics.includes(itemId)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Vous possédez déjà cet article."
        );
      }

      // Mettre à jour les données de l'utilisateur
      const newMoonShards = currentMoonShards - itemData.price;
      const newOwnedCosmetics = [...currentOwnedCosmetics, itemId];

      transaction.update(userRef, {
        moonShards: newMoonShards,
        ownedCosmetics: newOwnedCosmetics,
      });
    });

    // 5. Retourner une réponse de succès.
    return {
      success: true,
      message: `Achat de '${itemName}' réussi ! Vos MoonShards ont été mis à jour.`,
    };

  } catch (error) {
    // Journaliser l'erreur côté serveur pour le débogage
    console.error("Erreur lors de l'achat de l'article:", error);

    // Renvoyer l'erreur au client
    // Si c'est déjà une HttpsError, elle sera renvoyée telle quelle.
    // Sinon, encapsuler dans une HttpsError générique.
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue lors du traitement de votre achat."
    );
  }
});

interface LeaveGuildData {
  guildId: string;
}

export const leaveGuild = functions.https.onCall(async (data: LeaveGuildData, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour quitter une guilde."
    );
  }

  const { guildId } = data;
  const userId = context.auth.uid;

  if (!guildId || typeof guildId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "L'ID de la guilde est requis."
    );
  }

  const userRef = db.collection("users").doc(userId);
  const guildRef = db.collection("guilds").doc(guildId);

  try {
    let message = "Vous avez quitté la guilde.";

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const guildDoc = await transaction.get(guildRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Document utilisateur non trouvé.");
      }
      const userData = userDoc.data();

      if (userData?.guildId !== guildId) {
        throw new functions.https.HttpsError("failed-precondition", "L'utilisateur n'est pas membre de cette guilde (selon son profil).");
      }

      if (!guildDoc.exists) {
        // If guild doesn't exist, but user thinks they are in it, clear user's guildId.
        transaction.update(userRef, { guildId: admin.firestore.FieldValue.delete() });
        throw new functions.https.HttpsError("not-found", `Guilde avec l'ID "${guildId}" non trouvée. Votre profil a été mis à jour.`);
      }
      const guildData = guildDoc.data();
      if (!guildData || !guildData.members) {
        throw new functions.https.HttpsError("internal", "Données de guilde ou membres manquants.");
      }

      const memberInfo = guildData.members[userId];
      if (!memberInfo) {
        // User's profile says they are in guild, but not listed in guild's members. Clean up user profile.
        transaction.update(userRef, { guildId: admin.firestore.FieldValue.delete() });
        throw new functions.https.HttpsError("failed-precondition", "Vous n'êtes pas listé dans les membres de la guilde. Votre profil a été mis à jour.");
      }

      // Prepare updates
      const userUpdate: { [key: string]: any; } = { guildId: admin.firestore.FieldValue.delete() };
      // Firestore does not allow dots in field names for FieldValue.delete() in update paths directly.
      // So, we need to create a new map without the user.
      const updatedMembers = { ...guildData.members };
      delete updatedMembers[userId];

      const newMemberCount = (guildData.memberCount || Object.keys(guildData.members).length) - 1;

      if (memberInfo.role === "Maître") {
        if (newMemberCount === 0) {
          // Maître is the last member, dissolve the guild
          transaction.delete(guildRef);
          message = `Vous avez quitté la guilde "${guildData.name}" en tant que Maître. Comme vous étiez le dernier membre, la guilde a été dissoute.`;
        } else {
          // Maître leaves, others remain. Promote the oldest member.
          let oldestMemberId = "";
          let oldestJoinedAt = new admin.firestore.Timestamp(9999999999, 999999999); // Far future date

          for (const [uid, member] of Object.entries(updatedMembers)) {
            if (member && member.joinedAt && member.joinedAt.toMillis() < oldestJoinedAt.toMillis()) {
              oldestJoinedAt = member.joinedAt;
              oldestMemberId = uid;
            }
          }

          if (oldestMemberId) {
            updatedMembers[oldestMemberId].role = "Maître";
            transaction.update(guildRef, {
              members: updatedMembers,
              leaderId: oldestMemberId,
              memberCount: newMemberCount,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            message = `Vous avez quitté la guilde "${guildData.name}" en tant que Maître. ${updatedMembers[oldestMemberId].displayName} a été promu(e) nouveau Maître.`;
          } else {
            // Should not happen if newMemberCount > 0, but as a fallback:
            transaction.update(guildRef, { // Or delete if this state is considered invalid
              members: updatedMembers,
              leaderId: admin.firestore.FieldValue.delete(), // No leader
              memberCount: newMemberCount,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            message = `Vous avez quitté la guilde "${guildData.name}" en tant que Maître. Aucun autre membre n'a pu être promu.`;
          }
        }
      } else {
        // Normal member leaves
        transaction.update(guildRef, {
          members: updatedMembers,
          memberCount: newMemberCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        message = `Vous avez quitté la guilde "${guildData.name}".`;
      }
      transaction.update(userRef, userUpdate);
    });

    return { success: true, message };

  } catch (error) {
    console.error("Erreur lors de la tentative de quitter la guilde:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue lors de la tentative de quitter la guilde."
    );
  }
});

interface JoinGuildData {
  guildId: string;
}

export const joinGuild = functions.https.onCall(async (data: JoinGuildData, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour rejoindre une guilde."
    );
  }

  const { guildId } = data;
  const userId = context.auth.uid;

  if (!guildId || typeof guildId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "L'ID de la guilde est requis."
    );
  }

  const userRef = db.collection("users").doc(userId);
  const guildRef = db.collection("guilds").doc(guildId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const guildDoc = await transaction.get(guildRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "Document utilisateur non trouvé."
        );
      }
      const userData = userDoc.data();
      if (userData?.guildId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "L'utilisateur est déjà membre d'une guilde."
        );
      }

      if (!guildDoc.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          `Guilde avec l'ID "${guildId}" non trouvée.`
        );
      }
      const guildData = guildDoc.data();
      if (!guildData) { // Should not happen if guildDoc.exists is true
        throw new functions.https.HttpsError(
          "internal",
          "Données de guilde non trouvées malgré l'existence du document."
        );
      }

      // Check if user is already listed in members (consistency check)
      if (guildData.members && guildData.members[userId]) {
        // If user is already in members list but their userDoc.guildId is not set,
        // fix it by setting their userDoc.guildId.
        // This handles a potential inconsistent state.
        transaction.update(userRef, { guildId: guildId });
        throw new functions.https.HttpsError(
          "already-exists", // Or "failed-precondition"
          "L'utilisateur est déjà listé comme membre de cette guilde. Profil mis à jour."
        );
      }

      const userDisplayName = userData?.displayName || "Joueur Anonyme";
      const newMemberData = {
        role: "Membre",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        displayName: userDisplayName,
      };

      const updatedMembers = { ...guildData.members, [userId]: newMemberData };

      transaction.update(guildRef, {
        members: updatedMembers,
        memberCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.update(userRef, { guildId: guildId });
    });

    return {
      success: true,
      message: `Vous avez rejoint la guilde avec succès !`, // Consider adding guild name
    };
  } catch (error) {
    console.error("Erreur pour rejoindre la guilde:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue pour rejoindre la guilde."
    );
  }
});

// Potentiellement d'autres fonctions ici...
// export const anotherFunction = functions.https.onRequest(...)

interface GetGuildDetailsData {
  guildId: string;
}

export const getGuildDetails = functions.https.onCall(async (data: GetGuildDetailsData, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour voir les détails d'une guilde."
    );
  }

  const { guildId } = data;
  const userId = context.auth.uid;

  if (!guildId || typeof guildId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "L'ID de la guilde est requis."
    );
  }

  const guildRef = db.collection("guilds").doc(guildId);

  try {
    const guildDoc = await guildRef.get();

    if (!guildDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        `Guilde avec l'ID "${guildId}" non trouvée.`
      );
    }

    const guildData = guildDoc.data();
    if (!guildData) {
      // This case should ideally not be reached if guildDoc.exists is true.
      throw new functions.https.HttpsError(
        "internal",
        "Données de guilde non trouvées malgré l'existence du document."
      );
    }

    // Validate that the authenticated user is a member of this guild.
    if (!guildData.members || !guildData.members[userId]) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "L'utilisateur n'est pas membre de cette guilde ou les données des membres sont manquantes."
      );
    }

    // Transform the members map into an array of objects as requested.
    // The displayName is already included in the members map entries.
    const membersArray = Object.entries(guildData.members).map(([uid, memberData]: [string, any]) => ({
      uid: uid,
      displayName: memberData.displayName,
      role: memberData.role,
      // joinedAt: memberData.joinedAt, // Optionally include joinedAt if needed by frontend
    }));

    return {
      id: guildDoc.id,
      name: guildData.name,
      tag: guildData.tag,
      description: guildData.description,
      leaderId: guildData.leaderId,
      memberCount: guildData.memberCount,
      // createdAt: guildData.createdAt, // Optionally include
      members: membersArray,
    };

  } catch (error) {
    console.error("Erreur lors de la récupération des détails de la guilde:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue lors de la récupération des détails de la guilde."
    );
  }
});

interface CreateGuildData {
  name: string;
  tag: string;
  description: string;
}

export const createGuild = functions.https.onCall(async (data: CreateGuildData, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "L'utilisateur doit être authentifié pour créer une guilde."
    );
  }

  const { name, tag, description } = data;
  const userId = context.auth.uid;

  if (!name || typeof name !== "string" || name.length < 3 || name.length > 50) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Le nom de la guilde doit comporter entre 3 et 50 caractères."
    );
  }
  if (!tag || typeof tag !== "string" || tag.length < 2 || tag.length > 5) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Le tag de la guilde doit comporter entre 2 et 5 caractères."
    );
  }
  if (!description || typeof description !== "string" || description.length < 10 || description.length > 250) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "La description de la guilde doit comporter entre 10 et 250 caractères."
    );
  }

  const userRef = db.collection("users").doc(userId);
  const guildsRef = db.collection("guilds");

  try {
    const guildId = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "Document utilisateur non trouvé."
        );
      }
      const userData = userDoc.data();
      if (userData?.guildId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "L'utilisateur est déjà membre d'une guilde."
        );
      }

      // Basic check for unique name and tag (simplified for this placeholder)
      // A more robust solution would use a separate collection for uniqueness constraints
      // or enforce this via security rules if possible.
      const existingGuildByNameQuery = guildsRef.where("name", "==", name);
      const existingGuildByTagQuery = guildsRef.where("tag", "==", tag);

      const nameSnapshot = await transaction.get(existingGuildByNameQuery);
      if (!nameSnapshot.empty) {
        throw new functions.https.HttpsError(
          "already-exists",
          `Une guilde avec le nom "${name}" existe déjà.`
        );
      }
      const tagSnapshot = await transaction.get(existingGuildByTagQuery);
      if (!tagSnapshot.empty) {
        throw new functions.https.HttpsError(
          "already-exists",
          `Une guilde avec le tag "${tag}" existe déjà.`
        );
      }

      const userDisplayName = userData?.displayName || "Joueur Anonyme";

      const newGuildRef = guildsRef.doc(); // Auto-generate ID
      const newGuildData = {
        name,
        tag,
        description,
        leaderId: userId,
        members: {
          [userId]: {
            role: "Maître",
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            displayName: userDisplayName,
          },
        },
        memberCount: 1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(newGuildRef, newGuildData);
      transaction.update(userRef, { guildId: newGuildRef.id });

      return newGuildRef.id;
    });

    return {
      success: true,
      guildId: guildId,
      message: `Guilde "${name}" créée avec succès !`,
    };
  } catch (error) {
    console.error("Erreur lors de la création de la guilde:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "internal",
      "Une erreur interne est survenue lors de la création de la guilde."
    );
  }
});
