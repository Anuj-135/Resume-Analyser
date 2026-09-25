"use client";

import ScoreBadge from "@/components/ScoreBadge";

export default function CategoryScores({ categoryAverages }) {
  const categories = [
    {
      key: "ats",
      title: "ATS Compatibility",
      score: categoryAverages?.ats ?? null,
      description: "Formatting readability, standard headings, and keyword indexing",
    },
    {
      key: "contentQuality",
      title: "Content Quality",
      score: categoryAverages?.contentQuality ?? null,
      description: "Relevance, quantified metrics, and accomplishment statements",
    },
    {
      key: "structure",
      title: "Structure & Layout",
      score: categoryAverages?.structure ?? null,
      description: "Visual hierarchy, section organization, and flow",
    },
    {
      key: "toneAndStyle",
      title: "Tone & Style",
      score: categoryAverages?.toneAndStyle ?? null,
      description: "Action verbs, professionalism, and concise writing",
    },
    {
      key: "keySkills",
      title: "Key Skills Alignment",
      score: categoryAverages?.keySkills ?? null,
      description: "Hard and soft skills matched to target job expectations",
    },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 flex flex-col gap-6">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-gray-900">Category Performance</h2>
        <p className="text-xs sm:text-sm text-gray-500">
          Average scores calculated across all evaluated resume dimensions
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {categories.map((cat) => {
          const hasScore = typeof cat.score === "number";
          const scoreVal = hasScore ? cat.score : 0;

          return (
            <div
              key={cat.key}
              className="bg-gray-50/70 rounded-2xl p-4 sm:p-5 border border-gray-100/80 flex flex-col gap-2.5 transition-all duration-200 hover:bg-gray-50"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-sm sm:text-base font-bold text-gray-900">
                    {cat.title}
                  </span>
                  <span className="text-xs text-gray-500">{cat.description}</span>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  {hasScore ? (
                    <>
                      <ScoreBadge score={cat.score} />
                      <span className="text-sm sm:text-base font-extrabold text-gray-900 min-w-[50px] text-right">
                        {cat.score}/100
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-gray-400">—</span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mt-1">
                <div
                  style={{ width: `${scoreVal}%` }}
                  className={`h-full rounded-full transition-all duration-500 ${
                    !hasScore
                      ? "bg-transparent"
                      : scoreVal >= 75
                      ? "bg-emerald-500"
                      : scoreVal >= 50
                      ? "bg-amber-500"
                      : "bg-rose-500"
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
