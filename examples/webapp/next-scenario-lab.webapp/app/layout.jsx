import "./globals.css";

export const metadata = {
  title: "Scenario Lab",
  description: "A Next.js .webapp golf-scoring lab example.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
