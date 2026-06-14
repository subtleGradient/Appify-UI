export default function HeroPanel({ postCount, tagCount }) {
  return (
    <section className="hero-panel">
      <div>
        <p className="eyebrow">Astro static output</p>
        <h1>Static React JSX composition with one hydrated island.</h1>
        <p>
          The cards, tag rail, and hero render to plain HTML. The finder below
          becomes client-side React only where interactivity is useful.
        </p>
      </div>
      <dl className="hero-stats">
        <div><dt>Posts</dt><dd>{postCount}</dd></div>
        <div><dt>Tags</dt><dd>{tagCount}</dd></div>
        <div><dt>Output</dt><dd>.web</dd></div>
      </dl>
    </section>
  );
}
