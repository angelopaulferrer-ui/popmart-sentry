import type { Metadata } from "next";
import "./globals.css";
import ScrollToTop from "@/components/ScrollToTop";

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
      {/* suppressHydrationWarning: browser extensions (ColorZilla, Grammarly, etc.)
          inject attributes like cz-shortcut-listen onto <body> before React hydrates,
          which is harmless but trips the hydration mismatch warning. */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
        <ScrollToTop />
      </body>
    </html>
  );
}
