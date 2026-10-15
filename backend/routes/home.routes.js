const express = require("express");
const router = express.Router();
const { optionalUser } = require("../middleware/auth.middleware");
const homeController = require("../controllers/home.controller");

// Batched Home endpoint for India/Asia low latency — reduces 6+ round trips to 1
router.get("/", optionalUser, homeController.getHome);

module.exports = router;
