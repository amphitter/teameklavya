import { Suspense } from "react";
import { ExploreView } from "@/components/explore/explore-view";
import { EventCardSkeleton } from "@/components/states";

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-3 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      }
    >
      <ExploreView />
    </Suspense>
  );
}
