'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/components/auth/AuthProvider'
import { ReportView } from '@/components/report/ReportView'
import type { CategoryScore, Finding, RuntimeBOM as RuntimeBOMType } from '@/types'

function ReportPageInner() {
  const searchParams = useSearchParams()
  const reportId = searchParams.get('id')
  const { user, loading: authLoading } = useAuth()

  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [passwordVerified, setPasswordVerified] = useState(false)
  const [enteredPassword, setEnteredPassword] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

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

      if (!data) {
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

  const isOwner = !!(user && report && (
    user.uid === report.uid ||
    user.uid === report.userId
  ))

  const copyLink = () => {
    if (!report) return
    const url = `https://aimodularity.com/agentverify/report/?id=${report.reportId}`
    navigator.clipboard.writeText(url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const emailReport = () => {
    if (!report) return
    const subject = `Agent Verify Report — ${report.fileName} — ${report.verdict}`
    const body = `Agent Verify Execution Trust Report\n\nFile: ${report.fileName}\nVerdict: ${report.verdict}\nScore: ${report.riskScore}/100\n\nView full report: https://aimodularity.com/agentverify/report/?id=${report.reportId}\n\nPowered by Agent Verify`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const downloadPDF = async () => {
    if (!report) return
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

    const verdict = getStr(r.verdict, 'NOT VERIFIED') as 'VERIFIED' | 'NOT VERIFIED'
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
        className="no-print mx-auto mb-6 flex max-w-3xl items-center justify-between px-6 pb-4 pt-6"
      >
        <button
          onClick={() => window.history.back()}
          style={{ color: 'var(--text-muted)' }}
          className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
        >
          ← Back
        </button>

        <div className="flex items-center gap-2">
          {isOwner && (
            <span
              style={{
                color: readyReport.isPublic ? '#00B37E' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              {readyReport.isPublic ? '🌐 Public' : '🔒 Private'}
            </span>
          )}
          <button
            onClick={downloadPDF}
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-opacity hover:opacity-70"
          >
            ↓ Download PDF
          </button>
          <button
            onClick={emailReport}
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-opacity hover:opacity-70"
          >
            ✉ Email
          </button>
          <button
            onClick={copyLink}
            style={{
              backgroundColor: linkCopied ? '#00C4CC' : 'var(--card)',
              color: linkCopied ? '#060A0F' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
          >
            {linkCopied ? '✓ Copied' : '↗ Copy Link'}
          </button>
        </div>
      </div>
        <ReportView
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
        />
      </>
    )
  }

  const checkPassword = () => {
    if (enteredPassword === report?.password) {
      setPasswordVerified(true)
      setPasswordError(false)
    } else {
      setPasswordError(true)
    }
  }

  if (authLoading || loading) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center">
        <div style={{ color: 'var(--text-muted)' }} className="text-sm">Loading report...</div>
      </div>
    )
  }

  if (notFound || !report) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <p style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Report not found</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">This report may have been deleted or the link is incorrect.</p>
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

  if (report.password) {
    if (passwordVerified) {
      return renderReportView(false)
    }
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-sm rounded-2xl p-8 text-center">
          <div className="mb-4 text-4xl">🔒</div>
          <h2 style={{ color: 'var(--text-primary)' }} className="mb-1 text-lg font-bold">Password required</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mb-6 text-sm">This report is password protected</p>
          <input
            type="password"
            value={enteredPassword}
            onChange={e => setEnteredPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && checkPassword()}
            placeholder="Enter password"
            autoFocus
            style={{
              backgroundColor: 'var(--input-bg)',
              border: passwordError ? '1px solid #E03E3E' : '1px solid var(--input-border)',
              color: 'var(--text-primary)',
            }}
            className="mb-3 w-full rounded-lg px-4 py-3 text-center text-sm outline-none"
          />
          {passwordError && <p className="mb-3 text-xs text-[#E03E3E]">Incorrect password</p>}
          <button onClick={checkPassword} className="w-full rounded-lg bg-[#00C4CC] py-3 font-semibold text-[#060A0F] hover:bg-[#00D9E0]">
            View Report
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mb-4 text-4xl">🔒</div>
        <p style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">This report is private</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">
          {user ? 'You do not have access to this report.' : 'Sign in with the report owner account to view it, or ask them to share a public link.'}
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
