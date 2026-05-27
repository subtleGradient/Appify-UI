# 1999 Guestbook Web Compatibility Fixture

This is an original nostalgic fixture, not an archived historical site.

It is intentionally cartoonish 1999-era HTML: table layout, bright link colors,
classic form controls, loud colors, and a guestbook flow that resembles old CGI
without running any server-side bundle code.

## Feature Exercised

- `index.html` contains a guestbook form that posts to `./cgi-bin/sign.cgi`.
- `cgi-bin/sign.cgi.html` is the explicit static shadow page for that route.
- In Web.app, the shadow page reads `window.AppifyHost.request` to display the
  submitted fields.
- In a normal browser, the shadow page remains a static page and explains that
  no posted request data is available.

## Safety Rule

Unsupported server execution must fail safe and loud.

The bundle deliberately does not include an on-disk `sign.cgi` script. Web.app
must respect and fear on-disk file extensions: a fossil server route may be
served only when an explicit `.html` shadow file exists. Real `.cgi`, `.pl`,
`.php`, `.asp`, `.aspx`, `.jsp`, or similar server files must not execute, and
must not be silently treated as HTML.

## Network and Build Policy

This fixture is self-contained. It has no external assets, no network
dependencies, and no build tools.
