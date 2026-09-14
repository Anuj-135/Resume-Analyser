"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import FileUploader from "@/components/FileUploader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useResumeStore } from "@/lib/store";

const Upload = () => {
    const router = useRouter();
    const { analyzeResume, loading, statusText, error, clearError, resetStatus } = useResumeStore();

    const [companyName, setCompanyName] = useState("");
    const [jobTitle, setJobTitle] = useState("");
    const [jobDescription, setJobDescription] = useState("");
    const [file, setFile] = useState(null);
    const [localError, setLocalError] = useState("");

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

    const displayError = localError || error;

    return (
        <main className="bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 bg-cover">
            <Navbar />

            <section className="main-section">
                <div className="page-heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {loading ? (
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
                                "Drop your resume for an ATS score and improvement tips"}
                        </h2>
                    )}

                    {!loading && (
                        <>
                            {displayError && (
                                <div className="w-full max-w-xl p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl text-center">
                                    {displayError}
                                </div>
                            )}

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
                                        disabled={loading}
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
                                        disabled={loading}
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
                                        disabled={loading}
                                    />
                                </div>

                                <div className="form-div">
                                    <label htmlFor="uploader">Upload Resume</label>
                                    <FileUploader onFileSelect={handleFileSelect} />
                                </div>

                                <button
                                    className="primary-button disabled:opacity-50 disabled:cursor-not-allowed"
                                    type="submit"
                                    disabled={loading}
                                >
                                    {loading ? "Analyzing..." : "Analyze Resume"}
                                </button>
                            </form>
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

