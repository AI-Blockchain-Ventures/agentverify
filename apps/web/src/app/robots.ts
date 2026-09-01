import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // The demo report is public marketing content and should be indexable; individual
        // scan report pages (/report/?id=...) are private-by-default user content and should
        // not be crawled even when a specific one has been made public.
        allow: ['/', '/report/demo/'],
        disallow: ['/dashboard', '/report/'],
      },
    ],
    sitemap: 'https://aimodularity.com/agentverify/sitemap.xml',
  }
}
