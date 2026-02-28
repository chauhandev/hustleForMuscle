import React, { useRef, useEffect, useState } from 'react';
import Webcam from 'react-webcam';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import { findAngle, drawCanvas } from '../utils/poseUtils';

const PushupTracker = ({ onCountChange, onEnd }) => {
    const webcamRef = useRef(null);
    const canvasRef = useRef(null);
    // REFS FOR DETECTION (To avoid stale closures in the loop)
    const stageRef = useRef(null);
    const countRef = useRef(0);
    const baselineEyeRef = useRef(null);
    const baselineShoulderRef = useRef(null);
    const isCalibratingRef = useRef(false);
    const calibrationStartRef = useRef(null);
    const smoothRatioRef = useRef(1.0);
    const lastCountTimeRef = useRef(0);
    const downStartTimeRef = useRef(null);
    const upStartTimeRef = useRef(null);
    const ratioBufferRef = useRef([]); // Stability window buffer
    const stageStartTimeRef = useRef(Date.now()); // For stuck recovery
    const lastBodySeenRef = useRef(Date.now()); // For 10s timeout
    const totalSessionRepsRef = useRef(0); // Master session total

    // STATE FOR UI (Sync'd with Refs)
    const [detector, setDetector] = useState(null);
    const [count, setCount] = useState(0);
    const [sets, setSets] = useState([]);
    const [stage, setStage] = useState(null);
    const [feedback, setFeedback] = useState("Loading Model...");
    const [baselineEyeDist, setBaselineEyeDist] = useState(null);
    const [baselineShoulderDist, setBaselineShoulderDist] = useState(null);
    const [calibrationProgress, setCalibrationProgress] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [duration, setDuration] = useState(0); // in ms
    const timerStartRef = useRef(null);
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [isCameraVisible, setIsCameraVisible] = useState(true);
    const [debugInfo, setDebugInfo] = useState({});
    const [showDebug, setShowDebug] = useState(false);

    // Toggle Pause/Play & Handle Sets
    const togglePause = () => {
        if (!isPaused) {
            if (countRef.current > 0) {
                setSets(prev => [...prev, countRef.current]);
                countRef.current = 0;
                setCount(0);
            }
            setIsPaused(true);
        } else {
            setIsPaused(false);
        }
    };

    const handleRecalibrate = () => {
        baselineEyeRef.current = null;
        baselineShoulderRef.current = null;
        setBaselineEyeDist(null);
        setBaselineShoulderDist(null);
        isCalibratingRef.current = false;
        setIsCalibrating(false);
        setCalibrationProgress(0);
        stageRef.current = null;
        setStage(null);

        // OPTIONAL: Resetting session total on recalibrate? 
        // User probably expects "recalibrate" to just fix the camera, but let's keep it safe.
        // We'll NOT reset totalSessionRepsRef here so their progress is saved.
        setFeedback("🔄 Resetting baseline...");
    };

    const totalReps = sets.reduce((a, b) => a + b, 0) + count;

    // Notify parent of TOTAL reps change
    // Using an effect triggered by the local count state, but reporting the master total
    useEffect(() => {
        if (onCountChange) onCountChange(totalSessionRepsRef.current);
    }, [count, sets, onCountChange]);


    // Timer Effect (millisecond precision)
    useEffect(() => {
        let timerId;
        if (!isPaused && detector) { // Start timer only when detector is ready
            const startTime = Date.now() - duration; // Preserve elapsed time across pauses
            timerStartRef.current = startTime;
            timerId = setInterval(() => {
                setDuration(Date.now() - startTime);
            }, 50);
        }
        return () => clearInterval(timerId);
    }, [isPaused, detector]);

    // Format Time (MM:SS)
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        const loadDetector = async () => {
            try {
                setFeedback("Initializing...");

                // Force WebGL backend for mobile performance
                await tf.setBackend('webgl');
                await tf.ready();

                console.log("TFJS Backend:", tf.getBackend());

                const detectorConfig = {
                    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, // Switched to Lightning for mobile stability
                    enableSmoothing: true
                };

                const detector = await poseDetection.createDetector(
                    poseDetection.SupportedModels.MoveNet,
                    detectorConfig
                );

                setDetector(detector);
                setFeedback("Ready! Place phone on floor");
                console.log("MoveNet Lightning Loaded Successfully");
            } catch (err) {
                console.error("Failed to load detector", err);
                setFeedback(`AI Error: ${err.message || 'Check Browser'}`);
                // Fallback to CPU if WebGL fails? (Usually too slow but better than total failure)
                try {
                    if (tf.getBackend() !== 'cpu') {
                        await tf.setBackend('cpu');
                        setFeedback("AI: Slow Mode (No GPU)");
                    }
                } catch (e) {
                    console.error("Fatal AI failure", e);
                }
            }
        };
        loadDetector();
    }, []);

    // Unified Detection Loop
    useEffect(() => {
        let isLooping = true;

        const loop = async () => {
            if (!isLooping) return;

            if (
                !isPaused &&
                webcamRef.current?.video?.readyState === 4 &&
                detector
            ) {
                try {
                    const video = webcamRef.current.video;
                    const poses = await detector.estimatePoses(video);

                    if (poses?.length > 0) {
                        const canvas = canvasRef.current;
                        const dpr = window.devicePixelRatio || 1;
                        const displayWidth = canvas.clientWidth;
                        const displayHeight = canvas.clientHeight;

                        if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
                            canvas.width = displayWidth * dpr;
                            canvas.height = displayHeight * dpr;
                        }

                        drawCanvas(poses[0], video, video.videoWidth, video.videoHeight, canvasRef, true, false);
                        processPose(poses[0]);
                    }
                } catch (e) {
                    console.error("Detection Loop Error:", e);
                }
            }

            // Target 20 FPS for stability
            setTimeout(() => {
                if (isLooping) requestAnimationFrame(loop);
            }, 50);
        };

        if (detector) loop();

        return () => { isLooping = false; };
    }, [detector, isPaused]); // processPose is called but it uses REFS now

    const processPose = (pose) => {
        const keypoints = pose.keypoints;
        const leftEye = keypoints.find(k => k.name === 'left_eye');
        const rightEye = keypoints.find(k => k.name === 'right_eye');
        const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
        const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
        const leftElbow = keypoints.find(k => k.name === 'left_elbow');
        const leftWrist = keypoints.find(k => k.name === 'left_wrist');
        const rightElbow = keypoints.find(k => k.name === 'right_elbow');
        const rightWrist = keypoints.find(k => k.name === 'right_wrist');

        const hasEyes = leftEye && rightEye && leftEye.score > 0.3 && rightEye.score > 0.3;
        const hasShoulders = leftShoulder && rightShoulder && leftShoulder.score > 0.3 && rightShoulder.score > 0.3;
        const hasLeftArm = leftShoulder && leftElbow && leftWrist && leftShoulder.score > 0.3 && leftElbow.score > 0.3 && leftWrist.score > 0.3;
        const hasRightArm = rightShoulder && rightElbow && rightWrist && rightShoulder.score > 0.3 && rightElbow.score > 0.3 && rightWrist.score > 0.3;

        const currentTime = Date.now();
        const hasBody = hasEyes || hasShoulders;
        if (hasBody) {
            lastBodySeenRef.current = currentTime;
        }

        const eyeDist = hasEyes ? Math.sqrt(Math.pow(rightEye.x - leftEye.x, 2) + Math.pow(rightEye.y - leftEye.y, 2)) : null;
        const shoulderDist = hasShoulders ? Math.sqrt(Math.pow(rightShoulder.x - leftShoulder.x, 2) + Math.pow(rightShoulder.y - leftShoulder.y, 2)) : null;

        // Voter B: Elbow Angles
        let leftAngle = hasLeftArm ? findAngle(leftShoulder, leftElbow, leftWrist) : null;
        let rightAngle = hasRightArm ? findAngle(rightShoulder, rightElbow, rightWrist) : null;
        const avgAngle = (leftAngle && rightAngle) ? (leftAngle + rightAngle) / 2 : (leftAngle || rightAngle);

        // 0. Auto-Recovery (If stuck in a "GOING" stage for > 3s)
        const STUCK_TIMEOUT = 3000;
        if ((stageRef.current === 'GOING_DOWN' || stageRef.current === 'GOING_UP') && (currentTime - stageStartTimeRef.current > STUCK_TIMEOUT)) {
            console.log(`[Voter V4] Stuck in ${stageRef.current} - Auto Reset to UP`);
            stageRef.current = 'UP';
            setStage('UP');
            setFeedback("Go Down");
        }

        // 1. Calibration Logic
        if (!baselineEyeRef.current && !baselineShoulderRef.current) {
            if (!hasEyes && !hasShoulders) {
                if (currentTime - lastBodySeenRef.current > 10000) {
                    setFeedback("Tracking Off");
                }
                isCalibratingRef.current = false;
                setIsCalibrating(false);
                return;
            }

            if (!isCalibratingRef.current) {
                isCalibratingRef.current = true;
                calibrationStartRef.current = currentTime;
                setIsCalibrating(true);
                setFeedback("Go Down");
                return;
            }

            const elapsed = currentTime - calibrationStartRef.current;
            const progress = Math.min((elapsed / 3000) * 100, 100);
            setCalibrationProgress(progress);

            if (elapsed >= 3000) {
                if (hasEyes) baselineEyeRef.current = eyeDist;
                if (hasShoulders) baselineShoulderRef.current = shoulderDist;

                setBaselineEyeDist(baselineEyeRef.current); // For UI
                setBaselineShoulderDist(baselineShoulderRef.current); // For UI
                isCalibratingRef.current = false;
                setIsCalibrating(false);
                stageRef.current = 'UP';
                setStage('UP');
                stageStartTimeRef.current = currentTime;
                setFeedback("Go Down");
                console.log("[Voter V4] Calibrated BSL:", baselineEyeRef.current || baselineShoulderRef.current);
            } else {
                setFeedback(`🏁 Calibrating... ${Math.ceil((3000 - elapsed) / 1000)}s`);
            }
            return;
        }

        // 2. Hybrid Signal Calculation
        let eyeRatio = (hasEyes && baselineEyeRef.current) ? (eyeDist / baselineEyeRef.current) : null;
        let shoulderRatio = (hasShoulders && baselineShoulderRef.current) ? (shoulderDist / baselineShoulderRef.current) : null;
        let currentRatioVal = eyeRatio && shoulderRatio ? (eyeRatio * 0.7 + shoulderRatio * 0.3) : (eyeRatio || shoulderRatio);

        if (!currentRatioVal && !avgAngle) {
            if (currentTime - lastBodySeenRef.current > 10000) {
                setFeedback("Tracking Off");
            }
            return;
        }

        // 3. Stability Smoothing
        const alpha = 0.5;
        const smoothed = (smoothRatioRef.current * (1 - alpha)) + (currentRatioVal * alpha);
        smoothRatioRef.current = smoothed;

        ratioBufferRef.current.push(smoothed);
        if (ratioBufferRef.current.length > 3) ratioBufferRef.current.shift();
        const avgRatio = ratioBufferRef.current.reduce((a, b) => a + b, 0) / ratioBufferRef.current.length;

        // 4. Debug Update
        if (showDebug) {
            setDebugInfo({
                ratio: avgRatio.toFixed(2),
                angle: avgAngle?.toFixed(0),
                stage: stageRef.current,
                eyes: hasEyes ? "OK" : "LOSS",
                shld: hasShoulders ? "OK" : "LOSS",
                bsl: (baselineEyeRef.current || baselineShoulderRef.current)?.toFixed(0)
            });
        }

        // 5. Voter State Machine (V4)
        const RATIO_DOWN = 1.08; // 8% growth (Hyper-Sensitive)
        const RATIO_UP = 1.05;   // 5% margin
        const ANGLE_DOWN = 135;  // Elbows bent
        const ANGLE_UP = 160;    // Arms straight
        const MIN_INTERVAL = 350;

        // Voter Logic: Either Size OR Angle confirms movement
        const isCurrentlyDown = (avgRatio > RATIO_DOWN) || (avgAngle && avgAngle < ANGLE_DOWN);
        const isCurrentlyUp = (avgRatio < RATIO_UP) || (avgAngle && avgAngle > ANGLE_UP);

        if (isCurrentlyDown) {
            if (stageRef.current === 'UP' || stageRef.current === 'GOING_UP') {
                stageRef.current = 'GOING_DOWN';
                setStage('GOING_DOWN');
                stageStartTimeRef.current = currentTime;
                setFeedback("Go Up");
                console.log("[Voter V4] -> GOING_DOWN", { ratio: avgRatio, angle: avgAngle });
            } else if (stageRef.current === 'GOING_DOWN') {
                // Confirm persistent depth (Simplified average check)
                if (avgRatio > RATIO_DOWN || (avgAngle && avgAngle < ANGLE_DOWN)) {
                    stageRef.current = 'DOWN';
                    setStage('DOWN');
                    stageStartTimeRef.current = currentTime;
                    setFeedback("Go Up");
                }
            }
        } else if (isCurrentlyUp) {
            if (stageRef.current === 'DOWN') {
                if (currentTime - lastCountTimeRef.current >= MIN_INTERVAL) {
                    stageRef.current = 'GOING_UP';
                    setStage('GOING_UP');
                    stageStartTimeRef.current = currentTime;
                    setFeedback("Go Up");
                }
            } else if (stageRef.current === 'GOING_UP') {
                if (avgRatio < RATIO_UP || (avgAngle && avgAngle > ANGLE_UP)) {
                    countRef.current += 1;
                    totalSessionRepsRef.current += 1; // Increment master total
                    setCount(countRef.current);
                    stageRef.current = 'UP';
                    setStage('UP');
                    stageStartTimeRef.current = currentTime;
                    setFeedback("Good Rep");
                    lastCountTimeRef.current = currentTime;
                    console.log("[Voter V4] REP COUNTED!", countRef.current, "Global:", totalSessionRepsRef.current);
                    if (window.navigator?.vibrate) window.navigator.vibrate([50, 30]);
                }
            } else if (stageRef.current === 'GOING_DOWN') {
                stageRef.current = 'UP';
                setStage('UP');
                stageStartTimeRef.current = currentTime;
                setFeedback("Go Down");
            }
        }
    };

    const formatTimer = (ms) => {
        const totalSeconds = ms / 1000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const centiseconds = Math.floor((ms % 1000) / 10);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    };

    return (
        <div className="fixed inset-0 bg-black flex flex-col z-50 overflow-hidden select-none">
            {/* Camera Background Layer */}
            <div className={`absolute inset-0 z-0 transition-opacity duration-700 ${!isCameraVisible ? 'opacity-0 scale-105 blur-2xl' : 'opacity-100 scale-100'}`}>
                <Webcam
                    ref={webcamRef}
                    muted={true}
                    mirrored={true}
                    className="absolute inset-0 w-full h-full object-cover"
                    videoConstraints={{ facingMode: "user" }}
                    onUserMedia={() => console.log("Webcam stream started")}
                    onUserMediaError={(err) => console.error("Webcam error:", err)}
                />
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full object-cover z-10 pointer-events-none"
                />
                {/* Subtle overlay to improve legibility if needed */}
                <div className="absolute inset-0 bg-black/20" />
            </div>

            {/* Privacy Mode Glow - Only visible when camera is off */}
            {!isCameraVisible && (
                <div className="absolute inset-0 z-0 flex items-center justify-center">
                    <div className="w-[80vw] h-[80vw] bg-blue-600/5 rounded-full blur-[120px] animate-pulse" />
                </div>
            )}

            {/* Status Bar / Notch Area Padding */}
            <div className="h-12 w-full shrink-0" />

            {/* Top Controls Area */}
            <div className="relative z-40 px-6 py-2 flex justify-end gap-3">
                <button
                    onClick={handleRecalibrate}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/5 active:scale-90 transition-all text-white"
                    title="Recalibrate"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button
                    onClick={() => setIsCameraVisible(!isCameraVisible)}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/5 active:scale-90 transition-all text-white"
                >
                    {isCameraVisible ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    ) : (
                        <svg className="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.523 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                    )}
                </button>
            </div>

            {/* Middle Stats Area - MATCHING MOCKUP */}
            <div className="relative z-30 flex-1 flex flex-col items-center justify-center -translate-y-8">
                <div className="flex flex-col items-center">
                    <span className="text-slate-400 font-bold tracking-[0.2em] text-sm uppercase mb-4 opacity-80">SET {sets.length + 1}</span>
                    <div className="relative">
                        {/* Glow effect matching mock */}
                        <div className="absolute inset-0 bg-white/10 blur-3xl rounded-full scale-150" />
                        <span className="relative text-[12rem] font-black text-white leading-none tracking-tighter">
                            {count}
                        </span>
                    </div>

                    {/* Feedback Text */}
                    <p className={`mt-4 text-xl font-bold transition-all duration-300 ${feedback.includes('✅') ? 'text-green-400 scale-110' : 'text-slate-300'}`}>
                        {feedback}
                    </p>
                </div>
            </div>

            {/* Bottom HUD Area - MATCHING MOCKUP */}
            <div className="relative z-40 px-6 pb-12 flex flex-col gap-6 items-center">

                {/* Calibration / Privacy Label */}
                {!isCameraVisible && (
                    <div className="py-2 px-4 rounded-full bg-blue-500/10 border border-blue-500/20 mb-2">
                        <p className="text-xs font-bold text-blue-400 uppercase tracking-widest text-center">Privacy Active • Tracking ON</p>
                    </div>
                )}

                {/* Calibration Bar (only when calibrating) */}
                {isCalibrating && (
                    <div className="w-full max-w-[200px] bg-white/5 h-1 rounded-full overflow-hidden mb-2">
                        <div
                            className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,1)] transition-all duration-300"
                            style={{ width: `${calibrationProgress}%` }}
                        />
                    </div>
                )}

                {/* Row 1: Stage & Total */}
                <div className="flex gap-4 w-full justify-center items-center">
                    <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/5 shadow-xl">
                        <div className={`w-3 h-3 rounded-full animate-pulse ${stage === 'DOWN' ? 'bg-blue-400' : 'bg-green-400'}`} />
                    </div>

                    <div className="h-16 px-8 rounded-[2rem] bg-white/10 backdrop-blur-md border border-white/5 flex items-center justify-center gap-3 shadow-xl">
                        <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Total</span>
                        <span className="text-2xl font-black text-white">{totalSessionRepsRef.current}</span>
                    </div>
                </div>

                {/* Row 2: Timer, Pause, Exit */}
                <div className="flex gap-4 w-full justify-center items-stretch">
                    <div className="flex-1 h-20 rounded-[2.5rem] bg-white/10 backdrop-blur-md border border-white/5 flex items-center justify-center gap-3 px-6 shadow-xl">
                        <svg className="w-6 h-6 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-2xl font-mono font-bold text-white tracking-tight">{formatTimer(duration)}</span>
                    </div>

                    <button
                        onClick={togglePause}
                        className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-90 ${isPaused ? 'bg-blue-600' : 'bg-white/10 backdrop-blur-md border border-white/5 text-white'}`}
                    >
                        {isPaused ? (
                            <svg className="w-8 h-8 text-white fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        ) : (
                            <svg className="w-8 h-8 text-white fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                        )}
                    </button>

                    <button
                        onClick={onEnd}
                        className="w-20 h-20 rounded-full bg-red-500 flex items-center justify-center shadow-xl shadow-red-900/20 active:scale-90 transition-all"
                    >
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>

            {/* Debug Overlay Secret Trigger (Top Left) */}
            <div
                className="absolute top-0 left-0 w-24 h-24 z-50 opacity-0"
                onDoubleClick={() => setShowDebug(!showDebug)}
            />

            {/* Debug Stats (Fixed to corner) */}
            {showDebug && (
                <div className="absolute top-24 left-6 z-50 bg-black/80 p-2 rounded text-[10px] text-green-400 font-mono border border-green-900 pointer-events-none">
                    <p>DPR: {window.devicePixelRatio}</p>
                    <p>RES: {debugInfo.resolution}</p>
                    <p>EYE: {debugInfo.eyeScore}</p>
                    <p>SHD: {debugInfo.shld}</p>
                    <p>ANG: {debugInfo.angle}</p>
                    <p>BSL: {debugInfo.bsl}</p>
                    <p className="text-white font-bold">RATIO: {debugInfo.ratio}</p>
                </div>
            )}
        </div>
    );
};

export default PushupTracker;
