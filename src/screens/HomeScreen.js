import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import * as ProgressService from "../services/ProgressService";

const RECENT_FILES_KEY = "@recent_files";

export default function HomeScreen() {
  const navigation = useNavigation();
  const { colors, isDark, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [recentFiles, setRecentFiles] = useState([]);
  const [progressMap, setProgressMap] = useState(new Map());

  // Header icons: theme toggle + settings
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          <TouchableOpacity
            onPress={toggleTheme}
            style={styles.headerIconBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.headerIcon}>
              {isDark ? "\u2600\uFE0F" : "\uD83C\uDF19"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate("OcrKeySettings")}
            style={styles.headerIconBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.headerIcon}>{"\u2699\uFE0F"}</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, isDark, toggleTheme, styles]);

  // Reload files + progress every time screen is focused
  useFocusEffect(
    useCallback(() => {
      loadRecentFiles();
    }, []),
  );

  async function loadRecentFiles() {
    try {
      const stored = await AsyncStorage.getItem(RECENT_FILES_KEY);
      if (stored) {
        const files = JSON.parse(stored);
        setRecentFiles(files);
        const uris = files.map((f) => f.uri);
        const pm = await ProgressService.loadProgressForFiles(uris);
        setProgressMap(pm);
      }
    } catch {
      // ignore read errors
    }
  }

  async function saveRecentFile(file) {
    try {
      const updated = [
        file,
        ...recentFiles.filter((f) => f.uri !== file.uri),
      ].slice(0, 20);
      setRecentFiles(updated);
      await AsyncStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated));
    } catch {
      // ignore write errors
    }
  }

  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      const file = {
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? 0,
        lastOpened: Date.now(),
      };

      await saveRecentFile(file);
      navigation.navigate("PDFViewer", {
        uri: file.uri,
        fileName: file.name,
      });
    } catch (error) {
      Alert.alert("Error", "Could not open file. Please try again.");
    }
  }

  function handleOpenRecent(file) {
    navigation.navigate("PDFViewer", {
      uri: file.uri,
      fileName: file.name,
    });
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function renderItem({ item }) {
    const prog = progressMap.get(item.uri);
    const progLabel =
      prog && prog.totalPages > 0
        ? `Trang ${prog.currentPage}/${prog.totalPages} (${Math.round((prog.currentPage / prog.totalPages) * 100)}%)`
        : null;

    return (
      <TouchableOpacity
        style={styles.fileCard}
        onPress={() => handleOpenRecent(item)}
        activeOpacity={0.7}
      >
        <View style={styles.fileIcon}>
          <Text style={styles.fileIconText}>PDF</Text>
          {prog && (
            <View
              style={[
                styles.progressBar,
                {
                  height: Math.max(
                    2,
                    (52 * prog.currentPage) / (prog.totalPages || 1),
                  ),
                },
              ]}
            />
          )}
        </View>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.fileMeta}>
            {formatSize(item.size)}
            {item.lastOpened ? `  ·  ${formatDate(item.lastOpened)}` : ""}
          </Text>
          {progLabel && <Text style={styles.progressLabel}>{progLabel}</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Open button */}
      <TouchableOpacity
        style={styles.openButton}
        onPress={handlePickFile}
        activeOpacity={0.85}
      >
        <Text style={styles.openButtonText}>+ Mo File PDF</Text>
      </TouchableOpacity>

      {/* Recent files */}
      {recentFiles.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>File gan day</Text>
          <FlatList
            data={recentFiles}
            keyExtractor={(item) => item.uri}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📄</Text>
          <Text style={styles.emptyTitle}>Chua co file nao</Text>
          <Text style={styles.emptySubtitle}>
            Nhan nut phia tren de mo file PDF
          </Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 20,
      backgroundColor: c.background,
    },
    openButton: {
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      marginBottom: 24,
      elevation: 2,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    openButtonText: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
    headerButtons: {
      flexDirection: "row",
      alignItems: "center",
      marginRight: -4,
    },
    headerIconBtn: { padding: 8 },
    headerIcon: { fontSize: 20 },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: c.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    listContent: { paddingBottom: 32 },
    fileCard: {
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 14,
      marginBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.border,
      elevation: 1,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 2,
    },
    fileIcon: {
      width: 44,
      height: 52,
      backgroundColor: c.primaryLight,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 14,
      overflow: "hidden",
    },
    progressBar: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.primary,
      opacity: 0.35,
    },
    fileIconText: {
      color: c.primary,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    fileInfo: { flex: 1 },
    fileName: {
      fontSize: 15,
      fontWeight: "600",
      color: c.text,
      marginBottom: 4,
    },
    fileMeta: { fontSize: 12, color: c.textSecondary },
    progressLabel: {
      fontSize: 11,
      color: c.primary,
      fontWeight: "600",
      marginTop: 4,
    },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingBottom: 80,
    },
    emptyIcon: { fontSize: 56, marginBottom: 16 },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: c.text,
      marginBottom: 8,
    },
    emptySubtitle: {
      fontSize: 14,
      color: c.textSecondary,
      textAlign: "center",
    },
  });
}
