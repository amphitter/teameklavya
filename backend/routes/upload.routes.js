const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const router = express.Router();
const upload = multer({ dest: "temp/" });

// ✅ Upload event-specific image to ImgBB
router.post("/:eventId", upload.single("file"), async (req, res) => {
  const { eventId } = req.params;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const formData = new FormData();
    formData.append("image", fs.createReadStream(filePath));

    // 🔐 Use key from .env
    const apiKey = process.env.IMGBB_API_KEY;

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${apiKey}`,
      formData,
      { headers: formData.getHeaders() }
    );

    // Delete temp file
    fs.unlinkSync(filePath);

    const uploadedUrl = response.data.data.url;

    // ✅ You can now save this URL in your event model (if you want)
    // Example (pseudo-code):
    // await Event.findByIdAndUpdate(eventId, { imageUrl: uploadedUrl });

    res.json({
      success: true,
      eventId,
      imageUrl: uploadedUrl,
      deleteUrl: response.data.data.delete_url,
    });
  } catch (error) {
    console.error("ImgBB upload error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to upload image",
    });
  }
});

module.exports = router;
