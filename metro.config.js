// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

/**
 * Force react-native-track-player to resolve through its pre-compiled
 * lib/src/index.js instead of the TypeScript src/index.ts that Metro
 * picks up via the "react-native" package.json field.
 *
 * Without this, Metro 0.83 crashes during module graph traversal because
 * the TypeScript source's Capability enum uses computed values from
 * NativeModules.TrackPlayerModule, which is null when no native build is
 * present, causing nullthrows() to throw before Hermes ever runs the bundle.
 */
config.resolver = config.resolver ?? {};
const _original = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-track-player") {
    return {
      filePath: path.resolve(
        __dirname,
        "node_modules/react-native-track-player/lib/src/index.js",
      ),
      type: "sourceFile",
    };
  }
  // Fall through to default resolver for everything else
  if (_original) return _original(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
