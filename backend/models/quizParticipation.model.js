const mongoose = require("mongoose");

/** One participant's run through a quiz. Created on first answer. */
const quizParticipationSchema = new mongoose.Schema(
  {
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    answers: {
      type: [
        {
          questionIndex: Number,
          optionIndex: Number,
          correct: Boolean,
          points: Number,
          at: Date,
        },
      ],
      default: [],
    },
    score: { type: Number, default: 0 },
    lastAnswerAt: { type: Date, default: null },
  },
  { timestamps: true }
);

quizParticipationSchema.index({ quiz: 1, user: 1 }, { unique: true });
quizParticipationSchema.index({ quiz: 1, score: -1, lastAnswerAt: 1 });

module.exports = mongoose.model("QuizParticipation", quizParticipationSchema);
