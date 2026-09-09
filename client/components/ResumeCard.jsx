import Link from "next/link";
import ScoreCircle from "./ScoreCircle";

const ResumeCard = ({ resume }) => {
    const { id, companyName, jobTitle, feedback, imagePath } = resume;
    const score = feedback?.overallScore ?? 0;

    return (
        <Link 
            href={`/resume/${id}`} 
            className="group relative flex flex-col bg-white/90 backdrop-blur-md rounded-3xl p-5 border border-gray-100 shadow-sm hover:shadow-2xl hover:border-indigo-100 transition-all duration-300 transform hover:-translate-y-1.5 overflow-hidden"
        >
            {/* Header info */}
            <div className="flex flex-row items-center justify-between gap-4 mb-4">
                <div className="flex flex-col gap-1 min-w-0">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-600 w-fit">
                        {companyName}
                    </span>
                    <h3 className="text-xl font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                        {jobTitle}
                    </h3>
                </div>
                <div className="flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                    <ScoreCircle score={score} />
                </div>
            </div>

            {/* Resume Preview */}
            <div className="relative w-full h-[280px] rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 mb-4">
                <img
                    src={imagePath}
                    alt={`${companyName} resume`}
                    className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                    <span className="text-white text-sm font-semibold flex items-center gap-1.5">
                        View Detailed Analysis
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </span>
                </div>
            </div>

            {/* Card Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 text-xs font-medium text-gray-500 group-hover:text-indigo-600 transition-colors">
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    AI Analysis Ready
                </span>
                <span className="flex items-center gap-1 font-semibold text-indigo-600">
                    View Report
                    <svg className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </span>
            </div>
        </Link>
    );
};

export default ResumeCard;