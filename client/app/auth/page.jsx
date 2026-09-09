"use client"
import { usePuterStore } from "../../lib/puter";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";


const AuthContent = () => {
    const { isLoading, auth } = usePuterStore();
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get('next') || '/';

    useEffect(() => {
        if (auth.isAuthenticated) router.push(next);
    }, [auth.isAuthenticated, next])

    return (
        <main className="bg-gradient-to-br from-pink-200 via-gray-200 to-gray-400 bg-cover min-h-screen flex items-center justify-center">
            <div className="gradient-border shadow-lg">
                <section className="flex flex-col gap-8 bg-white rounded-2xl p-10">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <h1>Welcome</h1>
                        <h2>Log In to Continue Your Job Journey</h2>
                    </div>
                    <div>
                        {isLoading ? (
                            <button className="auth-button animate-pulse">
                                <p>Signing you in...</p>
                            </button>
                        ) : (
                            <>
                                {auth.isAuthenticated ? (
                                    <button className="auth-button" onClick={auth.signOut}>
                                        <p>Log Out</p>
                                    </button>
                                ) : (
                                    <button className="auth-button" onClick={auth.signIn}>
                                        <p>Log In</p>
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </section>
            </div>
        </main>
    )
}

const Auth = () => {
    return (
        <Suspense fallback={null}>
            <AuthContent />
        </Suspense>
    )
}

export default Auth
