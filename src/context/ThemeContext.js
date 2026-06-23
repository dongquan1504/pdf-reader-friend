/**
 * ThemeContext
 *
 * Provides { colors, isDark, toggleTheme } to all screens.
 * Persists the user's theme choice in AsyncStorage.
 *
 * Usage:
 *   const { colors, isDark, toggleTheme } = useTheme();
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { darkColors, lightColors } from "../constants/colors";

const THEME_KEY = "@app_theme";

const ThemeContext = createContext({
  colors: lightColors,
  isDark: false,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);

  // Load persisted preference on startup
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((val) => {
        if (val === "dark") setIsDark(true);
      })
      .catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? "dark" : "light").catch(() => {});
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        colors: isDark ? darkColors : lightColors,
        isDark,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
