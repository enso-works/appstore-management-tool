import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "store-shots",
  description: "App Store screenshots and store management for the workspace apps",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
