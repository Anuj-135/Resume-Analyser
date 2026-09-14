import Link from "next/link";
import ScoreCircle from "./ScoreCircle";

const ResumeCard = ({ resume, onDelete, isDeleting }) => {
    const resumeId = resume._id || resume.id;
    const { companyName, jobTitle, feedback, imagePath } = resume;
    const score = feedback?.overallScore ?? 0;

    return (
        <Link 
            href={`/resume/${resumeId}`} 
            className="group relative flex flex-col bg-white/90 backdrop-blur-md rounded-3xl p-5 border border-gray-100 shadow-sm hover:shadow-2xl hover:border-indigo-100 transition-all duration-300 transform hover:-translate-y-1.5 overflow-hidden"
        >
            {/* Header info */}
            <div className="flex flex-row items-center justify-between gap-4 mb-4">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-600 w-fit truncate">
                            {companyName}
                        </span>
                        {onDelete && (
                            <button
                                type="button"
                                title="Delete resume"
                                aria-label="Delete resume"
                                disabled={isDeleting}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onDelete(resumeId);
                                }}
                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors cursor-pointer z-10 disabled:opacity-50"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        )}
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                        {jobTitle}
                    </h3>
                </div>
                <div className="flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                    <ScoreCircle score={score} />
                </div>
            </div>

            {/* Resume Preview */}
            <div className="relative w-full h-[280px] rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 mb-4 flex items-center justify-center">
                {imagePath ? (
                    <img
                        src={imagePath}
                        alt={`${companyName} resume`}
                        className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center p-6 text-center text-gray-400 group-hover:text-indigo-500 transition-colors">
                        <img src="/images/pdf.png" alt="PDF icon" className="w-16 h-16 mb-2 opacity-80 group-hover:opacity-100 transition-opacity" />
                        <span className="text-xs font-semibold text-gray-500">PDF Application Document</span>
                        <span className="text-[11px] text-gray-400 mt-0.5">Click to view analysis</span>
                    </div>
                )}
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