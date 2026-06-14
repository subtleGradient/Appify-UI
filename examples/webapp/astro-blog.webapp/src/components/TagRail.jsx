export default function TagRail({ tags }) {
  return (
    <div className="tag-rail">
      {tags.map((tag) => (
        <a href={`tags/${tag}.html`} key={tag}>#{tag}</a>
      ))}
    </div>
  );
}
