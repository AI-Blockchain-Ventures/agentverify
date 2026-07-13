'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/components/auth/AuthProvider'
import { ReportView } from '@/components/report/ReportView'
import { canUseProFeature } from '@/lib/billing'
import { useBillingStatusState } from '@/lib/useBillingStatus'
import type { CategoryScore, Finding, RuntimeBOM as RuntimeBOMType } from '@/types'

const normalizeVerdict = (value: unknown): 'VERIFIED' | 'NOT VERIFIED' => {
  if (value === 'VERIFIED') return 'VERIFIED'
  return 'NOT VERIFIED'
}

function ReportPageInner() {
  const searchParams = useSearchParams()
  const reportId = searchParams.get('id')
  const { user, loading: authLoading } = useAuth()
  const billing = useBillingStatusState(user)
  const billingStatus = billing.status

  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [upgradePrompt, setUpgradePrompt] = useState<string | null>(null)

  useEffect(() => {
    if (!reportId || authLoading) return

    const load = async () => {
      setLoading(true)
      setNotFound(false)
      let data: Record<string, unknown> | null = null
      let source: string | null = null

      try {
        const reportDoc = await getDoc(doc(db, 'reports', reportId))
        if (reportDoc.exists()) {
          data = reportDoc.data()
          source = 'reports'
        }
      } catch (e) {
        console.error('reports fetch error:', e)
      }

      if (!data && user) {
        try {
          const ownDoc = await getDoc(doc(db, 'users', user.uid, 'reports', reportId))
          if (ownDoc.exists()) {
            data = ownDoc.data()
            source = 'userReports'
          }
        } catch (e) {
          console.error('user report fetch error:', e)
        }
      }

      if (!data && user) {
        try {
          const cliDoc = await getDoc(doc(db, 'cliReports', reportId))
          if (cliDoc.exists()) {
            data = cliDoc.data()
            source = 'cliReports'
          }
        } catch (e) {
          console.error('cliReports fetch error:', e)
        }
      }

      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      const loadedReport: Record<string, unknown> = { ...data, reportId, _source: source }
      setReport(loadedReport)
      setLoading(false)
    }

    void load()
  }, [reportId, user, authLoading])

  useEffect(() => {
    if (billingStatus.plan === 'pro' && billingStatus.status === 'active') setUpgradePrompt(null)
  }, [billingStatus.plan, billingStatus.status])

  const isOwner = !!(user && report && (
    user.uid === report.uid ||
    user.uid === report.userId
  ))

  const copyLink = () => {
    if (!report) return
    if (!canUseProFeature(billingStatus, 'reportSharing')) {
      const message = 'Report sharing is included in Pro. Request Pro access to enable public links and stakeholder sharing.'
      setUpgradePrompt(message)
      return
    }
    const url = `https://aimodularity.com/agentverify/report/?id=${report.reportId}`
    navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const emailReport = () => {
    if (!report) return
    if (!canUseProFeature(billingStatus, 'reportSharing')) {
      const message = 'Report sharing is included in Pro. Request Pro access to share reports by email.'
      setUpgradePrompt(message)
      return
    }
    const subject = `Agent Verify Report — ${report.fileName} — ${report.verdict}`
    const body = `Agent Verify Execution Trust Report\n\nFile: ${report.fileName}\nVerdict: ${report.verdict}\nScore: ${report.riskScore}/100\n\nView full report: https://aimodularity.com/agentverify/report/?id=${report.reportId}\n\nPowered by Agent Verify`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const downloadPDF = async () => {
    if (!report) return
    if (!canUseProFeature(billingStatus, 'pdfExport')) {
      const message = 'PDF export is a Pro feature. Request Pro access to download report evidence as PDF.'
      setUpgradePrompt(message)
      return
    }
    const reportData = report
    const getText = (value: unknown, fallback = '') => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 20
    const contentWidth = pageWidth - margin * 2
    let y = 20

    const addText = (text: string, size: number, color: [number, number, number], bold = false) => {
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(text, contentWidth)
      doc.text(lines, margin, y)
      y += lines.length * size * 0.4 + 3
      if (y > 270) { doc.addPage(); y = 20 }
    }

    const addDivider = () => {
      doc.setDrawColor(200, 200, 200)
      doc.line(margin, y, pageWidth - margin, y)
      y += 6
    }

    addText('AGENT VERIFY', 8, [0, 150, 160], true)
    addText('Execution Trust Report', 18, [20, 20, 20], true)
    y += 2
    addText(`Report ID: ${getText(reportData.reportId)}`, 9, [100, 100, 100])
    addText(`Scanned: ${new Date(getText(reportData.scannedAt, new Date().toISOString())).toLocaleString()}`, 9, [100, 100, 100])
    addText(`Source: ${reportData.source === 'cli' ? 'CLI Scanner' : 'Dashboard'}`, 9, [100, 100, 100])
    y += 4
    addDivider()

    const verified = reportData.verdict === 'VERIFIED'
    addText(
      verified ? 'EXECUTION AUTHORIZED' : 'EXECUTION NOT AUTHORIZED',
      16,
      verified ? [0, 150, 100] : [200, 50, 50],
      true
    )
    addText(`Risk Score: ${getText(reportData.riskScore, '0')}/100`, 14, [20, 20, 20], true)
    addText(`Risk Level: ${getText(reportData.riskLevel)}`, 10, [100, 100, 100])
    addText(`File: ${getText(reportData.fileName)}`, 10, [100, 100, 100])
    y += 4
    addDivider()

    const findingsList = Array.isArray(reportData.findings) ? reportData.findings : []
    if (findingsList.length > 0) {
      addText('FINDINGS', 9, [100, 100, 100], true)
      y += 2
      findingsList.forEach((f: unknown, i: number) => {
        const finding = typeof f === 'object' && f !== null ? f as Record<string, unknown> : null
        const title = typeof f === 'string' ? f : getText(finding?.title)
        const severity = typeof f === 'string' ? 'medium' : getText(finding?.severity, 'medium')
        const fix = typeof f === 'string' ? '' : getText(finding?.recommendedFix)
        addText(`${i + 1}. ${title}`, 11, [20, 20, 20], true)
        addText(`Severity: ${String(severity).toUpperCase()}`, 9, [100, 100, 100])
        if (fix) addText(`Fix: ${fix}`, 9, [100, 100, 100])
        y += 2
      })
      addDivider()
    }

    addText('Generated by Agent Verify — Execution Trust Analysis Platform', 8, [150, 150, 150])
    addText('Powered by A2SPA · AI Blockchain Ventures LLC · aiblockchainventures.com', 8, [150, 150, 150])

    doc.save(`agent-verify-report-${getText(reportData.reportId)}.pdf`)
  }

  const renderReportView = (owner: boolean) => {
    if (!report) return null
    const r = report

    const getStr = (v: unknown, fb = ''): string => typeof v === 'string' ? v : fb
    const getNum = (v: unknown, fb = 0): number => typeof v === 'number' ? v : fb
    const getArr = (v: unknown): unknown[] => Array.isArray(v) ? v : []

    const verdict = normalizeVerdict(r.verdict)
    const riskScore = getNum(r.riskScore, 0)
    const riskLevel = getStr(r.riskLevel, 'High Risk') as 'Low Risk' | 'Moderate Risk' | 'High Risk'
    const fileName = getStr(r.fileName, 'Agent Config')
    const platform = typeof r.platform === 'string' ? r.platform : null
    const scannedAt = getStr(r.scannedAt, new Date().toISOString())
    const source = getStr(r.source, 'dashboard')
    const findings = getArr(r.findings)
    const categoryScores = getArr(r.categoryScores)
    const bom = typeof r.bom === 'object' && r.bom !== null ? r.bom : null
    const readyReport = r
    const resolvedReportId = getStr(r.reportId, '')
    const reportUrl = `https://aimodularity.com/agentverify/report/?id=${resolvedReportId}`

    return (
      <>
      <div
        style={{ borderBottom: '1px solid var(--border)' }}
        className="no-print mx-auto mb-6 flex max-w-3xl flex-col gap-3 px-4 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between md:px-6"
      >
        <button
          onClick={() => window.history.back()}
          style={{ color: 'var(--text-muted)' }}
          className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
        >
          ← Back
        </button>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {isOwner && (
            <span
              style={{
                color: readyReport.isPublic ? '#00B37E' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              className="rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              {readyReport.isPublic ? '🌐 Public' : '🔒 Private'}
            </span>
          )}
          <button
            onClick={downloadPDF}
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs transition-opacity hover:opacity-70 sm:flex-none sm:py-1.5"
          >
            Download PDF
          </button>
          <button
            onClick={emailReport}
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs transition-opacity hover:opacity-70 sm:flex-none sm:py-1.5"
          >
            Email
          </button>
          <button
            onClick={copyLink}
            style={{
              backgroundColor: linkCopied ? '#00C4CC' : 'var(--card)',
              color: linkCopied ? '#060A0F' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all sm:flex-none sm:py-1.5"
          >
            {linkCopied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
      {upgradePrompt && (
        <div className="no-print mx-auto mb-6 max-w-3xl px-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-4 md:flex-row md:items-center md:justify-between">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm">{upgradePrompt}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={billing.refresh} disabled={billing.loading} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-60">{billing.loading ? 'Refreshing...' : 'Refresh billing'}</button>
              <Link href="/pricing" className="rounded-lg bg-[#00C4CC] px-3 py-2 text-center text-xs font-semibold text-[#060A0F]">Compare plans</Link>
            </div>
          </div>
        </div>
      )}
        <ReportView
          report={readyReport}
          verdict={verdict}
          riskScore={riskScore}
          riskLevel={riskLevel}
          fileName={fileName}
          platform={platform}
          scannedAt={scannedAt}
          source={source}
          findings={findings as Array<Finding | Partial<Finding> | string>}
          categoryScores={categoryScores as CategoryScore[]}
          bom={bom as RuntimeBOMType | null}
          reportId={resolvedReportId}
          reportUrl={reportUrl}
          user={user}
          isOwner={owner}
          onReportUpdate={(updates) => setReport(prev => prev ? { ...prev, ...updates } : prev)}
          onUpgradePrompt={(message) => setUpgradePrompt(message)}
          billingStatus={billingStatus}
        />
      </>
    )
  }

  if (authLoading || loading) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
          <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Loading security report</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Checking report visibility and details.</p>
        </div>
      </div>
    )
  }

  if (notFound || !report) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="max-w-md rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E07B39]/10 text-lg font-semibold text-[#E07B39]">?</div>
          <p style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">Report not found</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">This security report may have been deleted, kept private, or opened with an incorrect link.</p>
          <Link href="/dashboard" className="mt-6 inline-flex rounded-2xl bg-[#00C4CC] px-5 py-3 text-sm font-semibold text-[#060A0F]">Back to dashboard</Link>
        </div>
      </div>
    )
  }

  if (isOwner) {
    return renderReportView(true)
  }

  if (report.isPublic === true) {
    return renderReportView(false)
  }

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="max-w-md rounded-2xl p-8 text-center shadow-2xl shadow-black/10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#06B6D4]/10 text-2xl">🔒</div>
        <p style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">This report is private</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">
          {user ? 'You do not have access to this report. Ask the owner to make it public.' : 'Ask the owner to enable public sharing, or sign in with the owner account.'}
        </p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-5 rounded-xl border border-[var(--border)] px-4 py-3 text-xs">
          Public reports use the canonical URL format: https://aimodularity.com/agentverify/report/?id=REPORT_ID
        </p>
      </div>
    </div>
  )
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen" />}>
      <ReportPageInner />
    </Suspense>
  )
}
