/**
 * VoiceSettingScreen
 *
 * Cho phep user:
 *  - Xem danh sach giong doc co san tren thiet bi
 *  - Chon giong vi-VN uu tien, preview tung giong
 *  - Luu lua chon vao AsyncStorage, TTSService su dung ngay
 *  - Mo cai dat Android de tai them giong
 *
 * NOTE: Danh sach giong phu thuoc vao OS va cac goi ngon ngu da cai.
 * Neu khong co giong vi-VN, user can vao Settings > TTS de tai them.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import * as Speech from "expo-speech";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import * as TTSService from "../services/TTSService";

const VOICE_KEY = "tts_voice_id";
const PREVIEW_TEXT = "Xin chao, toi la giao vien day nghe doc tieng Viet.";

export default function VoiceSettingScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [previewingId, setPreviewingId] = useState(null);

  // Load saved voice & available voices
  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function init() {
        setLoading(true);
        try {
          const [savedId, allVoices] = await Promise.all([
            AsyncStorage.getItem(VOICE_KEY),
            Speech.getAvailableVoicesAsync(),
          ]);
          if (!active) return;
          if (savedId) setSelectedId(savedId);
          // Sort: vi-VN first, then alphabetical by language
          const sorted = [...allVoices].sort((a, b) => {
            const aVi = a.language?.startsWith("vi") ? 0 : 1;
            const bVi = b.language?.startsWith("vi") ? 0 : 1;
            if (aVi !== bVi) return aVi - bVi;
            return (a.language || "").localeCompare(b.language || "");
          });
          setVoices(sorted);
        } catch {
          if (active) setVoices([]);
        } finally {
          if (active) setLoading(false);
        }
      }
      init();
      return () => {
        active = false;
        Speech.stop();
      };
    }, []),
  );

  async function selectVoice(voice) {
    const id = voice ? voice.identifier : null;
    setSelectedId(id);
    TTSService.setVoiceId(id);
    try {
      await AsyncStorage.setItem(VOICE_KEY, id || "");
    } catch {}
  }

  function previewVoice(voice) {
    if (previewingId === voice.identifier) {
      Speech.stop();
      setPreviewingId(null);
      return;
    }
    Speech.stop();
    setPreviewingId(voice.identifier);
    Speech.speak(PREVIEW_TEXT, {
      voice: voice.identifier,
      language: voice.language || "vi-VN",
      rate: 1.0,
      onDone: () => setPreviewingId(null),
      onError: () => setPreviewingId(null),
      onStopped: () => setPreviewingId(null),
    });
  }

  function openTtsSettings() {
    if (Platform.OS === "android") {
      Linking.sendIntent("com.android.settings.TTS_SETTINGS").catch(() => {
        Alert.alert(
          "Khong mo duoc",
          "Vao Cai dat > Quan ly chung > Ngon ngu va ban phim > Van ban thanh giong noi",
        );
      });
    } else {
      Alert.alert(
        "Tai them giong",
        "Vao Cai dat > Pho cap > Giong noi > Quan ly giong noi",
      );
    }
  }

  const viVoices = voices.filter((v) => v.language?.startsWith("vi"));
  const otherVoices = voices.filter((v) => !v.language?.startsWith("vi"));

  function renderVoice({ item }) {
    const isSelected = item.identifier === selectedId;
    const isPreviewing = item.identifier === previewingId;
    return (
      <View style={[styles.row, isSelected && styles.rowSelected]}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => selectVoice(item)}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <Text style={[styles.voiceName, isSelected && styles.voiceNameSel]}>
              {item.name || item.identifier}
            </Text>
            <Text style={styles.voiceMeta}>
              {item.language}
              {item.quality === "Enhanced" ? " · Enhanced" : ""}
            </Text>
          </View>
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.previewBtn, isPreviewing && styles.previewBtnActive]}
          onPress={() => previewVoice(item)}
          activeOpacity={0.7}
        >
          <Text style={styles.previewBtnText}>{isPreviewing ? "■" : "▶"}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function SectionHeader({ title }) {
    return <Text style={styles.sectionHeader}>{title}</Text>;
  }

  return (
    <View style={styles.container}>
      {/* Use system default */}
      <TouchableOpacity
        style={[
          styles.row,
          styles.defaultRow,
          !selectedId && styles.rowSelected,
        ]}
        onPress={() => selectVoice(null)}
        activeOpacity={0.7}
      >
        <View style={styles.rowLeft}>
          <Text style={[styles.voiceName, !selectedId && styles.voiceNameSel]}>
            Mac dinh cua he thong
          </Text>
          <Text style={styles.voiceMeta}>Vi-VN tu cai dat Android</Text>
        </View>
        {!selectedId && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Dang tai danh sach giong...</Text>
        </View>
      ) : voices.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Khong tim thay giong nao. Tai them giong tieng Viet de co nhieu lua
            chon hon.
          </Text>
          <TouchableOpacity style={styles.openBtn} onPress={openTtsSettings}>
            <Text style={styles.openBtnText}>Mo cai dat TTS</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={[
            ...(viVoices.length > 0
              ? [{ _header: "TIENG VIET" }, ...viVoices]
              : []),
            ...(otherVoices.length > 0
              ? [{ _header: "NGON NGU KHAC" }, ...otherVoices]
              : []),
          ]}
          keyExtractor={(item, i) =>
            item._header || item.identifier || String(i)
          }
          renderItem={({ item }) =>
            item._header ? (
              <SectionHeader title={item._header} />
            ) : (
              renderVoice({ item })
            )
          }
          contentContainerStyle={styles.list}
          ListFooterComponent={
            <TouchableOpacity style={styles.openBtn} onPress={openTtsSettings}>
              <Text style={styles.openBtnText}>
                Tai them giong vao thiet bi...
              </Text>
            </TouchableOpacity>
          }
        />
      )}
    </View>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    list: { paddingBottom: 32, paddingHorizontal: 0 },

    sectionHeader: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textSecondary,
      letterSpacing: 0.8,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 6,
      backgroundColor: c.background,
    },

    defaultRow: {
      marginHorizontal: 0,
      marginBottom: 0,
      borderRadius: 0,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowSelected: {
      backgroundColor: c.primaryLight,
    },
    rowMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    rowLeft: { flex: 1 },

    voiceName: {
      fontSize: 15,
      fontWeight: "500",
      color: c.text,
      marginBottom: 2,
    },
    voiceNameSel: { color: c.primary, fontWeight: "700" },
    voiceMeta: { fontSize: 12, color: c.textSecondary },
    checkmark: {
      fontSize: 18,
      color: c.primary,
      marginRight: 8,
      fontWeight: "700",
    },

    previewBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.background,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: c.border,
    },
    previewBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
    previewBtnText: { fontSize: 13, color: c.text },

    loadingBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    loadingText: { color: c.textSecondary, fontSize: 14 },

    emptyBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      gap: 16,
    },
    emptyText: {
      color: c.textSecondary,
      fontSize: 14,
      textAlign: "center",
      lineHeight: 22,
    },

    openBtn: {
      margin: 16,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    openBtnText: { color: c.primary, fontSize: 14, fontWeight: "600" },
  });
}
