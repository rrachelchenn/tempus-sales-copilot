import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tempus Sales Copilot",
  description: "GenAI-powered lead prioritization and pitch generator for Tempus reps.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-50">
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}

