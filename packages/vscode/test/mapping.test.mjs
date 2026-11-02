import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapFindings, severityOf, statusText } from './.build/mapping.mjs'

const f = (code, severity, line, extra = {}) => ({ id: code, code, title: code, category: 'B', severity, whatIsWrong: 'w', whyItMatters: 'y', recommendedFix: '', line, ...extra })

test('single file: findings land on their line (0-based); findings without a line go on the first line', () => {
  const files = [{ path: 'agent.py', content: 'a\nb\nc\n' }]
  const { problems, projectLevel } = mapFindings({ riskScore: 40, findings: [f('SQL', 'critical', 3), f('NO_RATE', 'medium')] }, files)
  assert.deepEqual(problems.map(p => [p.path, p.line, p.severity]), [['agent.py', 2, 'error'], ['agent.py', 0, 'warning']])
  assert.equal(projectLevel.length, 0)
})

test('project scan: lines are mapped back to the right file; line-less findings are project-wide', () => {
  const files = [{ path: 'a.py', content: 'x\ny' }, { path: 'tools/b.py', content: 'p\nq\nr' }]
  // combined: 1 header a, 2 x, 3 y, 4 blank, 5 header b, 6 p, 7 q, 8 r
  const { problems, projectLevel } = mapFindings({ riskScore: 40, findings: [f('A', 'high', 3), f('B', 'low', 7), f('HEADER', 'low', 5), f('GLOBAL', 'medium')] }, files)
  assert.deepEqual(problems.map(p => [p.code, p.path, p.line]), [['A', 'a.py', 1], ['B', 'tools/b.py', 1]])
  assert.deepEqual(projectLevel.map(x => x.code), ['HEADER', 'GLOBAL'])
})

test('locked fixes are marked and say Pro; returned fixes are carried for the quick fix', () => {
  const files = [{ path: 'x.js', content: 'line' }]
  const { problems } = mapFindings({ riskScore: 10, findings: [f('L', 'high', 1, { fixLocked: true }), f('F', 'low', 1, { recommendedFix: 'Do this', quickFix: 'code()' })] }, files)
  assert.equal(problems[0].fixLocked, true)
  assert.match(problems[0].message, /fix included with Pro/)
  assert.equal(problems[1].fixSteps, 'Do this')
  assert.equal(problems[1].fixCode, 'code()')
})

test('severity and status text', () => {
  assert.equal(severityOf({ severity: 'critical' }), 'error')
  assert.equal(severityOf({ severity: 'low' }), 'info')
  assert.equal(statusText({ riskScore: 35, findings: [1, 2, 3] }), '35/100 · 3 issues')
  assert.equal(statusText({ riskScore: 100, findings: [] }), '100/100 · no issues')
})
