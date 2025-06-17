# Documentation Maître : Korean Party - L'Académie K-Mage

**Statut Actuel du Projet :** En phase Bêta de développement.

Ce document est la source de vérité unique et consolidée pour l'ensemble du projet "Korean Party". Il contient la vision, les mécaniques de gameplay, l'architecture technique et la feuille de route.

---

## Table des Matières

1.  [Vision et Concept du Jeu](#1-vision-et-concept-du-jeu)
    -   [1.1. Le Rêve : Réenchanter l'Apprentissage](#11-le-rêve--réenchanter-lapprentissage)
    -   [1.2. Le Concept : La Fusion de Trois Mondes](#12-le-concept--la-fusion-de-trois-mondes)
    -   [1.3. La Doctrine de K-Mage : Nos Piliers Fondamentaux](#13-la-doctrine-de-k-mage--nos-piliers-fondamentaux)
2.  [Mécaniques de Gameplay : La Physique de l'Académie](#2-mécaniques-de-gameplay--la-physique-de-lacadémie)
    -   [2.1. Le Principe de Dualité : Hub et Session](#21-le-principe-de-dualité--hub-et-session)
    -   [2.2. La Dynamique du Plateau de Jeu : Entre Ordre et Chaos](#22-la-dynamique-du-plateau-de-jeu--entre-ordre-et-chaos)
    -   [2.3. La Relativité du Pouvoir : Le Mana et les Sorts](#23-la-relativité-du-pouvoir--le-mana-et-les-sorts)
    -   [2.4. La Mécanique Quantique de l'Apprentissage : Les Mini-Jeux](#24-la-mécanique-quantique-de-lapprentissage--les-mini-jeux)
    -   [2.5. La Gravitation Sociale : Les Maisons et l'Interaction](#25-la-gravitation-sociale--les-maisons-et-linteraction)
3.  [Architecture Technique Détaillée](#3-architecture-technique-détaillée)
    -   [3.1. Stack Technologique](#31-stack-technologique)
    -   [3.2. Paradigmes Architecturaux Fondamentaux](#32-paradigmes-architecturaux-fondamentaux)
    -   [3.3. Schéma Détaillé de la Base de Données (Firestore)](#33-schéma-détaillé-de-la-base-de-données-firestore)
    -   [3.4. Catalogue des Cloud Functions (API du Jeu)](#34-catalogue-des-cloud-functions-api-du-jeu)
4.  [Feuille de Route & Kanban](#4-feuille-de-route--kanban)
    -   [4.1. Phase Terminé (MVP & Alpha)](#41-phase-terminé-mvp--alpha)
    -   [4.2. Phase Actuelle (Bêta)](#42-phase-actuelle-bêta)
    -   [4.3. Extensions Futures (Post-Bêta / Live-Ops)](#43-extensions-futures-post-bêta--live-ops)
5.  [Guide du Développeur](#5-guide-du-développeur)
    -   [5.1. Setup de l'Environnement](#51-setup-de-lenvironnement)
    -   [5.2. Principes Architecturaux Clés](#52-principes-architecturaux-clés)
    -   [5.3. Processus de Travail](#53-processus-de-travail)

---

## 1. Vision et Concept du Jeu

### 1.1. Le Rêve : Réenchanter l'Apprentissage

Imaginez un monde où apprendre une nouvelle langue n'est pas une corvée, mais une quête magique. Un monde où chaque nouveau mot de vocabulaire est un sortilège que vous maîtrisez, où chaque règle de grammaire est une incantation qui débloque de nouveaux pouvoirs. Imaginez une académie de magie où votre puissance en tant que sorcier grandit en même temps que votre aisance en coréen.

Ce monde, c'est **"Korean Party - L'Académie K-Mage"**.

Notre vision est de créer l'expérience d'apprentissage du coréen la plus engageante et la plus efficace jamais conçue, en transformant le processus d'étude en une épopée ludique, sociale et profondément gratifiante.

### 1.2. Le Concept : La Fusion de Trois Mondes

"Korean Party" est le point de rencontre alchimique de trois univers :
1.  **L'Université du Savoir (Éducation) :** Un programme pédagogique rigoureux, basé sur les sciences cognitives et le CECRL.
2.  **Le Monde de l'Aventure (RPG) :** Un univers persistant où chaque joueur incarne un avatar, progresse, et accomplit des quêtes.
3.  **L'Arène de l'Amitié (Party Game / Social) :** Des sessions de jeu dynamiques où l'on rit, s'affronte amicalement et apprend les uns des autres.

### 1.3. La Doctrine de K-Mage : Nos Piliers Fondamentaux

-   **La Pédagogie Invisible : "Apprendre sans s'en rendre compte"**
    Notre approche, inspirée par "Apprendre à Apprendre", est intégrée au cœur du jeu : le Hangeul comme runes, le "chunking" comme création de sorts, la répétition espacée (SRS) comme rituel pour "recharger" ses pouvoirs.

-   **L'Âme du Sorcier : Une Quête Personnelle**
    Le joueur est le héros. Il progresse de simple "Apprenti des Runes" à "Archimage Polyglotte", avec une évolution visuelle de son avatar qui reflète sa maîtrise.

-   **La Fête des Mots : Le Plaisir avant Tout**
    Inspiré des "party games", le plateau de jeu est imprévisible, avec des événements aléatoires et des "Sorts d'Influence" pour des retournements de situation spectaculaires.

-   **La Confrérie des Mots : La Sorcellerie Partagée**
    L'apprentissage est un voyage collectif. Les joueurs peuvent créer des "Maisons de Sorciers" (guildes), participer à des défis coopératifs et s'affronter dans des tournois.

---

## 2. Mécaniques de Gameplay : La Physique de l'Académie

### 2.1. Le Principe de Dualité : Hub et Session

L'expérience du joueur existe dans deux états :
1.  **L'Espace-Temps Persistant (Le Hub) :** Le campus de l'Académie, un monde social toujours en ligne où les joueurs se connectent, discutent, gèrent leur progression et lancent des activités.
2.  **Les Événements Discrets (Les Sessions de Jeu) :** Des instances de jeu privées (le plateau) avec un début, une fin, et des règles précises, lancées depuis le Hub.

### 2.2. La Dynamique du Plateau de Jeu : Entre Ordre et Chaos

-   **Objectif de Victoire :** Être le premier à collecter un nombre défini de **"Grands Grimoires Thématiques"**. Pour cela, il faut collecter des **"Fragments de Savoir"** en réussissant des mini-jeux thématiques, puis les assembler à la "Grande Bibliothèque".
-   **Cases du Plateau :** Quiz, Bonus/Malus, Événement (pioche de carte), Duel, Dojo du Clavier ("Hangeul Typhoon"), et autres lieux spéciaux.

### 2.3. La Relativité du Pouvoir : Le Mana et les Sorts

La connaissance est littéralement du pouvoir : **Connaissance → Énergie (Mana) → Action (Sort)**.
-   **Mana :** L'énergie magique, gagnée en répondant correctement, en révisant (SRS), ou via des quêtes.
-   **Sorts d'Influence :** Des actions stratégiques payées en Mana pour affecter le jeu (ralentir un adversaire, se téléporter, poser un piège...).

### 2.4. La Mécanique Quantique de l'Apprentissage : Les Mini-Jeux

Chaque mini-jeu est un module conçu pour renforcer une compétence spécifique :
-   **Moteur de Quiz :** Reconnaissance de vocabulaire (QCM, chrono...).
-   **Atelier des Runes :** Maîtrise du Hangeul (construction de syllabes...).
-   **Dojo du Clavier ("Hangeul Typhoon") :** Vitesse de frappe au clavier coréen, avec un mode duel interactif.

### 2.5. La Gravitation Sociale : Les Maisons et l'Interaction

-   **Maisons de Sorciers (Guildes) :** Des communautés de joueurs avec une identité, un QG et des objectifs communs.
-   **Duels et Coopération :** Des affrontements directs dans les mini-jeux et des "Raids Linguistiques" qui nécessitent la collaboration de plusieurs joueurs.

---

## 3. Architecture Technique Détaillée

### 3.1. Stack Technologique

-   **Frontend :** React (avec Vite & TypeScript), Phaser 3 (pour les scènes de jeu).
-   **Backend :** Firebase (Firestore, Cloud Functions en TypeScript/Node.js, Authentication).

### 3.2. Paradigmes Architecturaux Fondamentaux

1.  **Serveur Autoritaire :** Le backend est la source de vérité unique. Le client ne fait qu'afficher l'état et envoyer des requêtes.
2.  **Structure Hybride :** Un Hub Persistant (social) d'où sont lancées des Sessions de Jeu instanciées (gameplay).
3.  **Client "Écouter, Afficher, Demander" :** Le frontend est réactif, s'abonnant aux changements de l'état du jeu sur Firestore pour se mettre à jour.

### 3.3. Schéma Détaillé de la Base de Données (Firestore)

-   **`users` :** Profils joueurs (xp, mana, inventaire, stats, guilde, etc.).
-   **`games` :** État des sessions de jeu en cours et terminées.
-   **`guilds` :** Informations sur les Maisons de Sorciers.
-   **`koreanContentBible` :** Contenu pédagogique (mots, règles, etc.).

### 3.4. Catalogue des Cloud Functions (API du Jeu)

-   **Gestion de Session :** `createGame`, `joinGame`, `startGame`.
-   **Gameplay en Session :** `rollDice`, `resolveTileAction`, `castSpell`.
-   **Fonctions Sociales :** `createGuild`, `joinGuild`, `leaveGuild`.
-   **Fonctions de Mini-Jeux :** `sendTyphoonAttack`.
-   **Système de Quêtes :** `acceptQuest`, `turnInQuest`, `updateQuestProgress`.

---

## 4. Feuille de Route & Kanban

### 4.1. Phase Terminé (MVP & Alpha)

-   Infrastructure complète, authentification, lobby de base, boucle de jeu simple, refactorisation en architecture serveur-autoritaire, implémentation de la condition de victoire et des sorts de base.

### 4.2. Phase Actuelle (Bêta)

-   `[BETA-HUB-001]` Développement du Hub Persistant.
-   `[BETA-GUILDS-001]` Système de Guildes/Maisons de Sorciers.
-   `[BETA-MINIGAME-003]` Développement du mini-jeu "Hangeul Typhoon".
-   `[BETA-STATS-001]` Implémentation du Système de Statistiques et de Hauts Faits.
-   `[BETA-BALANCE-001]` Phase d'équilibrage majeure.
-   `[BETA-MOBILE-001]` Optimisation pour l'expérience mobile.
-   `[BETA-QUESTS-001]` Implémentation du Système de Quêtes.

### 4.3. Extensions Futures (Post-Bêta / Live-Ops)

-   **Système de "Rune Mnémonique" (User-Generated Content).**
-   **Gameplay d'Instance et "Trinité Linguistique" (DPS, Healer, Tank).**
-   **Nouveau Contenu :** Régions, quêtes, sorts, mini-jeux.
-   **Événements Saisonniers.**

---

## 5. Guide du Développeur

### 5.1. Setup de l'Environnement

1.  **Frontend (`korean-party-client`) :** `npm install`, puis `npm run dev`. Nécessite un fichier `.env.local` avec les clés Firebase.
2.  **Backend (`korean-party-functions`) :** `npm install`, puis `firebase deploy --only functions`. Nécessite Firebase CLI.

### 5.2. Principes Architecturaux Clés

-   **Serveur Autoritaire :** La logique critique est sur le serveur. Pas d'exception.
-   **"Écouter, Afficher, Demander" :** Le frontend est un miroir réactif de l'état de Firestore.
-   **Services :** Les appels au backend sont centralisés dans des fonctions de service.

### 5.3. Processus de Travail

Pour toute nouvelle fonctionnalité, le processus est : **1. Analyse & Proposition** → **2. Validation** → **3. Implémentation**.
