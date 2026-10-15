const Follow = require("../models/follow.model");
const User = require("../models/user.model");
const Block = require("../models/block.model");
const { notify } = require("../services/notification.service");
const { isBlockedBetween, severFollows } = require("../services/social.service");
const { PostRepository } = require("../repositories");
const mongoose = require("mongoose");
const { ERROR_CODES } = require("../utils/app-error");

const USER_LIST_FIELDS = "firstName lastName username verified profile.avatar profile.institution";

const LIST_PAGE_SIZE = 20;

exports.toggleFollow = async (req, res) => {
  try {
    const followerId = req.user.id;
    const followeeId = req.params.userId;

    if (String(followerId) === String(followeeId)) {
      return res.status(400).json({ success: false, message: "You can't follow yourself" });
    }
    if (await isBlockedBetween(followerId, followeeId)) {
      return res.status(403).json({ success: false, message: "You can't follow this user" });
    }

    const target = await User.findById(followeeId).select("_id socialSettings");
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    const existing = await Follow.findOne({ follower: followerId, followee: followeeId });
    if (existing) {
      const wasPending = existing.status === "pending";
      await existing.deleteOne();
      PostRepository.invalidateFeedContext(followerId);
      return res.json({ success: true, following: false, requested: false, wasPending });
    }

    const isPrivate = target.socialSettings?.profileVisibility === "private";
    const status = isPrivate ? "pending" : "accepted";
    await Follow.create({ follower: followerId, followee: followeeId, status });
    PostRepository.invalidateFeedContext(followerId);

    if (status === "pending") {
      await notify({ user: followeeId, actor: followerId, type: "follow_request" });
    } else {
      await notify({ user: followeeId, actor: followerId, type: "follow" });
    }

    res.json({ success: true, following: status === "accepted", requested: status === "pending" });
  } catch (error) {
    console.error("Toggle follow error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update follow" });
  }
};

exports.getFollowStatus = async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid identifier",
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: "Invalid identifier" },
      });
    }
    let following = false;
    let requested = false;
    if (req.user && String(req.user.id) !== String(targetId)) {
      const doc = await Follow.findOne({ follower: req.user.id, followee: targetId }).lean();
      following = doc?.status === "accepted";
      requested = doc?.status === "pending";
    }
    const followers = await Follow.countDocuments({ followee: targetId, status: "accepted" });
    const target = await User.findById(targetId).select("socialSettings").lean();
    res.json({
      success: true,
      following,
      requested,
      followers,
      isPrivate: target?.socialSettings?.profileVisibility === "private",
    });
  } catch (error) {
    if (typeof next === "function") return next(error);
    res.status(500).json({ success: false, message: "Failed to load follow status" });
  }
};

exports.getFollowers = async (req, res) => {
  try {
    const targetId = req.params.userId;
    const target = await User.findById(targetId).select("_id socialSettings");
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    const viewerId = req.user?.id || null;
    const isSelf = viewerId && String(viewerId) === String(targetId);
    if (!isSelf && target.socialSettings?.profileVisibility === "private") {
      const follows = viewerId ? await Follow.exists({ follower: viewerId, followee: targetId, status: "accepted" }) : null;
      if (!follows) {
        return res.status(403).json({ success: false, message: "This account is private", canView: false });
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const [edges, total] = await Promise.all([
      Follow.find({ followee: targetId, status: "accepted" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * LIST_PAGE_SIZE)
        .limit(LIST_PAGE_SIZE)
        .populate("follower", USER_LIST_FIELDS)
        .lean(),
      Follow.countDocuments({ followee: targetId, status: "accepted" }),
    ]);

    res.json({
      success: true,
      users: edges.map((e) => e.follower).filter(Boolean),
      page,
      hasMore: page * LIST_PAGE_SIZE < total,
    });
  } catch (error) {
    console.error("Followers list error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load followers" });
  }
};

exports.getFollowing = async (req, res) => {
  try {
    const targetId = req.params.userId;
    const target = await User.findById(targetId).select("_id socialSettings");
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    const viewerId = req.user?.id || null;
    const isSelf = viewerId && String(viewerId) === String(targetId);
    if (!isSelf && target.socialSettings?.profileVisibility === "private") {
      const follows = viewerId ? await Follow.exists({ follower: viewerId, followee: targetId, status: "accepted" }) : null;
      if (!follows) {
        return res.status(403).json({ success: false, message: "This account is private", canView: false });
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const [edges, total] = await Promise.all([
      Follow.find({ follower: targetId, status: "accepted" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * LIST_PAGE_SIZE)
        .limit(LIST_PAGE_SIZE)
        .populate("followee", USER_LIST_FIELDS)
        .lean(),
      Follow.countDocuments({ follower: targetId, status: "accepted" }),
    ]);

    res.json({
      success: true,
      users: edges.map((e) => e.followee).filter(Boolean),
      page,
      hasMore: page * LIST_PAGE_SIZE < total,
    });
  } catch (error) {
    console.error("Following list error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load following" });
  }
};

exports.getRequests = async (req, res) => {
  try {
    const edges = await Follow.find({ followee: req.user.id, status: "pending" })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("follower", USER_LIST_FIELDS)
      .lean();
    res.json({ success: true, requests: edges.map((e) => e.follower).filter(Boolean) });
  } catch (error) {
    console.error("Follow requests error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load requests" });
  }
};

exports.acceptRequest = async (req, res) => {
  try {
    const requesterId = req.params.userId;
    const edge = await Follow.findOne({ follower: requesterId, followee: req.user.id, status: "pending" });
    if (!edge) return res.status(404).json({ success: false, message: "No pending request from this user" });
    edge.status = "accepted";
    await edge.save();
    PostRepository.invalidateFeedContext(requesterId);
    await notify({ user: requesterId, actor: req.user.id, type: "follow_accepted" });
    require("../services/achievement.service").checkAchievements(req.user.id);
    res.json({ success: true, following: true });
  } catch (error) {
    console.error("Accept request error:", error.message);
    res.status(500).json({ success: false, message: "Failed to accept request" });
  }
};

exports.declineRequest = async (req, res) => {
  try {
    const requesterId = req.params.userId;
    const edge = await Follow.findOne({
      follower: requesterId,
      followee: req.user.id,
      status: "pending",
    });
    if (!edge) return res.status(404).json({ success: false, message: "No pending request from this user" });
    await edge.deleteOne();
    PostRepository.invalidateFeedContext(requesterId);
    res.json({ success: true, following: false });
  } catch (error) {
    console.error("Decline request error:", error.message);
    res.status(500).json({ success: false, message: "Failed to decline request" });
  }
};
