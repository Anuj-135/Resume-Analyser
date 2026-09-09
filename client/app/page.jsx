import Link from "next/link";
import Navbar from "../components/Navbar";

export default function Home() {
  return (
    <main className="h-screen overflow-hidden bg-[url('/images/back_img.png')] bg-cover bg-center bg-no-repeat flex flex-col p-3 sm:p-6 !pt-3">
      <Navbar />

      {/* Hero Section */}
      <section className="flex-1 flex flex-col justify-center items-center px-3 sm:px-4">
        <div className="max-w-2xl text-center space-y-3 sm:space-y-4">
          <h1>
            Track Your Applications & <span>Resume Ratings</span>
          </h1>

          <h2 className="text-xs sm:text-sm md:text-base text-gray-600 max-w-md mx-auto font-normal leading-relaxed">
            Get instant AI-powered feedback to optimize your ATS resume score.
          </h2>

          <div className="pt-2 sm:pt-4 flex flex-row items-center justify-center gap-2.5 sm:gap-4">
            <Link
              href="/upload"
              className="primary-button !w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold shadow-md hover:shadow-indigo-500/25 transition-all duration-300 transform hover:-translate-y-0.5 whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload Resume
            </Link>

            <Link
              href="/resume-history"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold bg-white/90 backdrop-blur-md text-gray-800 border border-gray-200 shadow-sm hover:bg-gray-50 transition-all duration-300 transform hover:-translate-y-0.5 whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              View History
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
