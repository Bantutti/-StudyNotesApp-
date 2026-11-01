/**
 * Plain Node test environment for the emulator suite. jest-expo replaces
 * global fetch with Expo's fetch, which needs React Native; the Firebase
 * SDK and the emulator helpers need Node's real fetch, so it is kept here
 * and put back by test/e2e/setup.js.
 */
const { TestEnvironment } = require('jest-environment-node');

class E2EEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.__nodeFetch = { fetch, Headers, Request, Response };
  }
}

module.exports = E2EEnvironment;
