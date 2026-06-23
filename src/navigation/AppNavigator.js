import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../context/ThemeContext";
import HomeScreen from "../screens/HomeScreen";
import OcrKeySettingsScreen from "../screens/OcrKeySettingsScreen";
import PDFViewerScreen from "../screens/PDFViewerScreen";
import VoiceSettingScreen from "../screens/VoiceSettingScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: "#FFFFFF",
        headerTitleStyle: { fontWeight: "bold" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: "PDF Reader Friend" }}
      />
      <Stack.Screen
        name="PDFViewer"
        component={PDFViewerScreen}
        options={({ route }) => ({
          title: route.params?.fileName ?? "Reading",
          headerBackTitle: "Back",
        })}
      />
      <Stack.Screen
        name="OcrKeySettings"
        component={OcrKeySettingsScreen}
        options={{ title: "Cai dat OCR Key" }}
      />
      <Stack.Screen
        name="VoiceSettings"
        component={VoiceSettingScreen}
        options={{ title: "Giong doc" }}
      />
    </Stack.Navigator>
  );
}
