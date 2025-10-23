const mongoose = require("mongoose");

const fieldSchema = new mongoose.Schema({
  label: { type: String, required: true },
  type: {
    type: String,
    enum: ["text", "email", "number", "dropdown", "checkbox", "file"],
    required: true,
  },
  required: { type: Boolean, default: false },
  options: [String], // for dropdown / checkbox
  autoFillFromProfile: { type: String, enum: ["institution", "course", "year"], default: null },
});

const registrationFormSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    fields: [fieldSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RegistrationForm", registrationFormSchema);
