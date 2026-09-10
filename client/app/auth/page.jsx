"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AuthRedirect() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next");

    useEffect(() => {
        const query = next ? `?next=${encodeURIComponent(next)}` : "";
        router.replace(`/auth/login${query}`);
    }, [next, router]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );
}

export default function AuthPage() {
    return (
        <Suspense fallback={null}>
            <AuthRedirect />
        </Suspense>
    );
}
