#!/usr/bin/env bun

import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const documentPath = process.argv[2]

if (!documentPath) {
  console.error("Usage: appify-ui-webapp-smoke <document.webapp>")
  process.exit(64)
}

const indexPath = path.join(documentPath, "index.html")

if (!existsSync(indexPath)) {
  console.error(`Missing fixture HTML: ${indexPath}`)
  process.exit(66)
}

console.log(`${path.basename(documentPath)}: ${pathToFileURL(indexPath).href}`)

const stop = () => {
  process.exit(0)
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

await new Promise(() => {})
