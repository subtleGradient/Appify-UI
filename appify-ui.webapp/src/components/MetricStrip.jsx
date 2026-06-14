export default function MetricStrip({ items }) {
  return (
    <section className="metric-strip" aria-label="Project shape">
      {items.map((item) => (
        <div className="metric" key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </section>
  );
}
