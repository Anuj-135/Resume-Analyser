"use client";

export default function ScoreDistribution({ distribution, total = 0 }) {
  const high = distribution?.high ?? 0;
  const medium = distribution?.medium ?? 0;
  const low = distribution?.low ?? 0;

  const highPct = total > 0 ? Math.round((high / total) * 100) : 0;
  const medPct = total > 0 ? Math.round((medium / total) * 100) : 0;
  const lowPct = total > 0 ? Math.round((low / total) * 100) : 0;

  const tiers = [
    {
      label: "High Score (75+)",
      count: high,
      percentage: highPct,
      barColor: "bg-emerald-500",
      textColor: "text-emerald-700",
      badgeBg: "bg-emerald-50 border-emerald-200",
      description: "Strong ATS & recruiter alignment",
    },
    {
      label: "Medium Score (50-74)",
      count: medium,
      percentage: medPct,
      barColor: "bg-amber-500",
      textColor: "text-amber-700",
      badgeBg: "bg-amber-50 border-amber-200",
      description: "Good foundation, needs targeted optimization",
    },
    {
      label: "Low Score (<50)",
      count: low,
      percentage: lowPct,
      barColor: "bg-rose-500",
      textColor: "text-rose-700",
      badgeBg: "bg-rose-50 border-rose-200",
      description: "Requires significant revision & restructuring",
    },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 flex flex-col gap-6">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900">Score Distribution</h2>
        <p className="text-xs sm:text-sm text-gray-500">
          Breakdown of resume scores across standardized performance tiers
        </p>
      </div>

      {/* Segmented Visual Bar */}
      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden flex">
        {total > 0 ? (
          <>
            {highPct > 0 && (
              <div
                style={{ width: `${highPct}%` }}
                className="bg-emerald-500 h-full transition-all duration-500"
                title={`High: ${highPct}%`}
              />
            )}
            {medPct > 0 && (
              <div
                style={{ width: `${medPct}%` }}
                className="bg-amber-500 h-full transition-all duration-500"
                title={`Medium: ${medPct}%`}
              />
            )}
            {lowPct > 0 && (
              <div
                style={{ width: `${lowPct}%` }}
                className="bg-rose-500 h-full transition-all duration-500"
                title={`Low: ${lowPct}%`}
              />
            )}
          </>
        ) : (
          <div className="w-full bg-gray-200 h-full" />
        )}
      </div>

      {/* Breakdown Rows */}
      <div className="flex flex-col gap-3">
        {tiers.map((tier, idx) => (
          <div
            key={idx}
            className={`p-3.5 sm:p-4 rounded-2xl border ${tier.badgeBg} flex flex-col sm:flex-row sm:items-center justify-between gap-2`}
          >
            <div className="flex flex-col">
              <span className={`text-sm font-bold ${tier.textColor}`}>
                {tier.label}
              </span>
              <span className="text-xs text-gray-500">{tier.description}</span>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-center">
              <span className="text-xs sm:text-sm font-semibold text-gray-700">
                {tier.count} {tier.count === 1 ? "resume" : "resumes"}
              </span>
              <span className={`text-xs sm:text-sm font-extrabold ${tier.textColor} min-w-[45px] text-right`}>
                {tier.percentage}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
