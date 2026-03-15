import type { Metadata } from "next";
import {
  DM_Mono,
  DM_Sans,
  DM_Serif_Display,
  EB_Garamond,
  Fraunces,
  Inter,
  Manrope,
  Noto_Sans_KR,
  Noto_Serif_KR,
} from "next/font/google";

import { LocaleProvider } from "../lib/i18n";
import { ThemeProvider } from "../lib/theme";
import "./globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-eb-garamond",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-dm-mono",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-sans",
});

const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-dm-serif-display",
});

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-noto-sans-kr",
});

const notoSerifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-noto-serif-kr",
});

export const metadata: Metadata = {
  title: "K-ERA Research Web",
  description: "Clinical research workspace for infectious keratitis case review and validation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${serif.variable} ${inter.variable} ${ebGaramond.variable} ${dmMono.variable} ${dmSans.variable} ${dmSerifDisplay.variable} ${notoSansKr.variable} ${notoSerifKr.variable}`}
      >
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
