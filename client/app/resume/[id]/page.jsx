"use client"
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePuterStore } from "@/lib/puter";
import Summary from "@/components/Summary";
import ATS from "../../../components/ATS";
import Details from "@/components/Details";
import ProtectedRoute from "@/components/ProtectedRoute";

const Resume = () => {
    const { fs, kv } = usePuterStore();
    const { id } = useParams();
    const router = useRouter();
    const [imageUrl, setImageUrl] = useState('');
    const [resumeUrl, setResumeUrl] = useState('');
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        const loadResume = async () => {
            if (!id) return;
            const resume = await kv.get(`resume:${id}`);

            if (!resume) return;

            const data = JSON.parse(resume);

            if (data.resumePath) {
                const resumeBlob = await fs.read(data.resumePath);
                if (resumeBlob) {
                    const pdfBlob = new Blob([resumeBlob], { type: 'application/pdf' });
                    const resumeUrl = URL.createObjectURL(pdfBlob);
                    setResumeUrl(resumeUrl);
                }
            }

            if (data.imagePath) {
                const imageBlob = await fs.read(data.imagePath);
                if (imageBlob) {
                    const imageUrl = URL.createObjectURL(imageBlob);
                    setImageUrl(imageUrl);
                }
            }

            setFeedback(data.feedback);
            console.log({ data });
        }

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
                    {imageUrl && resumeUrl && (
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
                    )}
                </section>
                <section className="feedback-section">
                    <h2 className="text-4xl !text-black font-bold">Resume Review</h2>
                    {feedback ? (
                        <div className="flex flex-col gap-8 animate-in fade-in duration-1000">
                            <Summary feedback={feedback} />
                            <ATS score={feedback?.ATS?.score || feedback?.ats?.score || 0} suggestions={feedback?.ATS?.tips || feedback?.ats?.tips || []} />
                            <Details feedback={feedback} />
                        </div>
                    ) : (
                        <img src="/images/resume-scan-2.gif" className="w-full" alt="scanning" />
                    )}
                </section>
            </div>
        </main>
    )
}

export default function ResumePage() {
    return (
        <ProtectedRoute>
            <Resume />
        </ProtectedRoute>
    );
}