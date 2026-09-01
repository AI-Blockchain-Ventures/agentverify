import type { MetadataRoute } from 'next'

const BASE_URL = 'https://aimodularity.com/agentverify'

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/docs/', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/pricing/', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/report/demo/', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/agentspoofed/', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/privacy/', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms/', priority: 0.3, changeFrequency: 'yearly' },
  ]

  return routes.map(route => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
