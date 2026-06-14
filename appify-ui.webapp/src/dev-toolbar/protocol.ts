export const APPIFY_TOOLBAR_APP_ID = "appify-ui-commands";

export const APPIFY_TOOLBAR_EVENTS = {
  run: "appify-ui:commands:run",
  update: "appify-ui:commands:update",
} as const;

export type AppifyToolbarCommand = "build" | "deploy-pages" | "deploy-pages-dry-run";

export type AppifyToolbarCommandStatus =
  | "started"
  | "output"
  | "completed"
  | "failed"
  | "rejected";

export type AppifyToolbarCommandRequest = {
  command: AppifyToolbarCommand;
  requestId: string;
};

export type AppifyToolbarCommandUpdate = {
  command: AppifyToolbarCommand;
  requestId: string;
  status: AppifyToolbarCommandStatus;
  message?: string;
  output?: string;
  exitCode?: number | null;
  startedAt?: string;
  finishedAt?: string;
};

export type AppifyToolbarCommandDefinition = {
  command: AppifyToolbarCommand;
  label: string;
  description: string;
  commandText: string;
  confirm?: string;
};

export const appifyToolbarCommands: AppifyToolbarCommandDefinition[] = [
  {
    command: "build",
    label: "Build",
    description: "Generate appify-ui.web/ for GitHub Pages.",
    commandText: "bun run build",
  },
  {
    command: "deploy-pages-dry-run",
    label: "Deploy dry run",
    description: "Build and prepare the gh-pages publish tree without pushing.",
    commandText: "bun run deploy:pages -- --dry-run",
  },
  {
    command: "deploy-pages",
    label: "Deploy pages",
    description: "Build and push appify-ui.web/ to origin gh-pages.",
    commandText: "bun run deploy:pages",
    confirm: "Build and push appify-ui.web/ to origin gh-pages?",
  },
];

export function getAppifyToolbarCommand(
  command: AppifyToolbarCommand,
): AppifyToolbarCommandDefinition | undefined {
  return appifyToolbarCommands.find((item) => item.command === command);
}
