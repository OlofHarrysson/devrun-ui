import "../src/styles/main.css";
import "@xterm/xterm/css/xterm.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Devrun UI",
  description: "Host-native multi-project service runner with shared terminals",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-base-200 text-base-content">{children}</body>
    </html>
  );
}
