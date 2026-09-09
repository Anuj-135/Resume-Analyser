"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from "../../components/Navbar";
import FileUploader from "../../components/FileUploader";
import { usePuterStore } from "../../lib/puter";
import { convertPdfToImage } from "../../lib/pdf2img";
import { generateUUID } from "../../lib/utils";
import { prepareInstructions } from "../../constants";

const Upload = () => {
    const router = useRouter();
    const { auth, isLoading, fs, ai, kv } = usePuterStore();
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [file, setFile] = useState(null);

    const handleFileSelect = (file) => {
        setFile(file)
    }

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }) => {
        setIsProcessing(true);

        try {
            setStatusText('Uploading the file...');
            const uploadedFile = await fs.upload([file]);
            if (!uploadedFile) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to upload file');
            }

            // Puter fs.upload may return an array of FSItem or a single FSItem
            const resumePath = Array.isArray(uploadedFile) ? uploadedFile[0]?.path : uploadedFile?.path;

            setStatusText('Converting to image...');
            const imageFile = await convertPdfToImage(file);
            if (!imageFile.file) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to convert PDF to image');
            }

            setStatusText('Uploading the image...');
            const uploadedImage = await fs.upload([imageFile.file]);
            if (!uploadedImage) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to upload image');
            }

            const imagePath = Array.isArray(uploadedImage) ? uploadedImage[0]?.path : uploadedImage?.path;

            setStatusText('Preparing data...');
            const uuid = generateUUID();
            const data = {
                id: uuid,
                resumePath: resumePath || '',
                imagePath: imagePath || '',
                companyName,
                jobTitle,
                jobDescription,
                feedback: '',
            }
            await kv.set(`resume:${uuid}`, JSON.stringify(data));

            setStatusText('Analyzing...');

            const feedbackResponse = await ai.feedback(
                resumePath,
                prepareInstructions({ jobTitle, jobDescription })
            );

            if (!feedbackResponse) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to analyze resume (No response from AI)');
            }

            // Extract feedback text from various possible response structures
            let feedbackText = '';
            if (typeof feedbackResponse === 'string') {
                feedbackText = feedbackResponse;
            } else if (feedbackResponse?.message?.content) {
                const content = feedbackResponse.message.content;
                if (typeof content === 'string') {
                    feedbackText = content;
                } else if (Array.isArray(content)) {
                    feedbackText = content[0]?.text || JSON.stringify(content);
                } else {
                    feedbackText = String(content);
                }
            } else if (feedbackResponse?.text) {
                feedbackText = feedbackResponse.text;
            } else {
                feedbackText = JSON.stringify(feedbackResponse);
            }

            // Clean markdown code blocks if the AI returned JSON wrapped in ```json ... ```
            let jsonString = feedbackText.trim();
            const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }

            try {
                data.feedback = JSON.parse(jsonString);
            } catch (parseError) {
                console.error("Failed to parse JSON feedback:", parseError, "Raw output:", feedbackText);
                setIsProcessing(false);
                return setStatusText('Error: Failed to parse AI feedback JSON format');
            }

            await kv.set(`resume:${uuid}`, JSON.stringify(data));
            setStatusText('Analysis complete, redirecting...');
            console.log("Analysis data saved successfully:", data);

            // Redirect to resume page
            router.push(`/resume/${uuid}`);
        } catch (error) {
            console.error("Analysis process error:", error);
            const errorMessage = error?.message || (typeof error === 'string' ? error : 'An unexpected error occurred during analysis');
            setStatusText(`Error: ${errorMessage}`);
            setIsProcessing(false);
        }
    }

    const handleSubmit = (e) => {
        e.preventDefault();
        const form = e.currentTarget.closest('form');
        if (!form) return;
        const formData = new FormData(form);

        const companyName = formData.get('company-name');
        const jobTitle = formData.get('job-title');
        const jobDescription = formData.get('job-description');

        if (!file) return;

        handleAnalyze({ companyName, jobTitle, jobDescription, file });
    }

    return (
        <main className="bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 bg-cover">
            <Navbar />

            <section className="main-section">
                <div className="page-heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {isProcessing ? (
                        <>
                            <h2>{statusText}</h2>
                            <img src="/images/resume-scan.gif" className="w-full" />
                        </>
                    ) : (
                        <h2>{statusText || "Drop your resume for an ATS score and improvement tips"}</h2>
                    )}
                    {!isProcessing && (
                        <form id="upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4 mt-8">
                            <div className="form-div">
                                <label htmlFor="company-name">Company Name</label>
                                <input type="text" name="company-name" placeholder="Company Name" id="company-name" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-title">Job Title</label>
                                <input type="text" name="job-title" placeholder="Job Title" id="job-title" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-description">Job Description</label>
                                <textarea rows={5} name="job-description" placeholder="Job Description" id="job-description" />
                            </div>

                            <div className="form-div">
                                <label htmlFor="uploader">Upload Resume</label>
                                <FileUploader onFileSelect={handleFileSelect} />
                            </div>

                            <button className="primary-button" type="submit">
                                Analyze Resume
                            </button>
                        </form>
                    )}
                </div>
            </section>
        </main>
    )
}
export default Upload
