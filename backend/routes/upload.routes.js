const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const router = express.Router();

// Use memory storage to get file buffer
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

const Event = require("../models/event.model");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");

router.post("/:eventId", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  const { eventId } = req.params;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    // ✅ FIX: Check if buffer exists, if not read from disk
    let imageBuffer;
    if (req.file.buffer) {
      // Memory storage - buffer is available
      imageBuffer = req.file.buffer;
    } else {
      // Disk storage - read file from disk
      imageBuffer = fs.readFileSync(req.file.path);
      // Clean up temp file
      fs.unlinkSync(req.file.path);
    }

    // Convert image buffer to base64 for ImgBB
    const base64Image = imageBuffer.toString("base64");

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

    // ✅ Update Event document
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