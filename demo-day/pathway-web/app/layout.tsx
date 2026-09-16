import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pathway — an agent for the 180 weeks before the application",
  description:
    "An ongoing college-planning agent for US high school students, built around a two-minute weekly check-in.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
