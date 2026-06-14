import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import {
  APPIFY_TOOLBAR_APP_ID,
  APPIFY_TOOLBAR_EVENTS,
  getAppifyToolbarCommand,
  type AppifyToolbarCommand,
  type AppifyToolbarCommandRequest,
  type AppifyToolbarCommandUpdate,
} from "./protocol";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

const appifyIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm2.5-.75a.75.75 0 0 0-.75.75v2h12.5v-2a.75.75 0 0 0-.75-.75h-11Zm-.75 4.5v9.25c0 .414.336.75.75.75h11a.75.75 0 0 0 .75-.75V9.25H5.75Zm2 2.25h3v2h-3v-2Zm0 3.25h8.5v1.75h-8.5v-1.75Zm4.5-3.25h4v2h-4v-2Z"/></svg>`;

type RunningCommand = {
  command: AppifyToolbarCommand;
  requestId: string;
};

function isCommandRequest(value: unknown): value is AppifyToolbarCommandRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AppifyToolbarCommandRequest>;
  return (
    typeof request.requestId === "string" &&
    typeof request.command === "string" &&
    getAppifyToolbarCommand(request.command as AppifyToolbarCommand) !== undefined
  );
}

function commandArgs(command: AppifyToolbarCommand): string[] {
  switch (command) {
    case "build":
      return ["run", "build"];
    case "deploy-pages":
      return ["run", "deploy:pages"];
    case "deploy-pages-dry-run":
      return ["run", "deploy:pages", "--", "--dry-run"];
  }
}

function appifyCommandToolbar(): AstroIntegration {
  let runningCommand: RunningCommand | undefined;

  return {
    name: "appify-ui-command-toolbar",
    hooks: {
      "astro:config:setup": ({ addDevToolbarApp }) => {
        addDevToolbarApp({
          id: APPIFY_TOOLBAR_APP_ID,
          name: "Appify",
          icon: appifyIcon,
          entrypoint: new URL("./app.ts", import.meta.url),
        });
      },
      "astro:server:setup": ({ toolbar, logger }) => {
        const sendUpdate = (update: AppifyToolbarCommandUpdate) => {
          toolbar.send(APPIFY_TOOLBAR_EVENTS.update, update);
        };

        toolbar.on(APPIFY_TOOLBAR_EVENTS.run, (value: unknown) => {
          if (!isCommandRequest(value)) {
            return;
          }

          const definition = getAppifyToolbarCommand(value.command);
          if (!definition) {
            return;
          }

          if (runningCommand) {
            sendUpdate({
              command: value.command,
              requestId: value.requestId,
              status: "rejected",
              message: `${getAppifyToolbarCommand(runningCommand.command)?.label ?? "Another command"} is already running.`,
            });
            return;
          }

          const startedAt = new Date().toISOString();
          runningCommand = {
            command: value.command,
            requestId: value.requestId,
          };

          logger.info(`Running ${definition.commandText}`);
          sendUpdate({
            command: value.command,
            requestId: value.requestId,
            status: "started",
            message: `Running ${definition.commandText}`,
            startedAt,
          });

          const child = spawn("bun", commandArgs(value.command), {
            cwd: projectRoot,
            env: {
              ...process.env,
              ASTRO_TELEMETRY_DISABLED: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
          });

          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");

          child.stdout.on("data", (output: string) => {
            sendUpdate({
              command: value.command,
              requestId: value.requestId,
              status: "output",
              output,
            });
          });

          child.stderr.on("data", (output: string) => {
            sendUpdate({
              command: value.command,
              requestId: value.requestId,
              status: "output",
              output,
            });
          });

          child.on("error", (error) => {
            runningCommand = undefined;
            logger.error(`Failed to start ${definition.commandText}: ${error.message}`);
            sendUpdate({
              command: value.command,
              requestId: value.requestId,
              status: "failed",
              message: error.message,
              finishedAt: new Date().toISOString(),
            });
          });

          child.on("close", (exitCode) => {
            runningCommand = undefined;
            const status = exitCode === 0 ? "completed" : "failed";
            const message =
              exitCode === 0
                ? `${definition.label} completed.`
                : `${definition.label} failed with exit code ${exitCode ?? "unknown"}.`;

            if (exitCode === 0) {
              logger.info(message);
            } else {
              logger.error(message);
            }

            sendUpdate({
              command: value.command,
              requestId: value.requestId,
              status,
              message,
              exitCode,
              finishedAt: new Date().toISOString(),
            });
          });
        });
      },
    },
  };
}

export default appifyCommandToolbar;
