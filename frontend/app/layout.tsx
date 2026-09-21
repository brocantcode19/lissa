import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LISSA — Liceo Information Student Support Assistant",
  description: "AI-powered student inquiry assistant for Liceo de Cagayan University",
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
