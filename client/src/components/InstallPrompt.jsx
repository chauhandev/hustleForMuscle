import React, { useState, useEffect, useRef } from 'react';

const InstallPrompt = () => {
    const [showPrompt, setShowPrompt] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const deferredPrompt = useRef(null);

    useEffect(() => {
        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            return;
        }

        // Detect iOS
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIOS(isIosDevice);

        if (isIosDevice) {
            // Show prompt on iOS if not in standalone mode
            // We can check local storage to not annoy user every time
            const hasDismissed = localStorage.getItem('installPromptDismissed');
            if (!hasDismissed) {
                // Small delay to let app load
                setTimeout(() => setShowPrompt(true), 3000);
            }
        } else {
            // Android / Desktop (Chrome)
            const handleBeforeInstallPrompt = (e) => {
                e.preventDefault();
                deferredPrompt.current = e;

                const hasDismissed = localStorage.getItem('installPromptDismissed');
                if (!hasDismissed) {
                    setShowPrompt(true);
                }
            };

            window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

            return () => {
                window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            };
        }
    }, []);

    const handleInstallClick = async () => {
        if (!isIOS && deferredPrompt.current) {
            deferredPrompt.current.prompt();
            const { outcome } = await deferredPrompt.current.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt.current = null;
            setShowPrompt(false);
        }
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        localStorage.setItem('installPromptDismissed', 'true');
    };

    if (!showPrompt) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 z-50 animate-in slide-in-from-bottom-5 duration-500">
            <div className="bg-gray-800/95 backdrop-blur-md border border-gray-700 p-4 rounded-2xl shadow-2xl flex flex-col gap-3">
                <div className="flex justify-between items-start">
                    <div className="flex gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-2xl shadow-lg">
                            🔥
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-lg">Install App</h3>
                            <p className="text-sm text-gray-400">
                                {isIOS
                                    ? "Install for the best experience!"
                                    : "Add to home screen for quick access."}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-gray-500 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {isIOS ? (
                    <div className="text-sm text-gray-300 bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                        <p className="mb-2">1. Tap the <span className="font-bold text-blue-400">Share</span> button below 👇</p>
                        <p>2. Select <span className="font-bold text-white">"Add to Home Screen"</span> ➕</p>
                    </div>
                ) : (
                    <button
                        onClick={handleInstallClick}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-blue-500/25 active:scale-95"
                    >
                        Install Now
                    </button>
                )}
            </div>
        </div>
    );
};

export default InstallPrompt;
