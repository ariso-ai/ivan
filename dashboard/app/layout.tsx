import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ari ↔ Ivan | SciSummary Live",
  description: "The Ari and Ivan collaboration loop — live.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
