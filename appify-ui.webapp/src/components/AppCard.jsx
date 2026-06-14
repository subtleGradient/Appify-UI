export default function AppCard({ app }) {
  return (
    <article className={`app-card tone-${app.tone}`} id={app.id}>
      <div className="card-topline">
        <span>{app.kind}</span>
        <code>{app.path}</code>
      </div>
      <h3>{app.name}</h3>
      <p>{app.description}</p>
      <div className="extension-list" aria-label={`${app.name} extensions`}>
        {app.extensions.map((extension) => (
          <code key={extension}>{extension}</code>
        ))}
      </div>
      <ul className="compact-list">
        {app.highlights.map((highlight) => (
          <li key={highlight}>{highlight}</li>
        ))}
      </ul>
    </article>
  );
}
