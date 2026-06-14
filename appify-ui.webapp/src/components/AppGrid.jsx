import AppCard from "./AppCard.jsx";

export default function AppGrid({ apps }) {
  return (
    <div className="app-grid">
      {apps.map((app) => (
        <AppCard app={app} key={app.id} />
      ))}
    </div>
  );
}
