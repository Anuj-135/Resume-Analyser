"use client";

import { FileText, TrendingUp, Award, AlertCircle } from "lucide-react";

export default function AnalyticsOverview({ analytics }) {
  const total = analytics?.totalAnalyses ?? 0;
  const avg = analytics?.averageScore !== null && analytics?.averageScore !== undefined ? `${analytics.averageScore}%` : "—";
  const highest = analytics?.highestScore !== null && analytics?.highestScore !== undefined ? `${analytics.highestScore}%` : "—";
  const lowest = analytics?.lowestScore !== null && analytics?.lowestScore !== undefined ? `${analytics.lowestScore}%` : "—";

  const cards = [
    {
      title: "Total Analyses",
      value: total,
      subtext: total === 1 ? "1 resume scored" : `${total} resumes scored`,
      icon: FileText,
      iconColor: "text-indigo-600",
      bgColor: "bg-indigo-50",
    },
    {
      title: "Average Score",
      value: avg,
      subtext: total > 0 ? "Overall ATS benchmark" : "No analyses yet",
      icon: TrendingUp,
      iconColor: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Highest Score",
      value: highest,
      subtext: total > 0 ? "Best evaluated resume" : "No analyses yet",
      icon: Award,
      iconColor: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      title: "Lowest Score",
      value: lowest,
      subtext: total > 0 ? "Areas for growth" : "No analyses yet",
      icon: AlertCircle,
      iconColor: "text-amber-600",
      bgColor: "bg-amber-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {cards.map((card, idx) => {
        const IconComponent = card.icon;
        return (
          <div
            key={idx}
            className="bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-6 shadow-sm border border-gray-100 flex flex-col justify-between transition-all duration-200 hover:shadow-md"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {card.title}
              </span>
              <div className={`p-2.5 rounded-2xl ${card.bgColor} ${card.iconColor}`}>
                <IconComponent className="w-5 h-5" />
              </div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
                {card.value}
              </div>
              <p className="text-xs text-gray-500 mt-1">{card.subtext}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
