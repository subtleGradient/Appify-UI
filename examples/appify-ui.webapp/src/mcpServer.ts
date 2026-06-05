import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  ROOT_SCRIPT_IDS,
  type RootScriptId,
  type RunScriptInput,
  getRootApps,
  listRootScripts,
} from "./scriptCatalog";
import { type ScriptRunner } from "./scriptRunner";

export type AppifyMcpContext = {
  runner: ScriptRunner;
  repoRoot: string;
};

const runScriptInputSchema = {
  scriptId: z.enum(ROOT_SCRIPT_IDS),
  sourceApp: z.string().optional(),
  outputPath: z.string().optional(),
  signMode: z.enum(["ad-hoc", "no-sign", "identity"]).optional(),
  signIdentity: z.string().optional(),
  documentPath: z.string().optional(),
};

const runIdInputSchema = {
  runId: z.string().min(1),
};

export function createAppifyMcpServer(context: AppifyMcpContext): McpServer {
  const server = new McpServer({
    name: "appify-ui",
    version: "0.1.0",
  }, {
    capabilities: {
      logging: {},
      resources: {},
      tools: {},
    },
  });

  server.registerTool(
    "appify.list_scripts",
    {
      title: "List Appify UI Scripts",
      description: "List root ./Scripts exposed by appify-ui.webapp.",
    },
    async () => {
      const result = scriptCatalogPayload(context);
      return jsonToolResult(result);
    },
  );

  server.registerTool(
    "appify.run_script",
    {
      title: "Run Appify UI Script",
      description: "Run an allowlisted root ./Scripts command with validated inputs.",
      inputSchema: runScriptInputSchema,
    },
    async (input, extra) => {
      const run = context.runner.runScript(input as RunScriptInput);
      await extra.sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          logger: "appify-ui",
          data: {
            event: "run_started",
            runId: run.id,
            scriptId: run.scriptId,
          },
        },
      });
      return jsonToolResult(context.runner.serializeRun(run));
    },
  );

  server.registerTool(
    "appify.stop_run",
    {
      title: "Stop Appify UI Run",
      description: "Terminate a running Appify UI script process.",
      inputSchema: runIdInputSchema,
    },
    async ({ runId }) => jsonToolResult(context.runner.serializeRun(context.runner.stopRun(runId))),
  );

  server.registerTool(
    "appify.get_run",
    {
      title: "Get Appify UI Run",
      description: "Read status and capped logs for one script run.",
      inputSchema: runIdInputSchema,
    },
    async ({ runId }) => jsonToolResult(context.runner.serializeRun(context.runner.getRun(runId))),
  );

  server.registerTool(
    "appify.list_runs",
    {
      title: "List Appify UI Runs",
      description: "List recent in-memory script runs.",
    },
    async () => jsonToolResult({ runs: context.runner.serializeRuns() }),
  );

  server.registerResource(
    "appify-scripts",
    "appify://scripts",
    {
      title: "Appify UI Script Catalog",
      description: "Root ./Scripts exposed by appify-ui.webapp.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, scriptCatalogPayload(context)),
  );

  server.registerResource(
    "appify-runs",
    "appify://runs",
    {
      title: "Appify UI Runs",
      description: "Recent in-memory script runs.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, { runs: context.runner.serializeRuns() }),
  );

  server.registerResource(
    "appify-run-log",
    new ResourceTemplate("appify://runs/{id}/log", {
      list: async () => ({
        resources: context.runner.listRuns().map((run) => ({
          uri: `appify://runs/${run.id}/log`,
          name: `${run.scriptId} log`,
          title: `${run.scriptId} log`,
          mimeType: "text/plain",
        })),
      }),
    }),
    {
      title: "Appify UI Run Log",
      description: "Captured stdout/stderr for a script run.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const run = context.runner.getRun(id);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: run.log,
        }],
      };
    },
  );

  return server;
}

export async function createMcpHttpHandler(context: AppifyMcpContext): Promise<(request: Request) => Promise<Response>> {
  return async (request: Request) => {
    const originProblem = validateLocalOrigin(request);
    if (originProblem) {
      return originProblem;
    }

    const server = createAppifyMcpServer(context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return await transport.handleRequest(request);
  };
}

function scriptCatalogPayload(context: AppifyMcpContext) {
  return {
    repoRoot: context.repoRoot,
    apps: getRootApps(context.repoRoot),
    scripts: listRootScripts(context.repoRoot),
  };
}

function jsonToolResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(value, null, 2),
    }],
    structuredContent: value,
  };
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function validateLocalOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  try {
    const url = new URL(origin);
    if (isLoopbackHost(url.hostname)) {
      return null;
    }
  } catch {
    return new Response("Invalid Origin", { status: 403 });
  }

  return new Response("Forbidden Origin", { status: 403 });
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
