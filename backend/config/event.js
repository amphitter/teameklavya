"use strict";

const EVENT_APPROVAL_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "CHANGES_REQUESTED",
  "CANCELLED",
  "SUSPENDED",
]);

const EVENT_MATERIAL_FIELDS = Object.freeze([
  "title",
  "description",
  "startDate",
  "endDate",
  "venue",
  "onlineEventLink",
  "eventType",
  "category",
  "bannerUrl",
  "logoUrl",
  "maxAttendees",
  "price",
]);

function isMaterialChange(oldEvent, newData) {
  for (const field of EVENT_MATERIAL_FIELDS) {
    if (newData[field] !== undefined) {
      const oldVal = oldEvent[field];
      const newVal = newData[field];
      // Compare dates by time, strings trimmed, others strict
      if (oldVal instanceof Date && newData[field] instanceof Date) {
        if (oldVal.getTime() !== newVal.getTime()) return true;
      } else if (String(oldVal || "").trim() !== String(newVal || "").trim()) {
        // For objects like price, maxAttendees compare directly
        if (typeof oldVal !== "object" && typeof newVal !== "object") {
          if (oldVal !== newVal) return true;
        } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          return true;
        }
      }
    }
  }
  return false;
}

module.exports = {
  EVENT_APPROVAL_STATUSES,
  EVENT_MATERIAL_FIELDS,
  isMaterialChange,
};
