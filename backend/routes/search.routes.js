/**
 * EventHub Search Routes (Part 3, Phase 11)
 *  GET /api/search?q=&type=   global search (public)
 */
const express = require("express");
const router = express.Router();
const { optionalUser } = require("../middleware/auth.middleware");
const searchController = require("../controllers/search.controller");

router.get("/", optionalUser, searchController.globalSearch);

module.exports = router;
