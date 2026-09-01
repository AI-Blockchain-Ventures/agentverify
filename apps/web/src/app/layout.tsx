import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CookieBanner } from "@/components/CookieBanner";
import { LayoutChrome } from "@/components/layout/LayoutChrome";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const SITE_URL = "https://aimodularity.com/agentverify/";
const DESCRIPTION =
  "Agent Verify inspects AI agents for permissions, dangerous tools, execution controls, exposed secrets, runtime risks, dependencies, and audit gaps before deployment — then issues a VERIFIED or NOT VERIFIED result with evidence.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Agent Verify — Know What Your AI Agent Can Do Before You Deploy It",
    template: "%s — Agent Verify",
  },
  description: DESCRIPTION,
  keywords: [
    "AI agent security",
    "agent verification",
    "AI agent scanner",
    "A2SPA",
    "LLM security",
    "prompt injection",
    "agent permissions audit",
    "AI security tool",
  ],
  authors: [{ name: "AI Blockchain Ventures LLC" }],
  icons: {
    icon: "https://aimodularity.com/agentverify/agentverify-icon.png",
    shortcut: "https://aimodularity.com/agentverify/agentverify-icon.png",
    apple: "https://aimodularity.com/agentverify/agentverify-icon.png",
  },

  // Open Graph metadata for social sharing
  openGraph: {
    title: "Agent Verify — Know What Your AI Agent Can Do Before You Deploy It",
    description: DESCRIPTION,
    url: SITE_URL,
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
  twitter: {
    card: "summary_large_image",
    title: "Agent Verify — Know What Your AI Agent Can Do Before You Deploy It",
    description: DESCRIPTION,
    images: ["https://aimodularity.com/agentverify/agentverify-icon.png"],
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
        <link rel="shortcut icon" href="/agentverify/agentverify-icon.png" />
        <link rel="apple-touch-icon" href="/agentverify/agentverify-icon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />


      </head>
      <body className={`${inter.variable} min-h-full antialiased`}>
        <AuthProvider>
          <CookieBanner />
          <LayoutChrome>{children}</LayoutChrome>
        </AuthProvider>
      </body>
    </html>
  );
}
