import { angleDeg, midpoint } from "./math.js";

export const POSE_INDEX = {
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_INDEX: 19,
  R_INDEX: 20,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT_INDEX: 31,
  R_FOOT_INDEX: 32,
};

export const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
  [27, 31],
  [28, 32],
];

export function getVisibility(point) {
  return point?.visibility ?? 1;
}

export function isVisible(point, threshold = 0.25) {
  return Boolean(point) && getVisibility(point) >= threshold;
}

export function getPoint(landmarks, index) {
  return landmarks?.[index] || null;
}

export function getSidePoints(landmarks, side) {
  const isLeft = side === "left";

  return {
    shoulder: getPoint(landmarks, isLeft ? POSE_INDEX.L_SHOULDER : POSE_INDEX.R_SHOULDER),
    elbow: getPoint(landmarks, isLeft ? POSE_INDEX.L_ELBOW : POSE_INDEX.R_ELBOW),
    wrist: getPoint(landmarks, isLeft ? POSE_INDEX.L_WRIST : POSE_INDEX.R_WRIST),
    index: getPoint(landmarks, isLeft ? POSE_INDEX.L_INDEX : POSE_INDEX.R_INDEX),
    hip: getPoint(landmarks, isLeft ? POSE_INDEX.L_HIP : POSE_INDEX.R_HIP),
    knee: getPoint(landmarks, isLeft ? POSE_INDEX.L_KNEE : POSE_INDEX.R_KNEE),
    ankle: getPoint(landmarks, isLeft ? POSE_INDEX.L_ANKLE : POSE_INDEX.R_ANKLE),
    heel: getPoint(landmarks, isLeft ? POSE_INDEX.L_HEEL : POSE_INDEX.R_HEEL),
    footIndex: getPoint(landmarks, isLeft ? POSE_INDEX.L_FOOT_INDEX : POSE_INDEX.R_FOOT_INDEX),
  };
}

export function getPixelPoint(point, width, height) {
  if (!point) return null;
  return {
    x: point.x * width,
    y: point.y * height,
    z: point.z ?? 0,
    visibility: point.visibility ?? 1,
  };
}

export function getPixelSidePoints(landmarks, side, width, height) {
  const pts = getSidePoints(landmarks, side);
  return Object.fromEntries(
    Object.entries(pts).map(([key, point]) => [key, getPixelPoint(point, width, height)])
  );
}

export function getShoulderMid(landmarks) {
  return midpoint(
    getPoint(landmarks, POSE_INDEX.L_SHOULDER),
    getPoint(landmarks, POSE_INDEX.R_SHOULDER)
  );
}

export function getHipMid(landmarks) {
  return midpoint(
    getPoint(landmarks, POSE_INDEX.L_HIP),
    getPoint(landmarks, POSE_INDEX.R_HIP)
  );
}

export function getKneeAngle(landmarks, side) {
  const { hip, knee, ankle } = getSidePoints(landmarks, side);
  return angleDeg(hip, knee, ankle);
}

export function getElbowAngle(landmarks, side) {
  const { shoulder, elbow, wrist } = getSidePoints(landmarks, side);
  return angleDeg(shoulder, elbow, wrist);
}

export function getBestFingerPoint(landmarks) {
  const candidates = [
    getPoint(landmarks, POSE_INDEX.L_INDEX),
    getPoint(landmarks, POSE_INDEX.R_INDEX),
    getPoint(landmarks, POSE_INDEX.L_WRIST),
    getPoint(landmarks, POSE_INDEX.R_WRIST),
  ].filter(Boolean);

  if (!candidates.length) return null;

  return candidates.sort((a, b) => (b.y ?? 0) - (a.y ?? 0))[0];
}

export function getToePoint(landmarks, side) {
  const pts = getSidePoints(landmarks, side);
  return pts.footIndex || pts.heel || null;
}

export function hasCorePose(landmarks, threshold = 0.25) {
  if (!landmarks || landmarks.length < 33) return false;

  const required = [
    POSE_INDEX.L_SHOULDER,
    POSE_INDEX.R_SHOULDER,
    POSE_INDEX.L_HIP,
    POSE_INDEX.R_HIP,
    POSE_INDEX.L_KNEE,
    POSE_INDEX.R_KNEE,
    POSE_INDEX.L_ANKLE,
    POSE_INDEX.R_ANKLE,
  ];

  return required.every((idx) => isVisible(landmarks[idx], threshold));
}