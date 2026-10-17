"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import FileUploader from "@/components/FileUploader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useResumeStore } from "@/lib/store";

const Upload = () => {
    const router = useRouter();
    const {
        analyzeResume,
        analyzeExistingResume,
        pendingResumeId,
        rateLimitInfo,
        isAnalyzingResume,
        loading,
        statusText,
        error,
        clearError,
        clearPendingResume,
        resetStatus,
    } = useResumeStore();

    const [companyName, setCompanyName] = useState("");
    const [jobTitle, setJobTitle] = useState("");
    const [jobDescription, setJobDescription] = useState("");
    const [file, setFile] = useState(null);
    const [localError, setLocalError] = useState("");

    const isBusy = loading || isAnalyzingResume;

    useEffect(() => {
        clearError();
        return () => {
            resetStatus();
        };
    }, [clearError, resetStatus]);

    const handleFileSelect = (selectedFile) => {
        setFile(selectedFile);
        if (selectedFile) {
            setLocalError("");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isBusy) return;

        setLocalError("");
        clearError();

        // Client-side validations
        if (!file) {
            setLocalError("Please upload a resume PDF file.");
            return;
        }

        const isPdf =
            file.type === "application/pdf" ||
            file.name.toLowerCase().endsWith(".pdf");
        if (!isPdf) {
            setLocalError("Only PDF files are allowed.");
            return;
        }

        if (!companyName.trim()) {
            setLocalError("Company Name is required.");
            return;
        }

        if (!jobTitle.trim()) {
            setLocalError("Job Title is required.");
            return;
        }

        // Construct multipart form data strictly adhering to backend contract
        const formData = new FormData();
        formData.append("resume", file);
        formData.append("companyName", companyName.trim());
        formData.append("jobTitle", jobTitle.trim());
        if (jobDescription.trim()) {
            formData.append("jobDescription", jobDescription.trim());
        }

        // Execute backend upload & analyze flow
        const result = await analyzeResume(formData);

        if (result.success && result.resumeId) {
            router.push(`/resume/${result.resumeId}`);
        }
    };

    const handleRetryAnalysis = async () => {
        if (!pendingResumeId || isBusy) return;
        setLocalError("");
        clearError();

        const result = await analyzeExistingResume(pendingResumeId);
        if (result.success && result.resumeId) {
            router.push(`/resume/${result.resumeId}`);
        }
    };

    const handleDiscardPending = () => {
        clearPendingResume();
        setFile(null);
        setLocalError("");
    };

    const displayError = localError || error;

    return (
        <main className="bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 bg-cover">
            <Navbar />

            <section className="main-section">
                <div className="page-heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {isBusy ? (
                        <>
                            <h2>{statusText || "Analyzing resume..."}</h2>
                            <img
                                src="/images/resume-scan.gif"
                                className="w-full"
                                alt="Analyzing resume"
                            />
                        </>
                    ) : (
                        <h2>
                            {statusText ||
                                (pendingResumeId
                                    ? "Your resume is saved. Ready to run analysis."
                                    : "Drop your resume for an ATS score and improvement tips")}
                        </h2>
                    )}

                    {!isBusy && (
                        <>
                            {displayError && (
                                <div
                                    className={`w-full max-w-xl p-4 border text-sm rounded-xl text-center ${
                                        rateLimitInfo?.isRateLimited
                                            ? "bg-amber-50 border-amber-200 text-amber-800"
                                            : "bg-red-50 border-red-200 text-red-700"
                                    }`}
                                >
                                    <p className="font-semibold">{displayError}</p>
                                    {rateLimitInfo?.isRateLimited && (
                                        <p className="text-xs text-amber-700 mt-1">
                                            Your resume file is saved securely. Click &ldquo;Retry Analysis&rdquo; when ready without re-uploading.
                                        </p>
                                    )}
                                </div>
                            )}

                            {pendingResumeId ? (
                                <div className="w-full max-w-xl bg-white/80 backdrop-blur-md border border-gray-200 rounded-2xl p-6 mt-6 flex flex-col items-center gap-4 shadow-sm">
                                    <div className="flex items-center gap-3 text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-medium w-full justify-center">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        <span>Resume document saved on server</span>
                                    </div>
                                    <p className="text-sm text-gray-600 text-center">
                                        {companyName && jobTitle
                                            ? `Resume for ${jobTitle} at ${companyName}`
                                            : "Your uploaded resume"} is ready for AI analysis.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-3 w-full justify-center mt-2">
                                        <button
                                            type="button"
                                            onClick={handleRetryAnalysis}
                                            disabled={isBusy}
                                            className="primary-button disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isBusy ? "Analyzing..." : "Retry Analysis"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDiscardPending}
                                            disabled={isBusy}
                                            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
                                        >
                                            Upload a different resume
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <form
                                    id="upload-form"
                                    onSubmit={handleSubmit}
                                    className="flex flex-col gap-4 mt-8"
                                >
                                    <div className="form-div">
                                        <label htmlFor="company-name">Company Name</label>
                                        <input
                                            type="text"
                                            name="company-name"
                                            placeholder="Company Name"
                                            id="company-name"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            disabled={isBusy}
                                            required
                                        />
                                    </div>
                                    <div className="form-div">
                                        <label htmlFor="job-title">Job Title</label>
                                        <input
                                            type="text"
                                            name="job-title"
                                            placeholder="Job Title"
                                            id="job-title"
                                            value={jobTitle}
                                            onChange={(e) => setJobTitle(e.target.value)}
                                            disabled={isBusy}
                                            required
                                        />
                                    </div>
                                    <div className="form-div">
                                        <label htmlFor="job-description">Job Description</label>
                                        <textarea
                                            rows={5}
                                            name="job-description"
                                            placeholder="Job Description"
                                            id="job-description"
                                            value={jobDescription}
                                            onChange={(e) => setJobDescription(e.target.value)}
                                            disabled={isBusy}
                                        />
                                    </div>

                                    <div className="form-div">
                                        <label htmlFor="uploader">Upload Resume</label>
                                        <FileUploader onFileSelect={handleFileSelect} />
                                    </div>

                                    <button
                                        className="primary-button disabled:opacity-50 disabled:cursor-not-allowed"
                                        type="submit"
                                        disabled={isBusy}
                                    >
                                        {isBusy ? "Analyzing..." : "Analyze Resume"}
                                    </button>
                                </form>
                            )}
                        </>
                    )}
                </div>
            </section>
        </main>
    );
};

export default function UploadPage() {
    return (
        <ProtectedRoute>
            <Upload />
        </ProtectedRoute>
    );
}

