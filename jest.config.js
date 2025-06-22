module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  testTimeout: 30000, // Increased timeout for emulator tests
  moduleNameMapper: {
    '^firebase-admin/(.*)$': '<rootDir>/node_modules/firebase-admin/lib/$1',
  },
};
