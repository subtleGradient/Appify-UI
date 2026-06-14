export default function PrincipleList({ principles }) {
  return (
    <section className="section-band" id="shape">
      <div className="section-heading">
        <p className="eyebrow">Repository posture</p>
        <h2>The system stays object-first.</h2>
      </div>
      <div className="principle-grid">
        {principles.map((principle, index) => (
          <article className="principle" key={principle}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{principle}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
