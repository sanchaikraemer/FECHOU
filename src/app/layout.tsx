import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar de Vendas — análise de negociação imobiliária",
  description: "Importe uma conversa do WhatsApp e identifique a próxima ação comercial.",
  manifest: "/manifest.json",
  applicationName: "Radar de Vendas",
  appleWebApp: {
    capable: true,
    title: "Radar",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/assets/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/assets/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/assets/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C1D24",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" translate="no">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
