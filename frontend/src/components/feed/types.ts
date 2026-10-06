export interface FeedUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  verified?: boolean;
  email?: string;
  profile?: { avatar?: string; institution?: string };
}

export interface FeedEventData {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  startDate: string;
  endDate: string;
  venue?: string;
  onlineEventLink?: string;
  eventType: "online" | "offline" | "hybrid";
  category?: string;
  organizer?: string;
  price?: number;
  isLive?: boolean;
}

export interface FeedOrgData {
  _id: string;
  name: string;
  slug: string;
  logoUrl?: string;
}

export interface FeedPostData {
  _id: string;
  author: FeedUser;
  content: string;
  images: string[];
  event: FeedEventData | null;
  organization?: FeedOrgData | null;
  community?: { _id?: string; name: string; slug: string; avatarUrl?: string } | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  authorFollowing?: boolean;
  /** Post typing/lifecycle (Part 3): text | image | event | achievement | event_memory | announcement */
  type?: string;
  /** public | followers | event_participants */
  visibility?: string;
  /** Structured event-memory share (Phase 9) — server-frozen stats */
  memory?: { rank?: number | null; score?: number; accuracy?: number | null; achievements?: string[] };
  /** Normalized #topics parsed server-side */
  topics?: string[];
}

export interface CommentData {
  _id: string;
  author: FeedUser;
  content: string;
  createdAt: string;
}
