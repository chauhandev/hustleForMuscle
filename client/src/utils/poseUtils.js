export const findAngle = (a, b, c) => {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);

    if (angle > 180.0) {
        angle = 360 - angle;
    }
    return angle;
};

export const isPushupPosture = (landmarks) => {
    return true;
};

// Drawing Utilities
export const drawKeypoints = (keypoints, minConfidence, ctx, scale = 1) => {
    for (let i = 0; i < keypoints.length; i++) {
        const keypoint = keypoints[i];
        if (keypoint.score < minConfidence) {
            continue;
        }
        const { y, x } = keypoint;
        ctx.beginPath();
        ctx.arc(x * scale, y * scale, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'aqua';
        ctx.fill();
    }
};

export const drawSkeleton = (keypoints, minConfidence, ctx, scale = 1) => {
    const adjacentKeyPoints = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
    // MoveNet SINGLEPOSE_LIGHTNING has specific pairs. 
    // Usually we can just define pairs manually for simplicity if util fails.
    // Let's rely on manual pairs if needed, but for now try util if available or define constants.
};

const POSE_CONNECTIONS = [
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle']
];

export const drawCanvas = (pose, video, videoWidth, videoHeight, canvasRef, mirrored = true, showVisuals = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const scaleX = canvas.width / videoWidth;
    const scaleY = canvas.height / videoHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mirrored) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
    }

    if (showVisuals) {
        // Draw Keypoints
        pose.keypoints.forEach(keypoint => {
            if (keypoint.score > 0.3) {
                ctx.beginPath();
                ctx.arc(keypoint.x * scaleX, keypoint.y * scaleY, 6, 0, 2 * Math.PI);
                ctx.fillStyle = '#00FF00'; // Green
                ctx.fill();
            }
        });

        // Draw Skeleton
        POSE_CONNECTIONS.forEach(([start, end]) => {
            const startPt = pose.keypoints.find(k => k.name === start);
            const endPt = pose.keypoints.find(k => k.name === end);
            if (startPt && endPt && startPt.score > 0.3 && endPt.score > 0.3) {
                ctx.beginPath();
                ctx.moveTo(startPt.x * scaleX, startPt.y * scaleY);
                ctx.lineTo(endPt.x * scaleX, endPt.y * scaleY);
                ctx.strokeStyle = '#00FF00';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });
    }

    if (mirrored) {
        ctx.restore();
    }
};
