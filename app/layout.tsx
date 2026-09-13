import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Popmart Sentry — Hirono Watch (PH)",
  description:
    "Live availability dashboard for Pop Mart Philippines Hirono products, prioritising the After Dark series.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
