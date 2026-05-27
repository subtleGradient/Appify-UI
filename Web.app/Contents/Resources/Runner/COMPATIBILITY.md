# Web Compatibility Protocol

Web.app is a static, client-side web document host. It may add small server-side
compatibility affordances only when a checked-in `.web` example proves the need.
Do not add fake REST, CGI, SSI, storage, routing, or browser-behavior shims from
taste alone.

## Rule

No Web.app compatibility feature without a concrete red-case `.web` bundle.

The bundle must be specific enough that a reviewer can open it, see what old web
expectation failed, and understand why the new behavior is the smallest safe
thing that makes that case work.

## RGRTDD Loop

1. **Red case:** add one `.web` bundle under `examples/web-compat/` with a short
   provenance note. The bundle should fail in the current runner for exactly one
   visible reason.
2. **Green case:** add the least server-side behavior needed for that bundle to
   work. Prefer static URL mapping, explicit `.html` shadows, browser-native
   request data, and generated loud errors over hidden state or execution.
3. **Refactor case:** after the example passes, review all custom behavior in
   the runner. Generalize only if the generalization removes duplication without
   expanding authority, filesystem reach, or conceptual surface area.
4. **Regression case:** keep the example bundle and tests. Future changes must
   preserve both the old-web expectation and the safety boundary.

## Intake Requirements

Each compatibility fixture should include:

- `PROVENANCE.md` with source URL, original era, license/permission notes, and
  what was changed to make the bundle safe to commit.
- The smallest static dump that reproduces the behavior. Remove unrelated pages,
  private data, tracking code, credentials, and generated noise.
- One clear expected workflow, such as submitting a form, following a CGI-looking
  link, loading an SSI include, or making an old AJAX request.
- A short list of unsupported behavior that must fail loud.

Do not import source whose license is unclear. Recreate a tiny equivalent red
case when the historical artifact is useful as a behavioral reference but not
safe to commit.

## Safety Invariants

- Never execute bundle-provided server code.
- Never treat real on-disk server extensions as HTML. Use explicit shadow files
  such as `contact.cgi.html` for URL compatibility.
- Never let a request URL choose a write path.
- Never write outside Web.app-owned local storage.
- Never silently ignore unsupported legacy directives or malformed host data.
- Prefer visible `4xx`/`5xx` pages and console errors over inert behavior.
- Keep browser-native APIs native unless the Web.app enhancement has to be
  single-source and document-backed.

## Candidate Queue

Start with concrete, historically meaningful cases, not invented APIs:

- A static reconstruction of the Rails-era weblog demo workflow, using the
  smallest safe HTML/JS dump that exercises forms, redirects, and old AJAX
  assumptions. Do not claim first-release provenance unless the exact source is
  found.
- One common old `cgi-bin` form-handler pattern from archived sites, reduced to
  a safe fixture that proves the exact URL and POST expectations.
- One SSI-heavy static site fragment that uses includes for headers, nav, and
  footers. `#exec` and command-like SSI must be loud failures, not no-ops.

