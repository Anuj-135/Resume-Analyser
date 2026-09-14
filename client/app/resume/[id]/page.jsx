"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import api from "@/lib/axios";
import { usePuterStore } from "@/lib/puter";
import Summary from "@/components/Summary";
import ATS from "@/components/ATS";
import Details from "@/components/Details";
import ProtectedRoute from "@/components/ProtectedRoute";

const Resume = () => {
    const { fs, kv } = usePuterStore();
    const { id } = useParams();
    const router = useRouter();
    const [imageUrl, setImageUrl] = useState('');
    const [resumeUrl, setResumeUrl] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        const loadResume = async () => {
            if (!id) return;
            setLoadError('');

            // 1. Prefer MongoDB backend API
            try {
                const response = await api.get(`/resumes/${id}`);
                const resumeData = response.data?.resume;

                if (resumeData) {
                    setFeedback(resumeData.feedback || null);

                    if (resumeData.resumePath) {
                        const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
                        const serverBase = apiBase.replace(/\/api\/?$/, '');
                        setResumeUrl(`${serverBase}${resumeData.resumePath}`);
                    }

                    if (resumeData.imagePath) {
                        setImageUrl(resumeData.imagePath);
                    }
                    return; // Successfully loaded from MongoDB backend
                }
            } catch (apiErr) {
                const status = apiErr.response?.status;
                const errMsg = apiErr.response?.data?.message || '';

                // Only fall back to Puter KV for a genuine "resume not found" / legacy-record case
                // (e.g. 404 Not Found, or 400 with 'Invalid resume ID format' for legacy UUIDs)
                const isLegacyOrNotFound = status === 404 || (status === 400 && errMsg.includes('Invalid resume ID format'));

                if (!isLegacyOrNotFound) {
                    // Do NOT fall back to Puter for 401, 403, 500, or network errors
                    console.error('API error fetching resume:', apiErr);
                    setLoadError(errMsg || 'Failed to load resume from server');
                    return;
                }
            }

            // 2. Puter fallback for genuine legacy records / not found on Mongo
            try {
                if (kv) {
                    const resume = await kv.get(`resume:${id}`);

                    if (!resume) {
                        setLoadError('Resume not found');
                        return;
                    }

                    const data = JSON.parse(resume);

                    if (data.resumePath && fs) {
                        const resumeBlob = await fs.read(data.resumePath);
                        if (resumeBlob) {
                            const pdfBlob = new Blob([resumeBlob], { type: 'application/pdf' });
                            const resumeUrl = URL.createObjectURL(pdfBlob);
                            setResumeUrl(resumeUrl);
                        }
                    }

                    if (data.imagePath && fs) {
                        const imageBlob = await fs.read(data.imagePath);
                        if (imageBlob) {
                            const imageUrl = URL.createObjectURL(imageBlob);
                            setImageUrl(imageUrl);
                        }
                    }

                    setFeedback(data.feedback);
                } else {
                    setLoadError('Resume not found');
                }
            } catch (puterErr) {
                console.error('Puter KV fallback error:', puterErr);
                setLoadError('Failed to load resume details');
            }
        };

        loadResume();
    }, [id, fs, kv]);

    return (
        <main className="!pt-0 bg-cover">
            <nav className="resume-nav">
                <Link href="/" className="back-button">
                    <img src="/icons/back.svg" alt="logo" className="w-2.5 h-2.5" />
                    <span className="text-gray-800 text-sm font-semibold">Back to Homepage</span>
                </Link>
            </nav>
            <div className="flex flex-row w-full max-lg:flex-col-reverse">
                <section className="feedback-section bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 bg-cover h-[100vh] sticky top-0 items-center justify-center">
                    {imageUrl && resumeUrl ? (
                        <div className="animate-in fade-in duration-1000 gradient-border max-sm:m-0 h-[90%] max-wxl:h-fit w-fit">
                            <a href={resumeUrl} target="_blank" rel="noopener noreferrer">
                                <img
                                    src={imageUrl}
                                    className="w-full h-full object-contain rounded-2xl"
                                    title="resume"
                                    alt="resume preview"
                                />
                            </a>
                        </div>
                    ) : resumeUrl ? (
                        <div className="animate-in fade-in duration-1000 gradient-border max-sm:m-0 h-fit w-fit p-8 flex flex-col items-center justify-center gap-4 bg-white/70 rounded-2xl">
                            <img src="/images/pdf.png" alt="PDF" className="w-16 h-16" />
                            <a
                                href={resumeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="primary-button text-xs sm:text-sm font-semibold px-4 py-2"
                            >
                                View Uploaded PDF
                            </a>
                        </div>
                    ) : null}
                </section>
                <section className="feedback-section">
                    <h2 className="text-4xl !text-black font-bold">Resume Review</h2>
                    {feedback ? (
                        <div className="flex flex-col gap-8 animate-in fade-in duration-1000">
                            <Summary feedback={feedback} />
                            <ATS score={feedback?.ATS?.score || feedback?.ats?.score || 0} suggestions={feedback?.ATS?.tips || feedback?.ats?.tips || []} />
                            <Details feedback={feedback} />
                        </div>
                    ) : loadError ? (
                        <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-center">
                            <h3 className="text-lg font-bold mb-2">Error Loading Resume</h3>
                            <p className="text-sm mb-4">{loadError}</p>
                            <Link href="/upload" className="primary-button text-xs font-semibold px-4 py-2">
                                Upload Resume
                            </Link>
                        </div>
                    ) : (
                        <img src="/images/resume-scan-2.gif" className="w-full" alt="scanning" />
                    )}
                </section>
            </div>
        </main>
    );
};

export default function ResumePage() {
    return (
        <ProtectedRoute>
            <Resume />
        </ProtectedRoute>
    );
}
