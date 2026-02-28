import React, { useState } from 'react';
import { auth, googleProvider } from '../firebase';
import { signInWithRedirect } from 'firebase/auth';

const Login = () => {
    const [isLoading, setIsLoading] = useState(false);

    const handleGoogleSignIn = async () => {
        try {
            setIsLoading(true);
            await signInWithRedirect(auth, googleProvider);
        } catch (error) {
            console.error("Login failed", error);
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white px-4">
            <img src="/logo.png" alt="HustleForMuscle" className="w-64 sm:w-80 md:w-96 h-auto object-contain mb-4" />
            <p className="text-gray-400 mt-2">Train Smarter. Push Harder.</p>
            <p className="text-gray-400 text-sm sm:text-base mb-8 text-center max-w-md">
                Track your pushups with AI-powered precision
            </p>
            <button
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="px-6 py-3 sm:px-8 sm:py-4 bg-white text-gray-900 rounded-lg font-bold flex items-center gap-3 hover:bg-gray-100 transition-all shadow-lg text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isLoading ? (
                    <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                ) : (
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 sm:w-6 sm:h-6" />
                )}
                {isLoading ? 'Redirecting to Google...' : 'Sign in with Google'}
            </button>
        </div>
    );
};

export default Login;
