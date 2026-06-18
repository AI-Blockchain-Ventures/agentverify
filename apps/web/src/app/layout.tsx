import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CookieBanner } from "@/components/CookieBanner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Verify — Execution Trust Analysis",
  description: "Determine whether your AI agent is authorized, scoped, and safe to execute.",
  icons: {
    icon: "https://aimodularity.com/agentverify/agentverify-icon.png",
    shortcut: "https://aimodularity.com/agentverify/agentverify-icon.png",
    apple: "https://aimodularity.com/agentverify/agentverify-icon.png",
  },

  // Open Graph metadata for social sharing
  openGraph: {
    title: "Agent Verify — Execution Trust Analysis",
    description: "Determine whether your AI agent is authorized, scoped, and safe to execute.",
    url: "https://aimodularity.com/agentverify/",
    siteName: "Agent Verify",
    images: [
      {
        url: "https://aimodularity.com/agentverify/agentverify-icon.png",
        width: 1200,
        height: 630,
        alt: "Agent Verify - Execution Trust Analysis",
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/agentverify/agentverify-icon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('av_theme');
                  var preferred = window.matchMedia('(prefers-color-scheme: dark)').matches 
                    ? 'dark' : 'light';
                  var theme = stored || preferred;
                  document.documentElement.classList.add(theme);
                } catch(e) {}
              })()
            `,
          }}
        />
        <link rel="shortcut icon" href="/agentverify-icon.png" />
        <link rel="apple-touch-icon" href="/agentverify-icon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />


      </head>
      <body className={`${inter.variable} min-h-full antialiased`}>
        <AuthProvider>
          <CookieBanner />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
