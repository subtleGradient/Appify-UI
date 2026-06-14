# Astro Blog Webapp

An Astro blog source package.

Run the source app during development:

```sh
bun install
bun dev
```

Build a static sibling package for `Web.app`:

```sh
bun run build
```

The build writes `../astro-blog.web`, a non-empty `.web` folder that can be
opened directly with `Web.app`. The post-build step rewrites generated asset and
page links to be file-relative, so `../astro-blog.web/index.html` can also be
opened directly from Finder.

Most React JSX components in this example render as static HTML. The post finder
on the homepage is the hydrated React island.
