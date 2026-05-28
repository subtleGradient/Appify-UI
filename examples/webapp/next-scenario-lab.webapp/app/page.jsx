import { ScenarioLab } from "../components/ScenarioLab";
import { getScenarioSet } from "../lib/scenarios";

export default function Page() {
  return <ScenarioLab initialSet={getScenarioSet()} />;
}
