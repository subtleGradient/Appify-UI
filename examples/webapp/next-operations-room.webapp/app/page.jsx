import { OperationsRoom } from "../components/OperationsRoom";
import { getPulse } from "../lib/pulse";

export default function Page() {
  return <OperationsRoom initialPulse={getPulse()} />;
}
