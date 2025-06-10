# 2. Architecture Technique Détaillée

## 2.1. Introduction : Le Plan de l'Architecte

Ce document est la **source de vérité technique unique** pour le projet "Korean Party - L'Académie K-Mage". Il décrit les choix technologiques, les modèles de conception (design patterns) et la structure de nos systèmes. Tout développement doit s'y conformer pour garantir la cohérence, la robustesse et l'évolutivité du jeu.

## 2.2. Paradigmes Architecturaux Fondamentaux

Trois paradigmes non négociables dictent notre conception :

#### a. Le Serveur Autoritaire (Authoritative Server)

Le backend est le maître absolu du jeu. Aucune logique de jeu critique (validation d'action, calcul de résultat, modification de l'état) ne doit jamais être exécutée ou décidée par le client.
-   **Rôle du Client :** Rendre l'état du jeu, capturer les intentions du joueur ("input"), et envoyer des requêtes au serveur.
-   **Rôle du Serveur :** Valider les intentions, exécuter la logique, mettre à jour l'état de la base de données (la source de vérité), et notifier les clients des changements.
-   **Justification :** Sécurité (prévention de la triche), stabilité (résistance aux déconnexions), cohérence de l'état du jeu pour tous les joueurs.

#### b. Le Modèle Hybride : Hub Persistant + Sessions Instanciées

Notre jeu n'est ni un simple jeu en lobby, ni un MMORPG complet, mais un hybride des deux.
-   **Le Hub Persistant :** Un monde toujours en ligne où les joueurs se connectent. L'architecture doit y gérer la synchronisation en temps réel de nombreux joueurs dans un espace partagé (positions, chat).
-   **Les Sessions de Jeu :** Des "bulles" de jeu isolées et instanciées (le plateau) pour un petit groupe de joueurs. L'architecture y gère un état de jeu complexe et critique, de manière privée pour chaque partie.

#### c. Le Client "Intelligent mais Soumis" : Modèle "Écouter, Afficher, Demander"

Le frontend est conçu pour être hautement réactif et découplé de la logique de jeu.
1.  **ÉCOUTER :** Un ou plusieurs listeners temps réel (ex: `onSnapshot` de Firestore) s'abonnent aux changements de l'état du jeu pertinent.
2.  **AFFICHER :** L'interface (React et Phaser) se met à jour de manière déclarative en fonction des données reçues de l'écouteur.
3.  **DEMANDER :** Toute action du joueur déclenche un appel à une Cloud Function via un service dédié, sans jamais tenter de prédire ou de modifier l'état localement.

## 2.3. Stack Technologique Détaillée

-   **Frontend :**
    -   **React (avec Vite & TypeScript) :** Gère l'ensemble de l'interface utilisateur (UI), la gestion de l'état global du client, les modales, les profils, etc.
    -   **Phaser 3 :** Intégré dans un composant React, Phaser est exclusivement utilisé pour le rendu des scènes de jeu temps réel (le Hub, le Plateau, les Mini-Jeux). Il ne contient aucune logique de jeu.
    -   **Communication React <> Phaser :** Un système d'`EventEmitter` permet à React de donner des ordres d'affichage à Phaser ("lance l'animation de déplacement du pion X sur la case Y") et à Phaser de remonter des événements d'input à React ("le joueur a cliqué sur le PNJ Z").
-   **Backend (Firebase) :**
    -   **Firestore :** Notre base de données NoSQL, utilisée comme source de vérité unique pour l'état des joueurs, des parties et des guildes.
    -   **Cloud Functions (v2, onCall) :** Notre API de jeu. Toutes les actions sont des appels à ces fonctions TypeScript/Node.js.
    -   **Firebase Authentication :** Gère l'authentification des utilisateurs (Email/Mdp, Anonyme).

## 2.4. Schéma Détaillé de la Base de Données (Firestore)

#### a. Collection `users`
*Document identifié par l'UID de l'utilisateur.*
```json
{
  "uid": "string",
  "displayName": "string",
  "email": "string",
  "createdAt": "Timestamp",
  "avatarUrl": "string",
  "title": "string" // Ex: "Apprenti des Runes"
  "level": "number", // Niveau global du sorcier
  "xp": "number",
  "mana": "number",
  "guildId": "string | null", // ID du document de la guilde
  "inventory": {
    "knowledgeFragments": { "food": 0, "travel": 0, ... },
    "greatGrimoires": ["string"], // Ex: ["GRIMOIRE_FOOD"]
    "artifacts": ["string"] // Ex: ["AMULETTE_PRONONCIATION"]
  },
  "srsData": {
    "WORD_ID_1": { "interval": "number", "easeFactor": "number", "nextReview": "Timestamp" },
    ...
  }
}
b. Collection games
Document identifié par un ID de partie unique.

JSON

{
  "gameId": "string",
  "status": "'waiting' | 'playing' | 'finished'",
  "createdAt": "Timestamp",
  "hostId": "string", // Créateur initial de la partie
  "players": {
    "PLAYER_UID_1": { "displayName": "string", "mana": 100, "position": 0, "grimoires": 0, ... },
    "PLAYER_UID_2": { ... }
  },
  "playerOrder": ["string"], // Ex: [PLAYER_UID_1, PLAYER_UID_2]
  "currentPlayerId": "string",
  "turnState": "'AWAITING_ROLL' | 'MOVING' | 'RESOLVING_TILE' | 'AWAITING_SPELL'",
  "turnNumber": "number",
  "boardLayout": [{ "type": "'food' | 'travel' | 'library' | ..." }],
  "grimoirePositions": ["number"], // Index des cases où se trouvent les Grimoires
  "lastDiceRoll": "number | null",
  "lastSpellCast": "{ 'casterId': string, 'targetId': string, 'spellId': string } | null",
  "winnerId": "string | null"
}
c. Collection guilds
Document identifié par un ID de guilde unique.

JSON

{
    "guildId": "string",
    "name": "string",
    "tag": "string", // Ex: [KMAGE]
    "leaderId": "string",
    "memberCount": "number",
    "members": [{ "uid": "string", "displayName": "string", "joinedAt": "Timestamp" }]
}
2.5. Catalogue des Cloud Functions (API du Jeu)
Voici les principaux endpoints de notre API de jeu.

a. Gestion de Session
createGame(data) : Crée une nouvelle partie dans la collection games avec le statut waiting.
joinGame({ gameId }) : Ajoute un joueur à une partie en attente.
startGame({ gameId }) : Démarre une partie, initialise le plateau, l'ordre des joueurs et change le statut à playing.
b. Gameplay en Session
rollDice({ gameId }) : Valide le tour, génère un lancer de dé côté serveur, met à jour l'état du jeu.
resolveTileAction({ gameId }) : Calcule et applique l'effet de la case sur laquelle le joueur a atterri (gain/perte de mana, lancement de mini-jeu, collecte de grimoire).
castSpell({ gameId, spellId, targetId }) : Valide le coût en mana et les conditions, puis applique l'effet d'un sort sur un joueur ou sur le jeu.
c. Fonctions Sociales
createGuild({ name, tag }) : Crée une nouvelle Maison de Sorciers.
joinGuild({ guildId }) : Permet de rejoindre une Maison.
leaveGuild() : Permet de quitter sa Maison.
d. Fonctions de Mini-Jeux
sendTyphoonAttack({ gameId, targetId, attackPower }) : Gère l'envoi d'une "attaque" dans le duel Hangeul Typhoon.
2.6. Flux de Données : Exemple d'un Lancer de Dé
CLIENT : Le joueur clique sur le bouton "Lancer le Dé". L'UI est bloquée pour éviter les double-clics.
CLIENT -> SERVEUR : Le service gameService.ts appelle la Cloud Function rollDice({ gameId: '...' }).
SERVEUR (Cloud Function rollDice) : a. Valide que l'appelant est bien le currentPlayerId de la partie. b. Valide que le turnState est bien AWAITING_ROLL. c. Génère un nombre aléatoire sécurisé (ex: 1-6). d. Met à jour le document de la partie dans Firestore avec : { lastDiceRoll: 6, turnState: 'MOVING' }.
SERVEUR -> CLIENTS : Firestore notifie tous les clients abonnés à ce document du changement.
CLIENT (Listener onSnapshot) : a. Reçoit les nouvelles données. b. Le composant React passe les nouvelles informations (lastDiceRoll) à la scène Phaser. c. La scène Phaser lance l'animation de déplacement du pion. d. Une fois l'animation terminée, le client informe le serveur (ex: via une nouvelle fonction finishMove) pour que le serveur passe au turnState: 'RESOLVING_TILE'.