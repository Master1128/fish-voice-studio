import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fish Voice Studio — TTS Playground",
  description:
    "Playground de texto a voz con los modelos Fish Audio (S2.1 Pro, S2 Pro, S1) gratis en Vercel AI Gateway: miles de voces, clonación, transcripción y controles de audio.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Las extensiones del navegador (traductores, etc.) inyectan atributos en <html>
      // antes de hidratar React; se silencia solo este elemento para evitar falsos avisos.
      suppressHydrationWarning
    >
      <body className="min-h-full bg-zinc-950 font-sans text-zinc-100">{children}</body>
    </html>
  );
}
