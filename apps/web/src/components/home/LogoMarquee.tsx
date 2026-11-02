/* eslint-disable @next/next/no-img-element -- small static SVG logos; next/image adds nothing here */
import { assetUrl } from '@/lib/assets'

const LOGOS = [
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['bitbucket', 'Bitbucket'],
  ['vscode', 'VS Code'],
  ['claude', 'Claude Code'],
  ['cursor', 'Cursor'],
  ['slack', 'Slack'],
  ['openai', 'OpenAI'],
  ['langchain', 'LangChain'],
] as const

/** "Works with" strip: the tools' logos scroll slowly to the left (paused on hover, still for reduced motion). */
export function LogoMarquee() {
  const row = (dup: boolean) => LOGOS.map(([file, name]) => (
    <span key={`${file}-${dup}`} className={`av-marquee-item flex items-center gap-2.5 whitespace-nowrap text-[15px] font-semibold ${dup ? 'av-marquee-dup' : ''}`} style={{ color: 'var(--text-muted)' }} aria-hidden={dup || undefined}>
      <img src={assetUrl(`/brands/${file}.svg`)} alt="" width={26} height={26} className="av-logo-mono h-[26px] w-[26px]" loading="lazy" />
      {name}
    </span>
  ))
  return (
    <section aria-label="Works with" className="py-12 md:py-14" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="av-container">
        <h2 className="mb-8 text-center text-lg font-semibold tracking-tight md:text-xl" style={{ color: 'var(--text-primary)' }}>Works with the tools your team already uses</h2>
        <div className="av-marquee">
          <div className="av-marquee-track">
            {row(false)}
            {row(true)}
          </div>
        </div>
      </div>
    </section>
  )
}
