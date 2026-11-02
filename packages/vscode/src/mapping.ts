/**
 * Turns a scan result into editor "problems" (file + line + severity). No `vscode` import here, so it can be unit tested.
 */
import type { Finding, ScanResult } from '../../cli/src/types'
import { locateLine, type PickedFile } from '../../cli/src/files'

export type ProblemSeverity = 'error' | 'warning' | 'info'

export interface Problem {
  /** File path relative to the scanned folder (or the file name for a single-file scan). */
  path: string
  /** 0-based line for the editor. */
  line: number
  severity: ProblemSeverity
  message: string
  code: string
  title: string
  fixLocked: boolean
  fixSteps: string
  fixCode: string
}

export interface ProblemMap {
  problems: Problem[]
  /** Findings that are about the project as a whole (no single line), shown in the report instead of on a line. */
  projectLevel: Finding[]
}

export function severityOf(finding: Finding): ProblemSeverity {
  if (finding.severity === 'critical' || finding.severity === 'high') return 'error'
  if (finding.severity === 'medium') return 'warning'
  return 'info'
}

function toProblem(f: Finding, path: string, line1: number): Problem {
  return {
    path,
    line: Math.max(0, line1 - 1),
    severity: severityOf(f),
    message: `[${f.severity.toUpperCase()}] ${f.title}: ${f.whatIsWrong}${f.fixLocked ? ' (fix included with Pro)' : ''}`,
    code: f.code,
    title: f.title,
    fixLocked: f.fixLocked === true,
    fixSteps: (f.recommendedFix ?? '').trim(),
    fixCode: (f.quickFix ?? f.fixCode ?? '').trim(),
  }
}

export function mapFindings(result: ScanResult, files: PickedFile[]): ProblemMap {
  const problems: Problem[] = []
  const projectLevel: Finding[] = []
  for (const f of result.findings ?? []) {
    if (typeof f.line === 'number' && f.line > 0) {
      const where = locateLine(files, f.line)
      if (where) {
        problems.push(toProblem(f, where.path, where.line))
        continue
      }
    }
    // A single file: a finding without a line (e.g. "no rate limiting anywhere") goes on line 1 of that file.
    if (files.length === 1) problems.push(toProblem(f, files[0].path, 1))
    else projectLevel.push(f)
  }
  return { problems, projectLevel }
}

/** Short status-bar text, e.g. "35/100 · 3 issues". */
export function statusText(result: ScanResult): string {
  const n = (result.findings ?? []).length
  return `${result.riskScore}/100 · ${n === 0 ? 'no issues' : `${n} issue${n === 1 ? '' : 's'}`}`
}

export const SCANNABLE_LANGUAGE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.py', '.json', '.yaml', '.yml', '.toml', '.md', '.mjs', '.cjs', '.sh']
