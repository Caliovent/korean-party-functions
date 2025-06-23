/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'], // Chercher les fichiers .test.ts dans src/
  testTimeout: 30000, // Augmenter le timeout pour les tests d'intégration avec émulateurs
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,
};
