# 2005 Rails Weblog Fixture

## Intent

This bundle is original nostalgia inspired by early Ruby on Rails scaffold and
weblog conventions. It is not an archive of the first Rails demo, Basecamp, or
any historical application.

The fixture exists to keep Web.app compatibility work concrete: basic resource
pages and form POST flows should feel like a tiny static dump of an early
Rails-era weblog, while still respecting the rule that no Ruby, CGI, PHP, Perl,
ASP, JSP, or other bundle-provided server code is ever executed.

## Era Idioms

- Scaffold-ish pages: listing tables, Show/Edit/Destroy action links, simple
  labels, textarea fields, and flash notices.
- Resource-shaped navigation: `posts/`, `posts/1/`, and `posts/1/comments/`.
- Form field names shaped like `post[title]`, `post[body]`,
  `comment[author]`, and `comment[body]`.
- POST action URLs are observed by `service-worker.js` as native `Request`
  objects and redirected to safe static shadow pages.

## Workflows

1. Open `index.html`.
2. Follow `posts/` to the scaffold listing.
3. Follow `posts/new.html`, fill out the weblog form, and submit it.
4. The service worker receives `POST posts/create.cgi`, reads
   `request.clone().formData()`, and returns a 303 redirect to
   `posts/create.cgi.html?...`.
5. Follow `posts/1/`, add a comment, and submit it.
6. The service worker repeats the POST-to-303 flow for
   `posts/1/comments/create.cgi`.

Opening a shadow page directly is also intentional: the page fails loud in the
fixture UI because there are no posted form fields in `location.search`.

## Safety Boundary

- No server code is present or executed.
- No external assets, fonts, scripts, images, or network requests are used.
- No build tool is required.
- The `.cgi.html` files are static HTML shadow files. The corresponding `.cgi`
  URLs are compatibility routes only; there are no on-disk `.cgi` scripts.
- Posted values are displayed by client-side JavaScript from
  `URLSearchParams(location.search)` using text nodes, not by injecting
  untrusted HTML.
