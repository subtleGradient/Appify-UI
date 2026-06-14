export default function ExampleList({ examples }) {
  return (
    <div className="example-list">
      {examples.map((example) => (
        <article className="example-row" key={example.path}>
          <div>
            <h3>{example.name}</h3>
            <p>{example.description}</p>
          </div>
          <div className="example-meta">
            <span>{example.stack}</span>
            <code>{example.path}</code>
          </div>
        </article>
      ))}
    </div>
  );
}
