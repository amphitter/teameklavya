"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CreatePost } from "@/components/feed/create-post";
import { StoryCreator } from "@/components/stories/story-creator";
import type { FeedPostData } from "@/components/feed/types";
import { queryClient } from "@/lib/query";

/**
 * Global post composer (Part 13 §4–§8).
 *
 * The rule this exists to enforce: a user must never have to walk back to the
 * feed to post something. Before this, "+ → Create Post" did
 * `router.push("/?compose=1")` — it navigated you to the feed, dropped whatever
 * you were doing, and only then opened a composer. From an open conversation
 * that also meant leaving the conversation and losing your draft context.
 *
 * Now the composer is hosted once, by the shell, and any surface can open it:
 * the "+" menu anywhere in the app, and (in later phases) anything else that
 * wants to start a post. It renders the SAME `CreatePost` the feed uses, in its
 * "modal" variant — one implementation, so a post made from Messages is the same
 * post as one made from the feed, with the same upload, visibility and error
 * handling.
 *
 * Nothing here touches navigation: opening and closing the composer leaves the
 * route, the scroll position and any open conversation exactly where they were,
 * because it is an overlay in the current page, not a route change.
 */
interface ComposerContextValue {
  /** Open the post composer. */
  open: () => void;
  /** Close it without publishing. */
  close: () => void;
  isOpen: boolean;
  /**
   * Open the story creator (Part 9 §14).
   *
   * Hosted here for the same reason the post composer is: "+ → Create Story"
   * used to navigate to `/?story=1`, which threw away whatever the user was
   * doing. A story is now created as an overlay, from any surface, with no
   * navigation. The creator itself decides whether this device may compose one.
   */
  openStory: () => void;
  storyOpen: boolean;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

export function useComposer() {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error("useComposer must be used inside <ComposerProvider>");
  return ctx;
}

export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);

  /* Overlays must not fight (Part 13 §31): opening one closes the other, so two
     full-screen surfaces can never be stacked on top of each other. */
  const open = useCallback(() => {
    setStoryOpen(false);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const openStory = useCallback(() => {
    setIsOpen(false);
    setStoryOpen(true);
  }, []);
  const closeStory = useCallback(() => setStoryOpen(false), []);

  /* §8 — the post is already saved by the time this runs. A publish from the
     feed can insert into the feed's own optimistic overlay because the feed
     owns it; a publish from Messages, a profile or a community has no such
     overlay, so the cached lists are invalidated instead and refetch from the
     server. No full-page reload, and no navigation away from where the user is. */
  const onCreated = useCallback((_post: FeedPostData) => {
    queryClient.invalidateQueries(["feed"]);
    queryClient.invalidateQueries(["user-posts"]);
    queryClient.invalidateQueries(["posts"]);
  }, []);

  const value = useMemo(
    () => ({ open, close, isOpen, openStory, storyOpen }),
    [open, close, isOpen, openStory, storyOpen]
  );

  return (
    <ComposerContext.Provider value={value}>
      {children}
      {isOpen ? <CreatePost variant="modal" onCreated={onCreated} onClose={close} /> : null}
      {storyOpen ? (
        <StoryCreator
          open={storyOpen}
          onClose={closeStory}
          /* §23 — the rail refetches on publish (the creator invalidates the
             story queries itself), so the new story appears without a reload. */
        />
      ) : null}
    </ComposerContext.Provider>
  );
}
