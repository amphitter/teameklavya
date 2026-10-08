import { Suspense } from "react";
import { FeedView } from "@/components/feed/feed-view";
import { FeedTopBar } from "@/components/feed/feed-top-bar";

/**
 * Home / news feed.
 *
 * The phone-only top bar is mounted here rather than inside `FeedView` so that
 * it is a direct child of the shell's content column: `sticky top-0` then
 * sticks to the real scroll edge for the whole route (§2), and no other route
 * inherits it. From `lg` up it renders nothing (the shell's own desktop header
 * takes over), so desktop is untouched (§26).
 */
export default function HomePage() {
  return (
    <Suspense>
      <FeedTopBar />
      <FeedView />
    </Suspense>
  );
}
