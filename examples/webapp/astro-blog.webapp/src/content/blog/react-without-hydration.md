---
title: "React JSX does not have to mean client JavaScript"
slug: "react-without-hydration"
description: "Most React components in this example render once and become static HTML."
publishDate: 2026-06-11
tags:
  - react
  - composition
  - static-export
---

The hero, post cards, tag rail, and post header are React JSX components, but
Astro renders them to static HTML. That keeps the composition model familiar
without shipping unnecessary runtime code.

Only the finder hydrates, because search and filtering need client-side state.
