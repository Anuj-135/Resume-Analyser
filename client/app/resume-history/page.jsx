"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ResumeCard from "@/components/ResumeCard";
import ProtectedRoute from "@/components/ProtectedRoute";
import { usePuterStore } from "@/lib/puter";

function ResumeHistory() {
    const router = useRouter();
    const { auth, isLoading, kv, fs } = usePuterStore();

    const [resumes, setResumes] = useState([]);
    const [isFetching, setIsFetching] = useState(true);
    const [isWiping, setIsWiping] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedFilter, setSelectedFilter] = useState("all");

    // Fetch all resumes from Puter KV
    useEffect(() => {
        const fetchResumes = async () => {
            if (!auth.isAuthenticated) return;

            setIsFetching(true);
            try {
                // kv.list("resume:*", true) returns [{ key, value }]
                const entries = await kv.list("resume:*", true);
                if (!entries || entries.length === 0) {
                    setResumes([]);
                    setIsFetching(false);
                    return;
                }

                // Parse JSON for each entry
                const parsed = entries
                    .map((entry) => {
                        try {
                            return typeof entry.value === "string"
                                ? JSON.parse(entry.value)
                                : entry.value;
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean);

                // Eagerly load all image blobs and create object URLs
                const withImages = await Promise.all(
                    parsed.map(async (resume) => {
                        let imageUrl = null;
                        if (resume.imagePath) {
                            try {
                                const blob = await fs.read(resume.imagePath);
                                if (blob) {
                                    imageUrl = URL.createObjectURL(
                                        new Blob([blob], { type: "image/png" })
                                    );
                                }
                            } catch {
                                // image unavailable — use null
                            }
                        }
                        return { ...resume, imagePath: imageUrl };
                    })
                );

                setResumes(withImages);
            } catch (err) {
                console.error("Failed to fetch resumes:", err);
                setResumes([]);
            } finally {
                setIsFetching(false);
            }
        };

        fetchResumes();

        // Revoke object URLs on unmount to avoid memory leaks
        return () => {
            resumes.forEach((r) => {
                if (r.imagePath && r.imagePath.startsWith("blob:")) {
                    URL.revokeObjectURL(r.imagePath);
                }
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth.isAuthenticated]);

    const filteredResumes = resumes.filter((resume) => {
        const matchesSearch =
            resume.companyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            resume.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch) return false;

        const score = resume.feedback?.overallScore ?? 0;
        if (selectedFilter === "high") return score >= 75;
        if (selectedFilter === "medium") return score >= 50 && score < 75;
        if (selectedFilter === "low") return score < 50;

        return true;
    });

    return (
        <main className="min-h-screen bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 flex flex-col pt-6 pb-16">
            <Navbar />

            {/* Header Section */}
            <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">

                {/* Dashboard Controls Bar */}
                <div className="bg-white/80 backdrop-blur-md rounded-3xl p-6 shadow-sm border border-gray-100 mb-8 flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Submitted Applications</h3>
                        <p className="text-xs text-gray-500">
                            {isFetching
                                ? "Loading your resumes..."
                                : `Showing ${filteredResumes.length} of ${resumes.length} total entries`}
                        </p>
                    </div>

                    {/* Search & Filter */}
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        {/* Search Input */}
                        <div className="relative flex-1 md:w-64">
                            <svg
                                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search company or title..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-gray-50/80 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            />
                        </div>

                        {/* Filter pills */}
                        <div className="flex items-center bg-gray-100/80 p-1 rounded-full text-xs font-medium">
                            <button
                                onClick={() => setSelectedFilter("all")}
                                className={`px-3 py-1.5 rounded-full transition-all ${selectedFilter === "all"
                                    ? "bg-white text-indigo-600 shadow-sm font-semibold"
                                    : "text-gray-600 hover:text-gray-900"
                                    }`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setSelectedFilter("high")}
                                className={`px-3 py-1.5 rounded-full transition-all ${selectedFilter === "high"
                                    ? "bg-white text-indigo-600 shadow-sm font-semibold"
                                    : "text-gray-600 hover:text-gray-900"
                                    }`}
                            >
                                High (75+)
                            </button>
                            <button
                                onClick={() => setSelectedFilter("medium")}
                                className={`px-3 py-1.5 rounded-full transition-all ${selectedFilter === "medium"
                                    ? "bg-white text-indigo-600 shadow-sm font-semibold"
                                    : "text-gray-600 hover:text-gray-900"
                                    }`}
                            >
                                Medium (50-74)
                            </button>
                            <button
                                onClick={() => setSelectedFilter("low")}
                                className={`px-3 py-1.5 rounded-full transition-all ${selectedFilter === "low"
                                    ? "bg-white text-indigo-600 shadow-sm font-semibold"
                                    : "text-gray-600 hover:text-gray-900"
                                    }`}
                            >
                                Low (&lt;50)
                            </button>
                        </div>
                    </div>
                </div>

                {/* Resume Cards Grid */}
                {isFetching ? (
                    /* Loading Skeleton */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="bg-white/70 backdrop-blur-md rounded-3xl p-5 border border-gray-100 shadow-sm animate-pulse"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex flex-col gap-2">
                                        <div className="h-4 w-24 bg-gray-200 rounded-full" />
                                        <div className="h-5 w-40 bg-gray-300 rounded-full" />
                                    </div>
                                    <div className="w-14 h-14 rounded-full bg-gray-200" />
                                </div>
                                <div className="w-full h-[280px] rounded-2xl bg-gray-200 mb-4" />
                                <div className="h-4 w-full bg-gray-100 rounded-full" />
                            </div>
                        ))}
                    </div>
                ) : filteredResumes.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
                        {filteredResumes.map((resume) => (
                            <ResumeCard key={resume.id} resume={resume} />
                        ))}
                    </div>
                ) : (
                    <div className="bg-white/80 backdrop-blur-md rounded-3xl p-12 text-center border border-gray-100 shadow-sm flex flex-col items-center justify-center max-w-md mx-auto">
                        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500 mb-4">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <h4 className="text-lg font-bold text-gray-900 mb-1">No Resumes Found</h4>
                        <p className="text-sm text-gray-500 mb-6">
                            {searchQuery || selectedFilter !== "all"
                                ? "No resumes match your current search or score filter."
                                : "You haven't uploaded any resumes yet."}
                        </p>
                        {searchQuery || selectedFilter !== "all" ? (
                            <button
                                onClick={() => {
                                    setSearchQuery("");
                                    setSelectedFilter("all");
                                }}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-full transition-colors"
                            >
                                Clear Filters
                            </button>
                        ) : (
                            <Link
                                href="/upload"
                                className="primary-button px-6 py-2.5 rounded-full text-sm font-semibold shadow-md"
                            >
                                Upload First Resume
                            </Link>
                        )}
                    </div>
                )}

                {/* Wipe Data Button — only shown when there is data */}
                {!isFetching && resumes.length > 0 && (
                    <div className="flex justify-center mt-12">
                        <button
                            id="wipe-data-btn"
                            onClick={async () => {
                                const confirmed = window.confirm(
                                    `Are you sure you want to delete all ${resumes.length} resume(s)? This cannot be undone.`
                                );
                                if (!confirmed) return;

                                setIsWiping(true);
                                try {
                                    // flush() wipes all KV entries for this app
                                    // (safe — all KV data are resume:* entries)
                                    await kv.flush();
                                    // Revoke object URLs to free memory
                                    resumes.forEach((r) => {
                                        if (r.imagePath?.startsWith("blob:")) {
                                            URL.revokeObjectURL(r.imagePath);
                                        }
                                    });
                                    setResumes([]);
                                } catch (err) {
                                    console.error("Failed to wipe data:", err);
                                    alert("Something went wrong while wiping data. Please try again.");
                                } finally {
                                    setIsWiping(false);
                                }
                            }}
                            disabled={isWiping}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold border-2 border-red-300 text-red-500 bg-white/70 hover:bg-red-50 hover:border-red-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
                        >
                            {isWiping ? (
                                <>
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                    </svg>
                                    Wiping...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Wipe Data
                                </>
                            )}
                        </button>
                    </div>
                )}
            </section>
        </main>
    );
}

export default function ResumeHistoryPage() {
    return (
        <ProtectedRoute>
            <ResumeHistory />
        </ProtectedRoute>
    );
}

