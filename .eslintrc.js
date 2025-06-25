module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
    tsconfigRootDir: __dirname, // Dit à ESLint de chercher tsconfig.json ici
  },
  ignorePatterns: [
    "functions/lib/**/*", // Ignore les fichiers compilés dans le dossier lib
    "lib/**/*", // Ignore les fichiers JavaScript compilés
    "jest.config.js",
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "linebreak-style": 0, // Ignore les erreurs de fin de ligne (Windows vs Mac/Linux)
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    "max-len": ["error", { "code": 120 }],
    "object-curly-spacing": ["error", "always"], // Corrige les erreurs d'espacement des accolades
  },
};
