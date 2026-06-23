/**
 * TrackPlayerService — background remote-control handler for react-native-track-player.
 *
 * This runs in a separate JS context (background thread) on Android.
 * It handles lock-screen / notification button presses and delegates to TTSService.
 *
 * Registration: must be called from index.js (root entry point).
 */
import TrackPlayer, { Event } from "react-native-track-player";

export async function PlaybackService() {
  // Remote play (notification ▶ button or headset button)
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  // Remote pause (notification ⏸ button or headset button)
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  // Remote stop
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop();
  });

  // Next (skip to next page — forwarded to app via custom event)
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    // Handled in PDFViewerScreen via useTrackPlayerEvents
    TrackPlayer.skipToNext().catch(() => {});
  });

  // Previous (skip to previous page)
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious().catch(() => {});
  });

  // Seek (scrubbing from lock screen)
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
    TrackPlayer.seekTo(position);
  });
}
