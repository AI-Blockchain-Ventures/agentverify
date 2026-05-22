'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ReportClient } from './[reportId]/ReportClient'

function ReportQueryPage() {
  const reportId = useSearchParams().get('id')
  return <ReportClient reportId={reportId} />
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-24 text-center text-[#4B6080]">Loading report...</div>}>
      <ReportQueryPage />
    </Suspense>
  )
}
