"use client";

import { Fragment } from "react";
import Link from "next/link";

const TOKEN_RE = /(#[a-zA-Z0-9_]{2,30})|(@[a-z0-9_]{3,30})/gi;

/**
 * Renders user-generated text with real links:
 *   #topic    → /explore?topic=<topic>
 *   @username → /profile/<username>
 * Plain text stays plain (React escapes everything — no raw HTML ever).
 */
export function RichContent({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = new RegExp(TOKEN_RE);
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    }
    const token = m[0];
    if (token.startsWith("#")) {
      const topic = token.slice(1).toLowerCase();
      parts.push(
        <Link
          key={key++}
          href={`/explore?topic=${encodeURIComponent(topic)}`}
          className="font-semibold text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {token}
        </Link>
      );
    } else {
      const username = token.slice(1).toLowerCase();
      parts.push(
        <Link
          key={key++}
          href={`/profile/${username}`}
          className="font-semibold text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {token}
        </Link>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  }

  return <>{parts}</>;
}
