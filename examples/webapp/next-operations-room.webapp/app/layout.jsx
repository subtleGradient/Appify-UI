import "./globals.css";

export const metadata = {
  title: "Operations Room",
  description: "A Next.js .webapp operations dashboard example.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
