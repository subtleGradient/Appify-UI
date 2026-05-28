import { useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  CheckCircle2,
  ClipboardList,
  MapPin,
  Radio,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Truck,
} from "lucide-react-native";

const lanes = [
  {
    id: "north",
    label: "North pier",
    crew: "Crew A",
    eta: "09:42",
    confidence: 86,
    state: "clear",
    work: ["Gate sensor swap", "Cold aisle check", "Badge reader test"],
  },
  {
    id: "market",
    label: "Market hall",
    crew: "Crew C",
    eta: "10:10",
    confidence: 64,
    state: "watch",
    work: ["Queue monitor", "Payment kiosk reboot", "Floor lead handoff"],
  },
  {
    id: "dock",
    label: "Dock door 4",
    crew: "Crew B",
    eta: "10:28",
    confidence: 51,
    state: "blocked",
    work: ["Forklift lane hold", "Power relay inspect", "Vendor escort"],
  },
];

const tasks = [
  { id: "T-1204", title: "Verify spare scanner inventory", lane: "North pier", status: "ready", minutes: 12 },
  { id: "T-1205", title: "Send revised route to Crew C", lane: "Market hall", status: "active", minutes: 18 },
  { id: "T-1206", title: "Wait for facilities unlock", lane: "Dock door 4", status: "blocked", minutes: 31 },
  { id: "T-1207", title: "Capture after photo for release notes", lane: "North pier", status: "ready", minutes: 9 },
];

const modes = [
  { id: "dispatch", label: "Dispatch" },
  { id: "map", label: "Map" },
  { id: "review", label: "Review" },
];

const telemetry = [
  { label: "Crews", value: "3", detail: "active" },
  { label: "SLA", value: "92%", detail: "projected" },
  { label: "Blocks", value: "1", detail: "needs call" },
  { label: "Handoffs", value: "7", detail: "today" },
];

export default function App() {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState("dispatch");
  const [selectedLane, setSelectedLane] = useState("north");
  const [quietMode, setQuietMode] = useState(false);
  const split = width >= 920;
  const activeLane = lanes.find((lane) => lane.id === selectedLane) ?? lanes[0];

  const visibleTasks = useMemo(() => {
    if (mode === "review") return tasks;
    return tasks.filter((task) => task.lane === activeLane.label || task.status === "blocked");
  }, [activeLane.label, mode]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <Radio color={colors.teal} size={20} strokeWidth={2.2} />
            <View>
              <Text style={styles.eyebrow}>Expo Web .webapp</Text>
              <Text style={styles.title}>Field Kit</Text>
            </View>
          </View>

          <View style={styles.segmented} accessibilityRole="tablist">
            {modes.map((item) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === item.id }}
                key={item.id}
                onPress={() => setMode(item.id)}
                style={[styles.segment, mode === item.id && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, mode === item.id && styles.segmentTextSelected]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.sidebarList}>
            {lanes.map((lane) => (
              <Pressable
                accessibilityRole="button"
                key={lane.id}
                onPress={() => setSelectedLane(lane.id)}
                style={[styles.laneButton, selectedLane === lane.id && styles.laneButtonSelected]}
              >
                <View style={styles.laneButtonTop}>
                  <Text style={styles.laneButtonLabel}>{lane.label}</Text>
                  <StatusPill state={lane.state} />
                </View>
                <Text style={styles.muted}>{lane.crew} - ETA {lane.eta}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView style={styles.workspace} contentContainerStyle={styles.workspaceContent}>
          <View style={[styles.topBar, !split && styles.topBarStacked]}>
            <View style={styles.topCopy}>
              <Text style={styles.eyebrow}>Native component loop</Text>
              <Text style={styles.hero}>Dispatch work without leaving the package.</Text>
              <Text style={styles.body}>
                This uses Expo, React Native Web, Metro, and a loopback dev server inside a `.webapp` bundle.
              </Text>
            </View>

            <View style={styles.toolbar}>
              <Pressable accessibilityRole="button" style={styles.iconButton}>
                <RefreshCw color={colors.ink} size={16} />
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.actionButton} onPress={() => setQuietMode((value) => !value)}>
                <SlidersHorizontal color={quietMode ? colors.teal : colors.ink} size={16} />
                <Text style={styles.actionText}>{quietMode ? "Quiet on" : "Quiet off"}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.metricGrid}>
            {telemetry.map((item) => (
              <View key={item.label} style={styles.metric}>
                <Text style={styles.metricLabel} numberOfLines={1}>{item.label}</Text>
                <Text style={styles.metricValue}>{item.value}</Text>
                <Text style={styles.muted}>{item.detail}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.contentGrid, !split && styles.contentGridStacked]}>
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View style={styles.panelTitle}>
                  <Route color={colors.teal} size={16} />
                  <Text style={styles.panelHeading}>{activeLane.label}</Text>
                </View>
                <StatusPill state={activeLane.state} />
              </View>

              <View style={styles.confidenceBlock}>
                <View style={styles.confidenceTop}>
                  <Text style={styles.muted}>Route confidence</Text>
                  <Text style={styles.numeric}>{activeLane.confidence}%</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.trackFill, { width: `${activeLane.confidence}%` }]} />
                </View>
              </View>

              <View style={styles.workList}>
                {activeLane.work.map((work, index) => (
                  <View key={work} style={styles.workItem}>
                    <CheckCircle2 color={index === 0 ? colors.teal : colors.muted} size={16} />
                    <Text style={styles.workText}>{work}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.mapPanel}>
                <MapPin color={colors.rose} size={20} />
                <View style={styles.mapLine} />
                <Truck color={colors.teal} size={20} />
                <View style={styles.mapLine} />
                <ClipboardList color={colors.amber} size={20} />
              </View>
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View style={styles.panelTitle}>
                  <ClipboardList color={colors.teal} size={16} />
                  <Text style={styles.panelHeading}>Task queue</Text>
                </View>
                <Text style={styles.muted}>{visibleTasks.length} visible</Text>
              </View>

              <View style={styles.taskList}>
                {visibleTasks.map((task) => (
                  <View key={task.id} style={styles.task}>
                    <View style={styles.taskTop}>
                      <Text style={styles.taskId}>{task.id}</Text>
                      <StatusPill state={task.status} />
                    </View>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    <Text style={styles.muted}>{task.lane} - {task.minutes} min</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function StatusPill({ state }) {
  const tone = statusStyles[state] ?? statusStyles.ready;
  return (
    <View style={[styles.pill, tone.container]}>
      <Text style={[styles.pillText, tone.text]}>{state}</Text>
    </View>
  );
}

const colors = {
  bg: "#f5f7f3",
  panel: "#ffffff",
  ink: "#18181b",
  muted: "#686b72",
  line: "rgba(24, 24, 27, 0.1)",
  soft: "#edf5f1",
  teal: "#0f766e",
  green: "#15803d",
  amber: "#b45309",
  rose: "#be123c",
};

const statusStyles = {
  clear: {
    container: { backgroundColor: "rgba(21, 128, 61, 0.12)" },
    text: { color: colors.green },
  },
  ready: {
    container: { backgroundColor: "rgba(21, 128, 61, 0.12)" },
    text: { color: colors.green },
  },
  active: {
    container: { backgroundColor: "rgba(15, 118, 110, 0.12)" },
    text: { color: colors.teal },
  },
  watch: {
    container: { backgroundColor: "rgba(180, 83, 9, 0.13)" },
    text: { color: colors.amber },
  },
  blocked: {
    container: { backgroundColor: "rgba(190, 18, 60, 0.12)" },
    text: { color: colors.rose },
  },
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  root: {
    minHeight: "100vh",
    flexDirection: "row",
    backgroundColor: colors.bg,
  },
  sidebar: {
    width: 300,
    padding: 22,
    gap: 22,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    backgroundColor: "rgba(255, 255, 255, 0.78)",
  },
  brand: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  segmented: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  segmentSelected: {
    backgroundColor: colors.soft,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
  },
  segmentTextSelected: {
    color: colors.ink,
  },
  sidebarList: {
    gap: 10,
  },
  laneButton: {
    gap: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 8,
  },
  laneButtonSelected: {
    borderColor: colors.line,
    backgroundColor: colors.soft,
  },
  laneButtonTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  laneButtonLabel: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  workspace: {
    flex: 1,
  },
  workspaceContent: {
    gap: 20,
    padding: 24,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 18,
  },
  topBarStacked: {
    flexDirection: "column",
  },
  topCopy: {
    flex: 1,
    maxWidth: 880,
    gap: 8,
  },
  hero: {
    color: colors.ink,
    fontSize: 48,
    lineHeight: 50,
    fontWeight: "900",
  },
  body: {
    maxWidth: 680,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 26,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  actionButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  actionText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  metric: {
    minWidth: 150,
    flex: 1,
    paddingVertical: 18,
    paddingRight: 20,
    gap: 3,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  metricValue: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  contentGrid: {
    flexDirection: "row",
    gap: 14,
  },
  contentGridStacked: {
    flexDirection: "column",
  },
  panel: {
    flex: 1,
    gap: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  panelTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  panelHeading: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
  },
  confidenceBlock: {
    gap: 8,
  },
  confidenceTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  numeric: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 8,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "rgba(24, 24, 27, 0.08)",
  },
  trackFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.teal,
  },
  workList: {
    gap: 10,
  },
  workItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  workText: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  mapPanel: {
    minHeight: 118,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.soft,
  },
  mapLine: {
    width: 82,
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(24, 24, 27, 0.18)",
  },
  taskList: {
    gap: 10,
  },
  task: {
    gap: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: "rgba(247, 247, 245, 0.68)",
  },
  taskTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  taskId: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  taskTitle: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  pill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    textTransform: "capitalize",
  },
});
