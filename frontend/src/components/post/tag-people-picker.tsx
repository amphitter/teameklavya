"use client";

import { useState } from "react";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonRow } from "@/components/people/person-row";
import { usePeopleSearch, type PersonResult } from "@/components/people/use-people-search";

/**
 * Tag people in a post (Part 13 §9–§11).
 *
 * Real users only: every row is the result of a server-side search over real
 * accounts, so there is no static suggestion list to drift out of date and no
 * way to tag somebody who does not exist.
 *
 * What "tagging" produces: the picker inserts `@username` into the post text
 * and the backend's own parser (`parseMentions`, which already existed) turns
 * the handles into `Post.mentions` — real user ids, author excluded. That keeps
 * one source of truth for who was mentioned and means the mention notification
 * is created by the same code path that creates the post, after it is saved,
 * never for a draft or a failed publish.
 */
export function TagPeoplePicker({
  open,
  onClose,
  selected,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  selected: PersonResult[];
  onToggle: (person: PersonResult) => void;
}) {
  const [query, setQuery] = useState("");
  const { results, loading, error, searched } = usePeopleSearch(query, {
    enabled: open,
    limit: 12,
  });

  const selectedIds = new Set(selected.map((p) => p._id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 p-4 sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Tag people</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or username"
            aria-label="Search people to tag"
            autoFocus
            className="h-11 w-full rounded-full border border-input bg-muted/60 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Selected people stay visible above the results — you can see who you
            are about to tag without scrolling back to the composer. */}
        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((p) => (
              <button
                key={p._id}
                type="button"
                onClick={() => onToggle(p)}
                aria-label={`Remove ${p.username || p.firstName}`}
                className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
              >
                @{p.username || p.firstName}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="-mx-1 min-h-[120px] flex-1 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Type at least two characters to find people.
            </p>
          ) : error ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t search right now. Check your connection and try again.
            </p>
          ) : loading ? (
            <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </p>
          ) : searched && results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No people found</p>
          ) : (
            results.map((p) => {
              const isSelected = selectedIds.has(p._id);
              return (
                <PersonRow
                  key={p._id}
                  person={p}
                  onSelect={() => onToggle(p)}
                  className={isSelected ? "bg-primary/5" : undefined}
                  action={
                    isSelected ? (
                      <span className="text-xs font-bold text-primary">Tagged</span>
                    ) : (
                      <UserPlus className="h-4 w-4 text-muted-foreground" />
                    )
                  }
                />
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
