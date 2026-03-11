import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";

import { LocaleProvider } from "../lib/i18n";
import "./globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "K-ERA Research Web",
  description: "Clinical research workspace for infectious keratitis case review and validation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
