/**
 * OcrKeySettingsScreen
 *
 * Cho phep user:
 *  - Xem danh sach key dang co (built-in + tu them)
 *  - Them key moi cua ca nhan (dang ky mien phi tai ocr.space/OCRAPI)
 *  - Xoa key tu them
 *  - Dat lai trang thai "het luot" khi dau thang moi
 *
 * Moi key mien phi co 25.000 luot/thang.
 * App tu dong chuyen sang key tiep theo khi het luot.
 */
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import * as OcrKeyService from "../services/OcrKeyService";

export default function OcrKeySettingsScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, []),
  );

  async function reload() {
    const list = await OcrKeyService.listKeys();
    setKeys(list);
  }

  async function handleAdd() {
    const trimmed = newKey.trim().toUpperCase();
    if (trimmed.length < 8) {
      Alert.alert(
        "Key khong hop le",
        "Vui long nhap dung API key tu trang ocr.space/OCRAPI.",
      );
      return;
    }
    setAdding(true);
    try {
      const added = await OcrKeyService.addKey(
        trimmed,
        newLabel.trim() || "Key cua toi",
      );
      if (!added) {
        Alert.alert("Trung lap", "Key nay da co trong danh sach roi.");
      } else {
        setNewKey("");
        setNewLabel("");
        await reload();
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(item) {
    Alert.alert("Xoa key", 'Xoa key "' + item.label + '"?', [
      { text: "Huy", style: "cancel" },
      {
        text: "Xoa",
        style: "destructive",
        onPress: async () => {
          await OcrKeyService.removeKey(item.key);
          await reload();
        },
      },
    ]);
  }

  async function handleResetQuota() {
    Alert.alert(
      "Dat lai trang thai",
      "Dat lai trang thai 'het luot' cua tat ca key? Lam viec nay dau moi thang.",
      [
        { text: "Huy", style: "cancel" },
        {
          text: "Dat lai",
          onPress: async () => {
            await OcrKeyService.resetAllQuotas();
            await reload();
          },
        },
      ],
    );
  }

  const hasExceeded = keys.some((k) => k.quotaExceeded);
  const activeCount = keys.filter((k) => !k.quotaExceeded).length;

  function maskKey(key) {
    if (key.length <= 8) return key;
    return key.slice(0, 4) + "..." + key.slice(-4);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Huong dan ─────────────────────────────────────────────── */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>OCR.space API Key</Text>
        <Text style={styles.infoText}>
          App dung OCR.space de nhan dang chu trong anh (scan PDF hoac chu bi
          loi font). Moi key mien phi co{" "}
          <Text style={styles.infoHighlight}>25.000 luot/thang</Text>. App tu
          dong chuyen sang key tiep theo khi het luot.
        </Text>

        <View style={styles.stepList}>
          <Text style={styles.stepItem}>1. Vao trang dang ky phia duoi</Text>
          <Text style={styles.stepItem}>2. Dien email → nhan key qua mail</Text>
          <Text style={styles.stepItem}>
            3. Copy key va nhap vao o ben duoi
          </Text>
          <Text style={styles.stepItem}>
            4. Them nhieu key = nhieu luot hon moi thang
          </Text>
        </View>

        <TouchableOpacity
          style={styles.registerBtn}
          onPress={() => Linking.openURL("https://ocr.space/OCRAPI")}
          activeOpacity={0.8}
        >
          <Text style={styles.registerBtnText}>
            Dang ky key mien phi tai ocr.space/OCRAPI
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Giong doc ─────────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.voiceNavBtn}
        onPress={() => navigation.navigate("VoiceSettings")}
        activeOpacity={0.7}
      >
        <Text style={styles.voiceNavText}>
          {"\uD83C\uDFA4  Cai dat giong doc TTS"}
        </Text>
        <Text style={styles.voiceNavArrow}>{">"}</Text>
      </TouchableOpacity>

      {/* ── Trang thai tong quan ───────────────────────────────────── */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {activeCount > 0
            ? activeCount + "/" + keys.length + " key con luot"
            : "Tat ca key da het luot!"}
        </Text>
        {hasExceeded && (
          <TouchableOpacity onPress={handleResetQuota}>
            <Text style={styles.resetLink}>Dat lai</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Danh sach key ─────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>DANH SACH KEY ({keys.length})</Text>

      {keys.length === 0 && (
        <Text style={styles.emptyText}>Chua co key nao.</Text>
      )}

      {keys.map((item) => (
        <View key={item.key} style={styles.keyCard}>
          <View style={styles.keyCardLeft}>
            <Text style={styles.keyLabel} numberOfLines={1}>
              {item.label}
              {item.isBuiltin ? (
                <Text style={styles.builtinTag}> (mac dinh)</Text>
              ) : null}
            </Text>
            <Text style={styles.keyValue}>{maskKey(item.key)}</Text>
          </View>

          <View style={styles.keyCardRight}>
            <View
              style={[
                styles.badge,
                item.quotaExceeded ? styles.badgeRed : styles.badgeGreen,
              ]}
            >
              <Text style={styles.badgeText}>
                {item.quotaExceeded ? "Het luot" : "Con luot"}
              </Text>
            </View>

            {!item.isBuiltin && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDelete(item)}
              >
                <Text style={styles.deleteBtnText}>Xoa</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      {/* ── Them key moi ──────────────────────────────────────────── */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>THEM KEY MOI</Text>

      <View style={styles.addForm}>
        <TextInput
          style={styles.input}
          placeholder="API Key (vi du: K12345678...)"
          placeholderTextColor={colors.textSecondary}
          value={newKey}
          onChangeText={setNewKey}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
        />
        <TextInput
          style={styles.input}
          placeholder="Ten goi nho (vi du: Key cua toi, Key 2...)"
          placeholderTextColor={colors.textSecondary}
          value={newLabel}
          onChangeText={setNewLabel}
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.addBtn, adding && styles.addBtnDisabled]}
          onPress={handleAdd}
          disabled={adding}
          activeOpacity={0.8}
        >
          <Text style={styles.addBtnText}>
            {adding ? "Dang them..." : "Them Key"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 16,
    },

    // Info card
    infoCard: {
      backgroundColor: c.primaryLight,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.primary + "40",
    },
    infoTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.primary,
      marginBottom: 8,
    },
    infoText: {
      fontSize: 14,
      color: c.text,
      lineHeight: 20,
      marginBottom: 12,
    },
    infoHighlight: {
      fontWeight: "700",
      color: c.primary,
    },
    stepList: {
      marginBottom: 14,
      gap: 4,
    },
    stepItem: {
      fontSize: 13,
      color: c.text,
      lineHeight: 20,
    },
    registerBtn: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    registerBtnText: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "600",
    },

    // Voice nav button
    voiceNavBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.surface,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 13,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: c.border,
    },
    voiceNavText: { fontSize: 14, fontWeight: "600", color: c.text },
    voiceNavArrow: { fontSize: 16, color: c.textSecondary },

    // Status bar
    statusBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    statusText: {
      fontSize: 13,
      color: c.textSecondary,
    },
    resetLink: {
      fontSize: 13,
      color: c.primary,
      fontWeight: "600",
    },

    // Section title
    sectionTitle: {
      fontSize: 12,
      fontWeight: "600",
      color: c.textSecondary,
      letterSpacing: 0.8,
      marginBottom: 10,
    },
    emptyText: {
      fontSize: 14,
      color: c.textSecondary,
      fontStyle: "italic",
      marginBottom: 12,
    },

    // Key card
    keyCard: {
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: c.border,
      elevation: 1,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
    },
    keyCardLeft: {
      flex: 1,
      marginRight: 8,
    },
    keyLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: c.text,
      marginBottom: 2,
    },
    builtinTag: {
      fontSize: 12,
      fontWeight: "400",
      color: c.textSecondary,
    },
    keyValue: {
      fontSize: 12,
      color: c.textSecondary,
      fontFamily: "monospace",
    },
    keyCardRight: {
      alignItems: "flex-end",
      gap: 6,
    },
    badge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeGreen: {
      backgroundColor: "#DCFCE7",
    },
    badgeRed: {
      backgroundColor: "#FEE2E2",
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "600",
      color: c.text,
    },
    deleteBtn: {
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    deleteBtnText: {
      fontSize: 12,
      color: c.error,
      fontWeight: "600",
    },

    // Add form
    addForm: {
      gap: 10,
    },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      color: c.text,
    },
    addBtn: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    addBtnDisabled: {
      opacity: 0.6,
    },
    addBtnText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "700",
    },
  });
}
