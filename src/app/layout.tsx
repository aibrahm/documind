import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocuMind",
  description:
    "Bilingual document intelligence — contracts, memos, laws, and briefings synthesized on demand.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/*
          Four font families, loaded in a single Google Fonts request:
            - Source Serif 4 — display (greetings, briefing title, project name, page headings)
            - IBM Plex Sans — body (English)
            - IBM Plex Sans Arabic — body (Arabic)
            - IBM Plex Mono — metadata labels and numeric data (sparingly)
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="dm-body">
        {children}
      </body>
    </html>
  );
}
