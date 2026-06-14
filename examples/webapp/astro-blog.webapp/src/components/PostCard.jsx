export default function PostCard({ post }) {
  return (
    <article className="post-card">
      <div className="post-meta">
        <time dateTime={post.data.publishDate.toISOString()}>{post.data.publishDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>
        <span>{post.data.tags.join(" / ")}</span>
      </div>
      <h3><a href={`blog/${post.data.slug}.html`}>{post.data.title}</a></h3>
      <p>{post.data.description}</p>
    </article>
  );
}
