/**
 * Quiz & Question Validation (Part 4, Phase 1 — spec §26).
 * Malformed quizzes can NEVER become live: every create/update of a
 * question runs through here, and activities are validated before they can
 * be marked READY/LIVE (the realtime engine re-checks before starting).
 */

const QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "SINGLE_CHOICE",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "LONG_ANSWER",
];

const CHOICE_TYPES = ["MULTIPLE_CHOICE", "SINGLE_CHOICE"];
const SUBJECTIVE_TYPES = ["SHORT_ANSWER", "LONG_ANSWER"];

/** Validate a single question payload (plain object). Returns errors[]. */
function validateQuestion(q) {
  const errors = [];
  const question = q || {};

  if (!QUESTION_TYPES.includes(question.type)) {
    errors.push("Question type is invalid.");
    return errors; // nothing else can be checked meaningfully
  }
  if (!question.text || !String(question.text).trim()) {
    errors.push("Question text is required.");
  }
  if (question.media && question.media.url && typeof question.media.url !== "string") {
    errors.push("Question media URL must be a string.");
  }
  if (!Number.isFinite(Number(question.points)) || question.points < 1 || question.points > 10000) {
    errors.push("Points must be between 1 and 10000.");
  }
  if (!Number.isFinite(Number(question.timeLimit)) || question.timeLimit < 5 || question.timeLimit > 600) {
    errors.push("Time limit must be between 5 and 600 seconds.");
  }

  if (question.type === "TRUE_FALSE") {
    // Options are normalized to ["True", "False"]; correctAnswer must be 0 or 1
    if (question.correctAnswer !== 0 && question.correctAnswer !== 1) {
      errors.push("True/False questions need a correct answer (True or False).");
    }
    return errors;
  }

  if (CHOICE_TYPES.includes(question.type)) {
    const options = Array.isArray(question.options) ? question.options.map((o) => String(o).trim()) : [];
    if (options.length < 2 || options.length > 8) {
      errors.push("Choice questions need between 2 and 8 options.");
    } else if (new Set(options).size !== options.length) {
      errors.push("Options must be unique.");
    }
    const idx = Number(question.correctAnswer);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
      errors.push("Mark one correct option.");
    }
    return errors;
  }

  if (question.type === "MULTI_SELECT") {
    const options = Array.isArray(question.options) ? question.options.map((o) => String(o).trim()) : [];
    if (options.length < 2 || options.length > 8) {
      errors.push("Multi-select questions need between 2 and 8 options.");
    } else if (new Set(options).size !== options.length) {
      errors.push("Options must be unique.");
    }
    const correct = Array.isArray(question.correctAnswer) ? question.correctAnswer : null;
    if (!correct || !correct.length) {
      errors.push("Mark at least one correct option.");
    } else {
      const allValid = correct.every((i) => Number.isInteger(Number(i)) && Number(i) >= 0 && Number(i) < options.length);
      const allUnique = new Set(correct.map(Number)).size === correct.length;
      if (!allValid || !allUnique) errors.push("Correct options are invalid.");
    }
    return errors;
  }

  if (SUBJECTIVE_TYPES.includes(question.type)) {
    // correctAnswer (model answer) is optional; grading is pending review
    if (question.options && question.options.length) {
      errors.push("Subjective questions cannot have options.");
    }
    return errors;
  }

  return errors;
}

/** Normalize a question payload into its persisted shape. Throws on invalid. */
function normalizeQuestion(payload) {
  const errors = validateQuestion(payload);
  if (errors.length) {
    const err = new Error(errors[0]);
    err.validationErrors = errors;
    throw err;
  }
  const q = payload;
  if (q.type === "TRUE_FALSE") {
    q.options = ["True", "False"];
  } else if (CHOICE_TYPES.includes(q.type) || q.type === "MULTI_SELECT") {
    q.options = (q.options || []).map((o) => String(o).trim());
    if (q.type === "MULTI_SELECT") {
      q.correctAnswer = (q.correctAnswer || []).map((i) => Number(i));
    } else {
      q.correctAnswer = Number(q.correctAnswer);
    }
  } else {
    // Subjective: clear options (an empty array, never deleted, so updates
    // that switch type from MCQ don't leave stale options behind)
    q.options = [];
    q.correctAnswer = q.correctAnswer ? String(q.correctAnswer).slice(0, 1000) : "";
  }
  q.points = Number(q.points);
  q.timeLimit = Number(q.timeLimit);
  return q;
}

/**
 * Validate a whole activity (spec §26). Questions are plain objects as
 * stored/lean. Returns { valid, errors }.
 */
function validateActivity(activity, questions) {
  const errors = [];
  const acts = activity || {};
  const qs = Array.isArray(questions) ? questions : [];

  if (acts.type === "QUIZ") {
    if (!qs.length) errors.push("A quiz needs at least one question.");
    qs.forEach((q, i) => {
      validateQuestion(q).forEach((e) => errors.push(`Q${i + 1}: ${e}`));
    });
  } else if (acts.type === "POLL") {
    if (qs.length !== 1) {
      errors.push("A poll has exactly one question.");
    } else {
      const q = qs[0];
      if (!["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(q.type)) {
        errors.push("Poll question must be a choice question.");
      } else {
        const options = Array.isArray(q.options) ? q.options : [];
        if (options.length < 2 || options.length > 6) errors.push("Poll needs 2-6 options.");
      }
    }
  }
  // QA / LEADERBOARD / WELCOME / CUSTOM need no questions

  return { valid: errors.length === 0, errors };
}

module.exports = { validateQuestion, normalizeQuestion, validateActivity, QUESTION_TYPES };
