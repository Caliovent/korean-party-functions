"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseShopItem = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// Initialiser Firebase Admin SDK (une seule fois par instance de fonction)
// Il est recommandé de le faire en dehors de la fonction elle-même
// si ce n'est pas déjà fait dans un fichier d'initialisation global.
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
exports.purchaseShopItem = functions.https.onCall(async (data, context) => {
    // 1. Valider que l'utilisateur est authentifié.
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "L'utilisateur doit être authentifié pour effectuer un achat.");
    }
    const userId = context.auth.uid;
    const { itemId } = data;
    if (!itemId || typeof itemId !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "L'itemId est requis et doit être une chaîne de caractères.");
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
                throw new functions.https.HttpsError("not-found", "Document utilisateur non trouvé.");
            }
            if (!itemDocSnapshot.exists) {
                throw new functions.https.HttpsError("not-found", `Article avec l'ID '${itemId}' non trouvé dans shopItemDefinitions.`);
            }
            const userData = userDocSnapshot.data();
            const itemData = itemDocSnapshot.data();
            itemName = itemData.name; // Assigner le nom de l'article ici
            // Initialiser les champs si absents (robuste)
            const currentMoonShards = userData.moonShards || 0;
            const currentOwnedCosmetics = userData.ownedCosmetics || [];
            // 3. Vérifier si l'utilisateur a assez d'moonShards.
            if (currentMoonShards < itemData.price) {
                throw new functions.https.HttpsError("failed-precondition", "Solde de MoonShards insuffisant pour cet achat.");
            }
            // 4. Vérifier si l'utilisateur ne possède pas déjà l'article.
            if (currentOwnedCosmetics.includes(itemId)) {
                throw new functions.https.HttpsError("failed-precondition", "Vous possédez déjà cet article.");
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
    }
    catch (error) {
        // Journaliser l'erreur côté serveur pour le débogage
        console.error("Erreur lors de l'achat de l'article:", error);
        // Renvoyer l'erreur au client
        // Si c'est déjà une HttpsError, elle sera renvoyée telle quelle.
        // Sinon, encapsuler dans une HttpsError générique.
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Une erreur interne est survenue lors du traitement de votre achat.");
    }
});
// Potentiellement d'autres fonctions ici...
// export const anotherFunction = functions.https.onRequest(...)
//# sourceMappingURL=index.js.map