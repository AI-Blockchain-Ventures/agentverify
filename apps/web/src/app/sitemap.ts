import type { MetadataRoute } from 'next'
import { mcpComparisons, mcpSafety } from '@/lib/mcpSafety'
import { checkLibrary } from '@/lib/checkLibrary'

const BASE_URL = 'https://aimodularity.com/agentverify'

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/docs/', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/pricing/', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/trust/', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/status/', priority: 0.3, changeFrequency: 'daily' },
    { path: '/developers/', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/mcp/', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/checks/', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/whats-new/', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/state-of-mcp-security/', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/state-of-agent-security/', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/owasp-agentic-skills/', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/profile-attestation/', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/report/demo/', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/agentspoofed/', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/privacy/', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms/', priority: 0.3, changeFrequency: 'yearly' },
  ]
  for (const s of mcpSafety.servers) routes.push({ path: `/mcp/${s.slug}/`, priority: 0.6, changeFrequency: 'weekly' })
  routes.push({ path: '/mcp/new/', priority: 0.6, changeFrequency: 'weekly' })
  for (const c of checkLibrary.checks) routes.push({ path: `/checks/${c.slug}/`, priority: 0.6, changeFrequency: 'monthly' })
  for (const c of mcpComparisons()) routes.push({ path: `/mcp/compare/${c.slug}/`, priority: 0.5, changeFrequency: 'monthly' })

  return routes.map(route => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
