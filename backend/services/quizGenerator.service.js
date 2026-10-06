/**
 * QuizGeneratorService (Part 4, Phase 1 — spec §25).
 *
 * ARCHITECTURE BOUNDARY ONLY: the long-term product supports
 * "Generate a 30-question medium difficulty Python quiz." The actual AI
 * provider is integrated later — this service defines the contract and
 * validates whatever a provider returns through quizValidation, so a
 * malformed generated quiz can never become live either.
 */

const { normalizeQuestion } = require("./quizValidation.service");

const GENERATOR_INPUT = {
  topic: "string (required)",
  difficulty: "easy | medium | hard",
  questionCount: "number 1-50",
  questionTypes: "array of question types",
  language: "BCP-47 tag, default 'en'",
  additionalInstructions: "string (optional)",
};

/** Validate the generator input shape. Returns errors[]. */
function validateGeneratorInput(input) {
  const errors = [];
  const i = input || {};
  if (!i.topic || !String(i.topic).trim()) errors.push("Topic is required.");
  if (i.difficulty && !["easy", "medium", "hard"].includes(i.difficulty)) {
    errors.push("Difficulty must be easy, medium or hard.");
  }
  const count = Number(i.questionCount);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    errors.push("questionCount must be an integer between 1 and 50.");
  }
  return errors;
}

/* Registered provider — none by default (boundary only). */
let provider = null;

/** Register an AI provider: async (input) => Question[] */
function registerProvider(fn) {
  if (typeof fn !== "function") throw new Error("Provider must be a function");
  provider = fn;
}

function hasProvider() {
  return Boolean(provider);
}

/**
 * Generate questions from the registered provider.
 * Output ALWAYS passes through quizValidation — generated or not, malformed
 * questions never reach an activity.
 */
async function generateQuiz(input) {
  const errors = validateGeneratorInput(input);
  if (errors.length) {
    const err = new Error(errors[0]);
    err.code = "INVALID_INPUT";
    throw err;
  }
  if (!provider) {
    const err = new Error("No quiz generation provider is configured yet — the architecture boundary is ready.");
    err.code = "NOT_IMPLEMENTED";
    throw err;
  }
  const raw = await provider(input);
  if (!Array.isArray(raw) || !raw.length) {
    const err = new Error("Provider returned no questions.");
    err.code = "PROVIDER_EMPTY";
    throw err;
  }
  return raw.map((q) => normalizeQuestion(q));
}

module.exports = { generateQuiz, registerProvider, hasProvider, validateGeneratorInput, GENERATOR_INPUT };
