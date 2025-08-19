# Comment faire tourner le projet et les tests en local

Ce document explique comment configurer et lancer l'environnement de développement local, ainsi que comment exécuter les différentes suites de tests.

## Prérequis

- [Node.js](https://nodejs.org/) (version 18 ou supérieure)
- npm (généralement inclus avec Node.js)
- [Python](https://www.python.org/) (version 3.x)
- [Firebase CLI](https://firebase.google.com/docs/cli#setup_update_cli) (`npm install -g firebase-tools`)

## Lancer le projet en local

Le projet utilise les émulateurs Firebase pour simuler l'environnement backend (Cloud Functions, Firestore) sur votre machine locale.

1.  **Installer les dépendances Node.js :**
    À la racine du projet, exécutez la commande suivante pour installer les paquets nécessaires définis dans `package.json` :
    ```bash
    npm install
    ```

2.  **Lancer les émulateurs Firebase :**
    Une fois les dépendances installées, utilisez le script npm suivant pour compiler le code TypeScript et démarrer les émulateurs :
    ```bash
    npm run serve
    ```
    Cette commande va :
    -   Compiler les fichiers TypeScript du dossier `src/` vers le dossier `lib/`.
    -   Démarrer les émulateurs pour les Cloud Functions et Firestore.
    -   Vous verrez apparaître les logs des émulateurs dans votre terminal, indiquant qu'ils sont prêts à recevoir des requêtes.

## Exécuter les tests

Le projet contient des tests pour le code TypeScript (backend) et pour la logique des mini-jeux en Python.

### Tests TypeScript (Backend)

Il existe deux types de tests pour la partie TypeScript du projet.

#### 1. Tests Mocha

Ces tests couvrent les fonctionnalités principales des Cloud Functions. Pour les lancer, exécutez :
```bash
npm test
```
Cette commande utilise les émulateurs Firebase pour exécuter les tests d'intégration dans un environnement contrôlé.

#### 2. Tests Jest

Une autre suite de tests est configurée avec Jest. Pour les exécuter, utilisez :
```bash
npm run test:jest
```

### Tests Python (Mini-jeux)

Les tests pour les mini-jeux en Python sont écrits avec le module `unittest` de Python et ne nécessitent aucune dépendance externe.

Vous pouvez les exécuter individuellement en lançant chaque fichier de test avec Python.

-   **Test pour le mini-jeu "Food Feast" :**
    ```bash
    python3 test_food_feast_minigame.py
    ```

-   **Test pour le mini-jeu "Namdaemun" :**
    ```bash
    python3 test_namdaemun_minigame.py
    ```

-   **Test pour le mini-jeu "Poem" :**
    ```bash
    python3 test_poem_minigame.py
    ```

Chaque commande exécutera les tests pour le mini-jeu correspondant et affichera les résultats dans le terminal.
