# Web Composition Fixture

This fixture proves the first Web Interface Injection shape without requiring
new Web.app runner behavior.

- `consumer.web/` is the app. It imports `@web/ui-controls/define.js`.
- `interfaces.web/` declares the UI controls interface and descriptor schemas.
- `base-controls.web/` and `shadcn-controls.web/` both implement the same
  interface with different styling.

Open `consumer.web/base.html` and `consumer.web/shadcn.html`. The app module and
markup stay the same; only the import map and provider stylesheet change.

