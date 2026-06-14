export default function PostHeader({ post }) {
  return (
    <header className="post-header">
      <p className="eyebrow">{post.data.tags.join(" / ")}</p>
      <h1>{post.data.title}</h1>
      <p>{post.data.description}</p>
      <time dateTime={post.data.publishDate.toISOString()}>
        {post.data.publishDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
      </time>
    </header>
  );
}
