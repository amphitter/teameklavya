const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Ensure required directories exist
const baseUploadPath = path.join(__dirname, "..", "uploads");
const uploadDirs = ["posters", "speakers", "general"];
uploadDirs.forEach((dir) => {
  const dirPath = path.join(baseUploadPath, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Multer config - FIXED: Use query parameter instead of body for folder
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use query parameter instead of body since multer doesn't parse body yet
    const folder = req.query.folder || "general";
    const folderPath = path.join(baseUploadPath, folder);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    cb(null, folderPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ✅ POST /api/upload/local - FIXED: Use query parameter for folder
router.post("/local", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const folder = req.query.folder || "general";
    // Use relative path that matches your static serving
    const fileUrl = `/uploads/${folder}/${req.file.filename}`;

    console.log(`File uploaded to: ${fileUrl}`); // Debug log

    return res.json({ 
      success: true, 
      filePath: fileUrl,
      message: "File uploaded successfully"
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;