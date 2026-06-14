import PostCard from "./PostCard.jsx";

export default function PostGrid({ posts }) {
  return (
    <div className="post-grid">
      {posts.map((post) => (
        <PostCard post={post} key={post.data.slug} />
      ))}
    </div>
  );
}
