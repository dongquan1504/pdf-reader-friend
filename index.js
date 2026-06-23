import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { PlaybackService } from './src/services/TrackPlayerService';

// Register RNTP background playback service (required before any TrackPlayer calls)
TrackPlayer.registerPlaybackService(() => PlaybackService);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
