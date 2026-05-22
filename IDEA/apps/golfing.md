# App Build Golf

This is the scoring model for deciding which AppifyHost apps to build next.

The point is not to rank "cool tools". The point is to find file-format and
workflow gaps where a small native macOS wrapper removes a lot of friction
without becoming a bloated platform, an Electron clone, or a new maintenance
burden.

Higher scores are worse. Lower scores are better. A candidate wins when it
solves a painful document gap, has a simple local file or bundle shape, and can
be built with mostly already-proven AppifyHost machinery.

## Core Taste

Good AppifyHost apps should feel like this:

- Double-click a thing in Finder and it opens immediately.
- The thing is a real file, folder, or macOS package, not opaque cloud state.
- Spotlight, Quick Look, git, rsync, Time Machine, `rg`, and normal filesystem
  tools can understand as much as possible.
- The app is laser-focused on the document format, not an IDE, second brain,
  browser profile, SaaS shell, or lifestyle system.
- A bundle is just a folder that the OS politely pretends is one node when that
  makes UX better.
- Prefer open packages over zips when the point is local work. Zips are good for
  transport; folders are better for living documents.

Bad AppifyHost apps drift toward this:

- A huge framework or Electron shell around a tiny file-format need.
- Closed-source runtime dependence where the format itself deserves a simple
  independent tool.
- Hidden state trapped in IndexedDB, app support folders, or cloud accounts.
- A "document app" that cannot be searched, diffed, backed up, scripted, or
  inspected by ordinary tools.
- A wrapper that opens the door to credentials, pager duty, destructive remote
  actions, or permanent support obligations before the local file problem is
  solved.

## Inputs For Each Candidate

Every candidate should get one row with:

| Field | Meaning |
| --- | --- |
| App idea | Working name, e.g. `JSONCanvas.app`, `MarkdownPeek.app`, `HTMLBundle.app`. |
| Target object | The Finder thing: file extension, package extension, folder marker, or profile bundle. |
| Existing enemy | The thing users tolerate today: Obsidian, Finder preview, browser `file://`, VS Code, Electron app, SaaS. |
| Desired 80% | The good part to preserve. |
| Rejected 20% | The bloat, baggage, trust surface, or worldview tax to avoid. |
| AppifyHost mode | `fileDocument`, `folderMarker`, `contentPackage`, or a new mode if truly needed. |
| First proof | The smallest build that proves the app should exist. |

## Axis Set

Score each axis from `0` to `5`. Use exact integers. No halves. Choose the
lowest score you can defend from the actual app shape.

### 1. Format Need

How badly does the world need a focused native app for this object?

| Score | Meaning |
| --- | --- |
| 0 | The format is already well served by fast, native, focused tools. |
| 1 | Existing tools are fine; a wrapper is mostly taste. |
| 2 | Existing tools work, but they are clumsy or too broad. |
| 3 | Users rely on bloated, gross, or conceptually wrong tools for a good format. |
| 4 | A very good open/local format is effectively trapped inside a bad host app or workflow. |
| 5 | The format is strategically important and has no acceptable focused local app. |

This axis is inverted when calculating priority: higher need is good. In the
final score use `NeedDrag = 5 - FormatNeed`.

### 2. Story Friction

Borrowed from Story Golf: how hard is it to explain why this app should exist?

| Score | Meaning |
| --- | --- |
| 0 | The story tells itself: "double-click `.x` without opening huge app Y." |
| 1 | One concrete comparison is enough. |
| 2 | Needs a short demo or file-format explanation. |
| 3 | Needs several concepts before the pain is visible. |
| 4 | Requires teaching a new workflow or ideology. |
| 5 | Requires users to adopt the builder's worldview before caring. |

### 3. Bundle Fit

How naturally does the target object map to macOS file/package semantics?

| Score | Meaning |
| --- | --- |
| 0 | One existing file path or obvious package path is the whole document. |
| 1 | Package shape is obvious and mostly mirrors an existing folder structure. |
| 2 | Needs a small manifest but no surprising storage model. |
| 3 | Needs import/export or asset rules that users must learn. |
| 4 | Needs a new database, sync layer, or opaque internal layout. |
| 5 | Durable state cannot live cleanly in the opened file/package. |

### 4. Build Work

Borrowed from Work Golf: how much engineering burden after the decision to build?

| Score | Meaning |
| --- | --- |
| 0 | Already proven by an existing AppifyHost app or tiny script change. |
| 1 | Small AppServer, UTI, and package polish only. |
| 2 | New Bun runner or light web/TUI integration. |
| 3 | Meaningful editor state, import/export, or Quick Look work. |
| 4 | New rendering engine, sync model, or complex native integration. |
| 5 | New world: large runtime, new domain, hard correctness, or special hardware. |

### 5. Technical Liability

Borrowed from Thing Golf: does this app add explosiveness, burden, chaos,
betrayal risk, or control-freak coupling?

| Score | Meaning |
| --- | --- |
| 0 | Viewer-first, local-only, simple dependency story, no hidden state. |
| 1 | Small dependency or package convention, still easy to reason about. |
| 2 | Moderate runtime or state surface, but failures are contained. |
| 3 | Complex editor semantics, large dependencies, or migration burden. |
| 4 | Credentials, destructive operations, hidden persistence, or fragile runtime behavior. |
| 5 | Security-sensitive, remote-mutating, legally tricky, or likely to betray user trust. |

### 6. Ecosystem Leverage

How much does building this unlock normal tools and adjacent workflows?

| Score | Meaning |
| --- | --- |
| 0 | Unlocks Spotlight, Quick Look, git, search, backup, scripting, and many follow-on apps. |
| 1 | Unlocks several normal filesystem workflows. |
| 2 | Helps one ecosystem meaningfully. |
| 3 | Mostly helps inside the app itself. |
| 4 | Little external leverage. |
| 5 | Makes another silo or app-specific island. |

## Final Score

```text
AppBuildBadness =
  NeedDrag
  + StoryFriction
  + BundleFit
  + BuildWork
  + TechnicalLiability
  + EcosystemLeverage
```

Bands:

| Score | Verdict |
| --- | --- |
| 0-5 | Build next. The field is begging for it. |
| 6-10 | Strong candidate. Prototype if it fits the current build rhythm. |
| 11-15 | Interesting, but mutate before building. |
| 16+ | Defer. The idea is probably carrying too much worldview, runtime, or support mass. |

## Candidate Sketches

These are provisional scores. Re-score when the actual implementation path is
chosen.

| App idea | Target object | Need | Story | Bundle | Work | Liability | Leverage | Total | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `JSONCanvas.app` | `.canvas`, `.canvasbundle` | 5 | 0 | 1 | 3 | 2 | 0 | 6 | Strong candidate |
| `MarkdownPeek.app` | `.md`, Obsidian-compatible folder links | 4 | 1 | 0 | 2 | 1 | 0 | 5 | Build next |
| `HTMLBundle.app` | `.htmlbundle` or `.web` package | 5 | 1 | 1 | 2 | 1 | 0 | 5 | Build next |
| `LogScope.app` | `.log`, `.logbundle` | 4 | 0 | 1 | 1 | 1 | 1 | 5 | Build next |
| `PacketPeek.app` | `.pcap`, `.pcapng` | 3 | 0 | 0 | 1 | 2 | 2 | 7 | Strong candidate |
| `APIWorkbench.app` | `.apiworkbench`, OpenAPI/request bundle | 4 | 1 | 2 | 2 | 4 | 1 | 11 | Mutate first |
| `MapBundle.app` | `.mapbundle`, GeoJSON/PMTiles package | 4 | 2 | 2 | 3 | 2 | 1 | 11 | Mutate first |
| `MarimoDoc.app` | `.py`, `.notebookbundle` | 3 | 2 | 1 | 3 | 3 | 1 | 12 | Mutate first |

## Immediate Read

### JSONCanvas.app

Obsidian proved that `.canvas` is good. Obsidian also proves why the format
needs a separate app. The good part is the open JSON Canvas file: nodes, edges,
text, files, links, and a human-inspectable graph. The bad part is the host:
Electron, closed source, huge plugin ecosystem, second-brain gravity, and a
lot of complexity around what should be a focused canvas document.

The target should be 80% of the Obsidian JSON Canvas editing experience:

- open `.canvas` instantly
- edit nodes and edges
- embed local files and Markdown cards
- keep the file format boring and spec-compatible
- optionally use a `.canvasbundle` when assets need to travel with the graph

The rejected 20%:

- no vault ideology
- no plugin platform first
- no account/sync story first
- no massive app shell
- no hidden state as the source of truth

First proof: open a `.canvas`, render nodes/edges, drag nodes, edit text, save
valid JSON Canvas back to disk.

### MarkdownPeek.app

Markdown has the right shape: plain text, searchable, diffable, durable, and
already loved by Obsidian users. The missing app is not another IDE and not a
second brain. It is the file-native macOS behavior people expect from Preview:
double-click, open fast, render well, follow local links, search, Quick Look,
and get out of the way.

The target should be Obsidian-compatible enough without becoming Obsidian:

- render Markdown and common Obsidian/wiki links
- follow relative file links inside a folder
- support Spotlight and Quick Look through normal file contents
- optionally expose a minimal edit mode
- keep `.md` as the source of truth

Possible substrate: a tiny Bun server around a focused Markdown renderer/editor
such as CodeMirror/Milkdown/Markdown-it, with AppifyHost supplying the native
document shell.

First proof: open one `.md` file, render it instantly, follow local relative
links in the same folder, and preserve source text exactly after a no-op save.

### HTMLBundle.app

Static HTML is the best portable document format we already have. The problem
is that real HTML documents are rarely one file. They are folders with CSS,
images, scripts, subpages, data, and relative links. Loading with `file:///`
breaks enough web platform assumptions that people stop treating HTML as a
serious personal document format.

The bundle model is the right mental move:

```text
research.web/
  index.html
  pages/
  assets/
  data/
  manifest.json
```

macOS already knows this trick. A bundle is a folder that sometimes presents
as one node. Shadow DOM is the same aesthetic move on the web: an encapsulated
subtree with a public surface. `HTMLBundle.app` should let a nested website act
like a PDF-like document without turning it into an opaque zip or niche ebook
standard.

The target should support:

- double-click a `.web` or `.htmlbundle` package
- serve it from `127.0.0.1` with correct relative URLs, MIME types, and fetch
- default to `index.html`
- support folder navigation within the package
- avoid the user's default browser profile and extension noise
- keep every inner file visible to git, search, rsync, and normal tools

First proof: package a nested research folder, open it in AppifyHost, navigate
relative links, load CSS/images/scripts/data through localhost, and never rely
on `file:///`.

## Reusable Mutations

When a candidate scores too high, mutate it before rejecting it:

- Convert opaque state into visible package files.
- Split "editor" from "viewer" and build the viewer first.
- Remove credentials and remote mutation from v1.
- Keep import/export, but make the package the working format.
- Prefer one good file association over a universal workspace.
- Replace "platform" with "document shell".
- Treat Quick Look and Spotlight as core product features, not extras.

## Scorecard Template

```markdown
## Candidate

- App idea:
- Target object:
- Existing enemy:
- Desired 80%:
- Rejected 20%:
- AppifyHost mode:
- First proof:

| Axis | Score | Why |
| --- | ---: | --- |
| Format Need |  |  |
| Story Friction |  |  |
| Bundle Fit |  |  |
| Build Work |  |  |
| Technical Liability |  |  |
| Ecosystem Leverage |  |  |

NeedDrag = 5 - FormatNeed
Total =
Verdict =
Mutation =
```
