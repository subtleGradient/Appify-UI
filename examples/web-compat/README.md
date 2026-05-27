# Web Compatibility Examples

This directory is for `.web` bundles that justify Web.app compatibility
behavior.

Each example must be a red case first: it captures one real old-web expectation
that does not currently work, then stays in the repo as a regression fixture
after the runner learns the smallest safe behavior needed for it.

Required shape:

- `<case-name>.web/` contains the runnable static bundle.
- `<case-name>.web/PROVENANCE.md` explains the source, era, license status,
  edits made for safety, and the exact behavior under test.
- The bundle is small enough to audit.
- Unsupported behavior fails loud.

Do not add invented compatibility examples. If no concrete old site, demo app,
or historically common code pattern needs the feature, Web.app does not need the
feature yet.

