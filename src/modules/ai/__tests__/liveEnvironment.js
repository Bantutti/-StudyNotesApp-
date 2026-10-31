/**
 * Jest environment for the opt-in live test only.
 * jest-expo's setup replaces global fetch with a React Native polyfill that
 * cannot reach the network in Node. This environment saves Node's native
 * fetch BEFORE the setup files run, as globalThis.__nativeFetch.
 */
const { TestEnvironment } = require('jest-environment-node');

class LiveEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.__nativeFetch = this.global.fetch;
  }
}

module.exports = LiveEnvironment;
