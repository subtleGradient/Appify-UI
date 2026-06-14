export default function Hero({ githubURL, mapURL }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Mac-shaped local software</p>
        <h1>Small native hosts for tools that already work.</h1>
        <p className="lede">
          Appify UI turns static folders, terminal tools, and document packages into focused Mac apps without dragging a city-sized runtime behind them.
        </p>
        <div className="hero-actions">
          <a className="button primary" href={githubURL}>View source</a>
          <a className="button" href="#shape">Read the shape</a>
        </div>
      </div>
      <figure className="hero-visual">
        <img src={mapURL} alt="Appify UI package flow from source .webapp to static .web and native app hosts." />
      </figure>
    </section>
  );
}
