import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getPosts } from "../lib/blog";
import { href, site as siteMeta } from "../lib/site";

export async function GET(context: APIContext) {
  const posts = await getPosts();
  const site = context.site ?? new URL("https://subtlegradient.github.io");

  return rss({
    title: siteMeta.title,
    description: siteMeta.description,
    site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishDate,
      link: new URL(href(`blog/${post.data.slug}.html`), site).toString(),
    })),
  });
}
