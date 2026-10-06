const mongoose = require("mongoose");

/**
 * Live quiz attached to an event. Organizer builds it (draft),
 * publishes it (live) and ends it — participants answer while live.
 */
const quizSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    status: { type: String, enum: ["draft", "live", "ended"], default: "draft" },
    questions: {
      type: [
        {
          text: { type: String, required: true, trim: true, maxlength: 300 },
          options: {
            type: [String],
            required: true,
            validate: { validator: (v) => v.length >= 2 && v.length <= 6, message: "2–6 options per question" },
          },
          correctIndex: { type: Number, required: true, min: 0 },
          points: { type: Number, default: 10, min: 1, max: 100 },
        },
      ],
      validate: { validator: (v) => v.length >= 1, message: "A quiz needs at least one question" },
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

quizSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model("Quiz", quizSchema);
