// Restores Node's fetch after jest-expo's setup (see environment.js).
Object.assign(globalThis, globalThis.__nodeFetch);
