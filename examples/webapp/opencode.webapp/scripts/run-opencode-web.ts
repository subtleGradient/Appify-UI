import { randomBytes } from "node:crypto";

const configuredPassword = process.env.OPENCODE_SERVER_PASSWORD;
const hasConfiguredPassword = configuredPassword !== undefined && configuredPassword.length > 0;
const serverPassword = hasConfiguredPassword
  ? configuredPassword
  : randomBytes(24).toString("base64url");
const serverUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode";

if (hasConfiguredPassword) {
  console.error("Using OPENCODE_SERVER_PASSWORD from the environment.");
} else {
  console.error("Generated OPENCODE_SERVER_PASSWORD for this run:");
  console.error(serverPassword);
}

console.error(`OpenCode username: ${serverUsername}`);
console.error("Starting OpenCode with dynamic port selection: opencode web");

const child = Bun.spawn({
  cmd: ["opencode", "web"],
  env: {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: serverPassword,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const forwardSignal = (signal: "SIGINT" | "SIGTERM") => {
  child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await child.exited);
