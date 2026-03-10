module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.mjs'],
  transform: {},
  collectCoverageFrom: ['dist/learnings/**/*.js']
};
