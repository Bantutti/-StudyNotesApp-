/**
 * Metro config (P2b).
 *
 * The app imports P2a's SDK-free cloud schemas from firebase/src (decision
 * Q14). That folder is its own npm project:
 *  - its TypeScript uses NodeNext ".js" import specifiers for ".ts" files,
 *    so inside firebase/src a relative "./x.js" is resolved to "./x.ts";
 *  - firebase/node_modules (P2a's test tooling) is hidden from Metro, so
 *    zod and the Firebase SDK always come from the app's node_modules and
 *    the bundle holds ONE copy of each.
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const firebaseSrc = path.join(__dirname, 'firebase', 'src') + path.sep;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${escape(path.join(__dirname, 'firebase', 'node_modules'))}[\\\\/].*`),
];

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (context.originModulePath.startsWith(firebaseSrc) && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    return resolve(context, moduleName.slice(0, -3) + '.ts', platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
