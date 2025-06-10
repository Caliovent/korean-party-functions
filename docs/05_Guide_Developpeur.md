# 5. Guide du Développeur

## 5.1. Setup de l'Environnement

1.  **Frontend (`korean-party-client`) :**
    -   Assurez-vous d'avoir Node.js et npm installés.
    -   Exécutez `npm install` à la racine du dossier.
    -   Créez un fichier `.env.local` en vous basant sur `.env.example` et remplissez vos clés de configuration Firebase.
    -   Exécutez `npm run dev` pour lancer le serveur de développement.
2.  **Backend (`korean-party-functions`) :**
    -   Assurez-vous d'avoir Firebase CLI installé (`npm install -g firebase-tools`).
    -   Naviguez vers le dossier `functions`.
    -   Exécutez `npm install`.
    -   Utilisez `firebase deploy --only functions` pour déployer les fonctions.

## 5.2. Principes Architecturaux Clés

-   **Serveur Autoritaire :** Aucune logique de jeu ne doit être implémentée côté client. Le client envoie des intentions (`je veux faire X`), le serveur les valide et les exécute.
-   **"Écouter, Afficher, Demander" :** Le frontend doit être réactif. Il s'abonne à l'état du jeu dans Firestore (`onSnapshot`) et met à jour l'affichage en conséquence. Il ne modifie jamais son propre état directement.
-   **Services :** Toute communication avec le backend (appels aux Cloud Functions) doit passer par des fonctions dédiées dans le dossier `src/services/`.

## 5.3. Processus de Travail

Pour toute nouvelle fonctionnalité majeure, nous suivons un processus en 3 étapes :
1.  **Analyse et Proposition :** L'agent IA analyse la demande et propose une architecture ou un plan d'implémentation détaillé.
2.  **Validation :** Le Lead Developer (humain) valide la proposition.
3.  **Implémentation :** L'agent IA développe la fonctionnalité en suivant le plan validé.