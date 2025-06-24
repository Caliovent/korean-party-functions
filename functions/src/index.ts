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

// Potentiellement d'autres fonctions ici...
// export const anotherFunction = functions.https.onRequest(...)
