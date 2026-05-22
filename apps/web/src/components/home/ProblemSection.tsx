export function ProblemSection() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-10">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#EF4444]">THE PROBLEM</p>
        <h2 className="mb-4 text-3xl font-bold text-white">AI agents operate with real-world authority.</h2>
        <p className="text-lg leading-relaxed text-[#94A3B8]">
          They call APIs, manage credentials, execute financial transactions, and trigger irreversible actions — without a standardized verification layer. Agents are deployed without any analysis of what they can do, whether their requests are authentic, or whether their execution boundaries are appropriate. Agent Verify is that verification layer.
        </p>
      </div>
    </section>
  )
}
