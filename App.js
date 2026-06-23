import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import AppNavigator from "./src/navigation/AppNavigator";
import * as TTSService from "./src/services/TTSService";

// Load persisted voice setting on startup + initialise RNTP player
function AppShell() {
  const { isDark } = useTheme();

  useEffect(() => {
    // Setup TrackPlayer (creates MediaSession / notification channel)
    TTSService.setupPlayer().catch(() => {});

    // Restore saved voice selection
    AsyncStorage.getItem("tts_voice_id")
      .then((id) => {
        if (id) TTSService.setVoiceId(id);
      })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style={isDark ? "light" : "dark"} />
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
