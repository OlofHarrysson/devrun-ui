import "../styles/main.css";
import "../styles/olof-theme.css";
import "../styles/workspace.css";
import "@xterm/xterm/css/xterm.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Terminal Manager",
  description: "Host-native multi-project service runner with shared terminals",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body data-theme="olof">
        {children}
      </body>
    </html>
  );
}
