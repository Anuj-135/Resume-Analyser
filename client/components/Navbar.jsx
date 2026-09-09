"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePuterStore } from "@/lib/puter";

const Navbar = () => {
    const router = useRouter();
    const { auth } = usePuterStore();

    const handleLogout = async () => {
        await auth.signOut();
        router.push("/auth");
    };

    return (
        <nav className="navbar">
            <Link href="/">
                <p className="text-xl font-bold text-gradient tracking-wide">RESUMEIT</p>
            </Link>
            <button
                id="logout-btn"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 primary-button w-fit text-xs sm:text-sm font-semibold px-4 py-1.5 shadow-sm"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" />
                </svg>
                Log Out
            </button>
        </nav>
    );
};

export default Navbar;