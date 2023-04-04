const __filename = decodeURIComponent(new URL(import.meta.url).pathname)
const __dirname = __filename.slice(0, __filename.lastIndexOf("/"))

const WEBVIEW_BIN = `${__dirname}/../../../MacOS/appify-ui-webview`;

export function open(url: URL | string) {
  if (url.toString().startsWith("/")) url = `file://${url}`;
  if (typeof url === "string") url = new URL(url);

  const child = Deno.run({
    cmd: [WEBVIEW_BIN, "-url", url.href],
    stdout: "inherit",
    stderr: "inherit",
  });

  // wait for process to exit
  child.status().then(status => console.log({ status }));

  return child;
}

if (import.meta.main) open(`${__dirname}/webview.html`)
