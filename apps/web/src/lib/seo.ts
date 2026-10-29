import type { Metadata } from 'next'

export const SITE_ORIGIN = 'https://aimodularity.com'
export const SITE_URL = `${SITE_ORIGIN}/agentverify/`

/** 1200x630 social share card (public/og-image.png). */
export const OG_IMAGE = {
  url: `${SITE_URL}og-image.png`,
  width: 1200,
  height: 630,
  alt: 'Agent Verify — scan your AI agent for security risks before you deploy it',
}

/** Full URL for a page path such as '/pricing' (always with the ending slash the site uses). */
export function pageUrl(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '')
  return clean ? `${SITE_URL}${clean}/` : SITE_URL
}

/** Title, description, canonical URL, and share card for one public page. */
export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = pageUrl(path)
  const shareTitle = `${title} — Agent Verify`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: shareTitle, description, url, siteName: 'Agent Verify', type: 'website', locale: 'en_US', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: shareTitle, description, images: [OG_IMAGE.url] },
  }
}

/** For signed-in or per-user pages that should not appear in search results. */
export function privatePageMetadata(title: string): Metadata {
  // A layout's title resets the root title template for pages under it, so set it again here.
  return {
    title: { default: title, template: '%s — Agent Verify' },
    robots: { index: false, follow: true },
    alternates: {},
  }
}
