const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const router = express.Router();
const upload = multer({ dest: "temp/" });
const Event = require("../models/event.model");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
router.post("/:eventId", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  const { eventId } = req.params;
    console.log("req.file:", req.file);
  console.log("req.body:", req.body);

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    // Convert image buffer to base64 for ImgBB
    const base64Image = req.file.buffer.toString("base64");

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      throw new Error("IMGBB_API_KEY missing in environment");
    }

    const formData = new FormData();
    formData.append("image", base64Image);

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${apiKey}`,
      formData,
      { headers: formData.getHeaders() }
    );

    const uploadedUrl = response.data.data.url;
    const deleteUrl = response.data.data.delete_url;

    // ✅ Optionally update your Event document
    await Event.findByIdAndUpdate(eventId, { bannerUrl: uploadedUrl });

    res.status(200).json({
      success: true,
      eventId,
      imageUrl: uploadedUrl,
      deleteUrl,
    });
  } catch (error) {
    console.error("ImgBB upload error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to upload image",
      error: error.response?.data || error.message,
    });
  }
});

module.exports = router;
