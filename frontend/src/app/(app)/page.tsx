import { Suspense } from "react";
import { FeedView } from "@/components/feed/feed-view";

export default function HomePage() {
  return (
    <Suspense>
      <FeedView />
    </Suspense>
  );
}
