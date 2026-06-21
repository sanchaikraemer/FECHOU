import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar — análise de negociação imobiliária",
  description:
    "Importe uma conversa do WhatsApp e descubra exatamente o que fazer para avançar a negociação.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Radar",
    statusBarStyle: "black-translucent",
  },
  icons: { apple: "/assets/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0C1D24",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" translate="no">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
