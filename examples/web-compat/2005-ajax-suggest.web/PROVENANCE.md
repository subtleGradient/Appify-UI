# 2005 AJAX Suggest

This is an original nostalgic fixture, not an archive of a historic site.

The bundle is cartoonishly early-AJAX-era: one static HTML page, one stylesheet,
one script using `XMLHttpRequest`, and one local JSON file at
`./api/suggest.json`.

## Feature Exercised

- Same-origin `XMLHttpRequest` loading a static JSON asset.
- Typeahead/search suggestions rendered on the client.
- Graceful fallback content when JavaScript is disabled or XHR cannot load the
  JSON file.
- No external assets, no network dependencies, and no build tools.

## Compatibility Boundary

This fixture is a baseline for behavior that should already work in Web.app.
It does not justify fake REST mutation, generated API routes, server execution,
background persistence, or special Web.app-only client APIs.

Do not add compatibility functionality because of this fixture unless it first
fails as a concrete red case. Future AJAX examples that need mutation or richer
server behavior should be added as separate `.web` bundles with their own
provenance and safety boundary.
