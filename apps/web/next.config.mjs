/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === 'true'

const nextConfig = {
  ...(isExport ? { output: 'export' } : {}),
  basePath: '/agentverify',
  trailingSlash: true,
  images: { unoptimized: true },
}

export default nextConfig
