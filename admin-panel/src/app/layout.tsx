import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stealth Admin Panel",
  description: "Internal technician learning and prompt management console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
