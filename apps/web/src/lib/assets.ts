export const assetUrl = (path: string) => {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '/agentverify'
  return `${base}${path}`
}
