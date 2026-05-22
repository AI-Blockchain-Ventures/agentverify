import { ReportClient } from './ReportClient'

export function generateStaticParams() {
  return [{ reportId: 'REPORT-btapj07nq56' }]
}

export const dynamicParams = false

export default function ReportPage() {
  return <ReportClient />
}
