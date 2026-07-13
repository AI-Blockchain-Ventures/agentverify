import { scan, type ScanInput, type ScanResult } from '@agentverify/scanner'

export function createScanResult(input: ScanInput): ScanResult {
  return scan(input)
}
