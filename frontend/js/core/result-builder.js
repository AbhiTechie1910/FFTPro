import { nowIso } from "../utils/math.js";

function safeNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function safeBoolean(value) {
  return Boolean(value);
}

function safeString(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function createBaseResult({
  patientId,
  testName,
  testDate = nowIso(),
  attemptNumber = 1,
  assessedSide = null,
}) {
  return {
    patient_id: patientId,
    test_name: testName,
    test_date: testDate,
    attempt_number: attemptNumber,
    assessed_side: safeString(assessedSide),

    repetitions_count: null,
    duration_seconds: null,
    distance_value: null,

    compensation_flag: false,
    balance_issue: false,
    score: null,

    warning_images: [],
    metadata: {},
  };
}

export function buildChairSitReachResult({
  patientId,
  attemptNumber,
  assessedSide,
  score,
  distanceValue,
  compensationFlag,
  balanceIssue,
  warningImages = [],
  metadata = {},
}) {
  const result = createBaseResult({
    patientId,
    testName: "chair_sit_reach",
    attemptNumber,
    assessedSide,
  });

  result.distance_value = safeNumber(distanceValue);
  result.compensation_flag = safeBoolean(compensationFlag);
  result.balance_issue = safeBoolean(balanceIssue);
  result.score = safeNumber(score);
  result.warning_images = Array.isArray(warningImages) ? warningImages : [];
  result.metadata = {
    ...metadata,
  };

  return result;
}

export function buildChairSitToStandResult({
  patientId,
  attemptNumber,
  score,
  repetitionsCount,
  durationSeconds,
  compensationFlag,
  balanceIssue,
  warningImages = [],
  metadata = {},
}) {
  const result = createBaseResult({
    patientId,
    testName: "chair_sit_to_stand",
    attemptNumber,
  });

  result.repetitions_count = safeNumber(repetitionsCount);
  result.duration_seconds = safeNumber(durationSeconds);
  result.compensation_flag = safeBoolean(compensationFlag);
  result.balance_issue = safeBoolean(balanceIssue);
  result.score = safeNumber(score);
  result.warning_images = Array.isArray(warningImages) ? warningImages : [];
  result.metadata = {
    ...metadata,
  };

  return result;
}

export function buildSingleLegStanceResult({
  patientId,
  attemptNumber,
  assessedSide,
  score,
  durationSeconds,
  compensationFlag,
  balanceIssue,
  warningImages = [],
  metadata = {},
}) {
  const result = createBaseResult({
    patientId,
    testName: "single_leg_stance",
    attemptNumber,
    assessedSide,
  });

  result.duration_seconds = safeNumber(durationSeconds);
  result.compensation_flag = safeBoolean(compensationFlag);
  result.balance_issue = safeBoolean(balanceIssue);
  result.score = safeNumber(score);
  result.warning_images = Array.isArray(warningImages) ? warningImages : [];
  result.metadata = {
    ...metadata,
  };

  return result;
}

export function buildArmCurlResult({
  patientId,
  attemptNumber,
  assessedSide,
  score,
  repetitionsCount,
  durationSeconds,
  compensationFlag,
  balanceIssue,
  warningImages = [],
  metadata = {},
}) {
  const result = createBaseResult({
    patientId,
    testName: "arm_curl",
    attemptNumber,
    assessedSide,
  });

  result.repetitions_count = safeNumber(repetitionsCount);
  result.duration_seconds = safeNumber(durationSeconds);
  result.compensation_flag = safeBoolean(compensationFlag);
  result.balance_issue = safeBoolean(balanceIssue);
  result.score = safeNumber(score);
  result.warning_images = Array.isArray(warningImages) ? warningImages : [];
  result.metadata = {
    ...metadata,
  };

  return result;
}

export function buildBackScratchResult({
  patientId,
  attemptNumber,
  assessedSide,
  score,
  distanceValue,
  compensationFlag,
  balanceIssue,
  warningImages = [],
  metadata = {},
}) {
  const result = createBaseResult({
    patientId,
    testName: "back_scratch",
    attemptNumber,
    assessedSide,
  });

  result.distance_value = safeNumber(distanceValue);
  result.compensation_flag = safeBoolean(compensationFlag);
  result.balance_issue = safeBoolean(balanceIssue);
  result.score = safeNumber(score);
  result.warning_images = Array.isArray(warningImages) ? warningImages : [];
  result.metadata = {
    ...metadata,
  };

  return result;
}

export function buildUpAndGoResult({
  patientId,
  attemptNumber,
  score,
  durationSeconds,
  compensationFlag,
  balanceIssue,
  warningImages = [],
  metadata = {},
}) {
  const result = createBaseResult({
    patientId,
    testName: "eight_foot_up_and_go",
    attemptNumber,
  });

  result.duration_seconds = safeNumber(durationSeconds);
  result.compensation_flag = safeBoolean(compensationFlag);
  result.balance_issue = safeBoolean(balanceIssue);
  result.score = safeNumber(score);
  result.warning_images = Array.isArray(warningImages) ? warningImages : [];
  result.metadata = {
    ...metadata,
  };

  return result;
}