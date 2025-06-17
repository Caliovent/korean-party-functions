# Spécifications Détaillées : Mini-Jeu "Hangeul Typhoon"

**Version :** 1.0
**Date :** 10 juin 2025
**Tâche de Conception Associée :** `[ALPHA-DESIGN-001]`
**Tâche de Développement Associée :** `[BETA-MINIGAME-003]`

---

## 1. Vue d'Ensemble & Objectifs Pédagogiques

### 1.1. Concept Général

"Hangeul Typhoon" est un mini-jeu d'action et de vitesse basé sur la saisie au clavier. Des blocs contenant des caractères ou des mots tombent du haut de l'écran. Le joueur doit taper correctement le contenu du bloc pour le détruire avant qu'il n'atteigne le sol. Le jeu propose un mode solo progressif et un mode duel hautement interactif.

### 1.2. Objectifs Pédagogiques Clés

Ce mini-jeu est une plateforme polyvalente visant à développer plusieurs compétences distinctes :

-   **Maîtrise du Clavier Coréen :** Forger la mémoire musculaire et l'automatisme de la frappe en Hangeul (Mode "Épreuve du Scribe").
-   **Rappel Actif de Vocabulaire :** Forcer le cerveau à retrouver un mot coréen à partir de sa traduction (Mode "Défi de l'Interprète").
-   **Reconnaissance et Compréhension :** Tester la capacité à lire et comprendre rapidement un mot en coréen (Mode "Test du Traducteur").

---

## 2. Mécaniques de Jeu Fondamentales

### 2.1. L'Aire de Jeu

L'écran de jeu est divisé verticalement.
-   **Zone Joueur (principale) :** Occupe environ 70% de l'espace. C'est ici que les blocs du joueur tombent.
-   **Zone Adversaire (secondaire, mode duel uniquement) :** Occupe environ 30% de l'espace et affiche une vue miniature en temps réel de l'aire de jeu de l'adversaire.
-   **HUD (Affichage Tête Haute) :** Affiche en permanence le score, le mode de jeu, les combos, et d'autres informations pertinentes.
-   **Champ de Saisie :** Une zone de texte en bas de l'aire de jeu affiche l'input actuel du joueur.

### 2.2. La Chute des Blocs

-   Les blocs apparaissent en haut de l'écran et tombent à une vitesse définie.
-   La vitesse de chute et la fréquence d'apparition augmentent progressivement pour intensifier le défi.

### 2.3. L'Input Joueur et la Destruction

-   Le jeu capture les frappes au clavier en temps réel.
-   Lorsque la séquence tapée par le joueur correspond au contenu d'un bloc, ce dernier est visuellement mis en surbrillance.
-   La validation (touche Entrée ou Espace) déclenche la destruction du bloc ciblé, accompagnée d'un effet visuel et sonore satisfaisant.

### 2.4. La Condition de Défaite (Mode Solo & Duel)

-   Le "sol" est une ligne en bas de l'aire de jeu.
-   Si un bloc non détruit touche ce sol, la partie est immédiatement perdue pour ce joueur.

---

## 3. Les Modes de Jeu

Le mode de jeu est déterminé par le contexte de lancement (ex: la case du plateau).

### 3.1. Mode "Épreuve du Scribe" (Hangeul → Hangeul)

-   **Contenu des Blocs :** Caractères Hangeul (`ㄱ`, `ㅏ`), syllabes (`가`, `나`), ou mots coréens (`가나다`).
-   **Input Requis :** Le joueur doit taper la séquence Hangeul correspondante en utilisant un clavier configuré en coréen.

### 3.2. Mode "Défi de l'Interprète" (Langue Maternelle → Coréen)

-   **Contenu des Blocs :** Un mot en français ou en anglais (ex: "Maison").
-   **Input Requis :** Le joueur doit taper la traduction coréenne du mot (ex: `집`).

### 3.3. Mode "Test du Traducteur" (Coréen → Langue Maternelle)

-   **Contenu des Blocs :** Un mot coréen (ex: `집`).
-   **Input Requis :** Le joueur doit taper la traduction française ou anglaise ("Maison") avec son clavier standard.

---

## 4. Le Mode Duel : L'Art de l'Offensive Ciblée

### 4.1. Le Principe de Vulnérabilité

-   Lorsqu'un bloc apparaît sur l'écran d'un joueur, il est initialement dans un état **"protégé"**.
-   Après un délai de **5 secondes**, s'il n'a pas été détruit, son état passe à **"vulnérable"**.

### 4.2. Le Signal Visuel (UI/UX)

-   Un bloc **protégé** est de couleur **noire**. Il ne peut être détruit que par son propriétaire.
-   Un bloc **vulnérable** est de couleur **blanche**. Il peut être détruit par son propriétaire OU par une attaque de l'adversaire. La transition de noir à blanc doit être claire et accompagnée d'une légère animation (ex: pulsation lumineuse).

### 4.3. La Mécanique d'Attaque

-   Pour attaquer l'écran de l'adversaire, un joueur doit utiliser un préfixe de ciblage : `<>`.
-   **Flux d'attaque :** Le joueur tape la séquence `<mot_cible>` (ex: `<안녕하세요>`).
-   L'action envoie une requête à la fonction serveur `sendTyphoonAttack` pour validation.

### 4.4. Les Conséquences de l'Attaque

-   **En cas de SUCCÈS** (le `mot_cible` correspond à un bloc **blanc/vulnérable** sur l'écran de l'adversaire) :
    1.  Le bloc est détruit sur l'écran de l'adversaire.
    2.  Le **sol de l'adversaire monte**, réduisant son aire de jeu. La hauteur de la montée est proportionnelle à la complexité du mot détruit (paramètre à équilibrer).
-   **En cas d'ÉCHEC** (le `mot_cible` ne correspond à aucun bloc vulnérable, ou cible un bloc noir) :
    1.  L'attaque est annulée.
    2.  Le **sol de l'attaquant monte** en guise de pénalité pour son erreur.
    3.  Un feedback visuel et sonore (ex: un son d'échec, un flash rouge sur le sol de l'attaquant) notifie immédiatement le joueur de son erreur.

### 4.5. Condition de Victoire du Duel

Le dernier joueur dont le sol n'a pas atteint le sommet de son aire de jeu est déclaré vainqueur.

---

## 5. Scoring et Progression (Mode Solo)

-   **Système de Points :** +10 points par caractère simple, +50 par syllabe, +100 par mot.
-   **Bonus de Combo :** Un multiplicateur de score s'active lorsque des blocs sont détruits en succession rapide.
-   **Difficulté Progressive :** La vitesse de chute des blocs augmente par paliers, tous les 1000 points par exemple.

---

## 6. Intégration dans le Jeu Principal

-   **Déclenchement :** Le jeu peut être lancé depuis :
    -   Une case "Dojo du Clavier" sur le plateau (mode "Scribe").
    -   Une case "Duel" où les joueurs choisissent leur mode.
    -   Une case "Quiz" comme alternative au QCM (modes "Interprète" ou "Traducteur").
-   **Récompenses :** Le vainqueur d'un duel ou le joueur atteignant un certain palier de score en solo gagne de l'XP et du Mana.

---

## 7. Spécifications des Assets

-   **Visuels :**
    -   Sprites pour les blocs (design sobre et lisible).
    -   Sprites pour les caractères Hangeul et latins.
    -   Arrière-plan de la scène (thème "Dojo magique" ou "Bibliothèque mystique").
    -   Effets de particules pour la destruction des blocs.
    -   Animation pour la montée du sol.
    -   Éléments d'interface (HUD, score, etc.).
-   **Audio :**
    -   Musique de fond (une piste pour le mode solo, une autre plus intense pour le duel).
    -   Son de frappe au clavier.
    -   Son de destruction de bloc (satisfaisant).
    -   Son d'attaque réussie (envoyée).
    * Son d'attaque subie (sol qui monte).
    * Son d'échec d'attaque (pénalité).
    * Sons de victoire et de défaite.