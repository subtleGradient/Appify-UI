import { useMemo, useState } from "react";

export default function PostFinderIsland({ posts }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");

  const tags = useMemo(() => [...new Set(posts.flatMap((post) => post.tags))].sort(), [posts]);
  const filteredPosts = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return posts.filter((post) => {
      const matchesTag = tag === "all" || post.tags.includes(tag);
      const matchesQuery = needle.length === 0 || `${post.title} ${post.description} ${post.tags.join(" ")}`.toLowerCase().includes(needle);
      return matchesTag && matchesQuery;
    });
  }, [posts, query, tag]);

  return (
    <section className="finder" aria-label="Interactive post finder">
      <div className="finder-controls">
        <label>
          <span>Search</span>
          <input value={query} placeholder="Find a post" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          <span>Tag</span>
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="all">All tags</option>
            {tags.map((tagName) => (
              <option value={tagName} key={tagName}>{tagName}</option>
            ))}
          </select>
        </label>
        <output>{filteredPosts.length} of {posts.length}</output>
      </div>
      <div className="finder-results">
        {filteredPosts.map((post) => (
          <a href={`blog/${post.slug}.html`} key={post.slug}>
            <strong>{post.title}</strong>
            <span>{post.tags.join(" / ")}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
