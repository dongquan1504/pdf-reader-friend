import { registerRootComponent } from "expo";
import App from "./App";

// Register RNTP background playback service.
// Wrapped in try/catch so the app still starts on builds without the RNTP native module.
try {
  const TrackPlayer = require("react-native-track-player").default;
  const { PlaybackService } = require("./src/services/TrackPlayerService");
  TrackPlayer.registerPlaybackService(() => PlaybackService);
} catch (e) {
  console.warn("[index] RNTP registration failed:", e?.message);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
