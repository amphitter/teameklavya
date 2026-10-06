const mongoose = require("mongoose");

/**
 * Activity Question (Part 4, Phase 1).
 *
 * SECURITY-CRITICAL: `correctAnswer` uses `select: false` — Mongoose will
 * NEVER include it in query results unless the server explicitly asks with
 * `.select("+correctAnswer")`. Every participant-facing code path is safe
 * by default; the answer key cannot leak (spec §21).
 *
 * Subjective answers (SHORT_ANSWER / LONG_ANSWER) are stored and marked
 * `pending_review` at scoring time — no AI grading yet (spec §20).
 */
const questionSchema = new mongoose.Schema(
  {
    activity: { type: mongoose.Schema.Types.ObjectId, ref: "Activity", required: true, index: true },
    type: {
      type: String,
      enum: [
        "MULTIPLE_CHOICE", // one correct option (classic MCQ)
        "SINGLE_CHOICE", // one correct option
        "MULTI_SELECT", // several correct options
        "TRUE_FALSE", // options enforced to ["True", "False"]
        "SHORT_ANSWER", // subjective — pending review
        "LONG_ANSWER", // subjective — pending review
      ],
      default: "SINGLE_CHOICE",
      required: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    media: {
      url: { type: String, default: "" }, // Cloudinary, optimized
      alt: { type: String, default: "", maxlength: 200 },
    },
    options: { type: [String], default: [] },
    // NEVER exposed to participants (select: false). Index (MC/SC/TF),
    // array of indices (MULTI_SELECT) or reference text (subjective).
    correctAnswer: { type: mongoose.Schema.Types.Mixed, select: false },
    // min 0: poll questions don't score; quiz questions are enforced 1-10000 by the validation service
    points: { type: Number, default: 100, min: 0, max: 10000 },
    timeLimit: { type: Number, default: 30, min: 5, max: 600 }, // seconds
    order: { type: Number, default: 0 },
    explanation: { type: String, default: "", maxlength: 1000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

questionSchema.index({ activity: 1, order: 1 });

module.exports = mongoose.model("Question", questionSchema);
