/**
 * In-memory {@link RealtimeBroadcaster} (test/reference implementation).
 *
 * This is not a production transport — production backs the broadcaster with
 * Supabase Realtime. This implementation records every published
 * `(channel, payload)` pair so the pure fanout core can be exercised without a
 * live realtime backend, and so tests can assert exactly which channels a
 * payload was fanned out to (the "who receives what" scoping).
 */

import type { RealtimeBroadcaster, RealtimeUpdate } from "./fanout.js";

/** A recorded publish call. */
export interface PublishedMessage {
  channel: string;
  payload: RealtimeUpdate;
}

export class InMemoryRealtimeBroadcaster implements RealtimeBroadcaster {
  private readonly messages: PublishedMessage[] = [];

  async publish(channel: string, payload: RealtimeUpdate): Promise<void> {
    this.messages.push({ channel, payload });
  }

  /** All published messages, in publish order. */
  published(): readonly PublishedMessage[] {
    return this.messages;
  }

  /** The distinct channels a message was published on, in first-seen order. */
  channels(): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const m of this.messages) {
      if (!seen.has(m.channel)) {
        seen.add(m.channel);
        ordered.push(m.channel);
      }
    }
    return ordered;
  }

  /** Messages published on a specific channel. */
  messagesOn(channel: string): PublishedMessage[] {
    return this.messages.filter((m) => m.channel === channel);
  }

  /** Reset recorded state between test cases. */
  clear(): void {
    this.messages.length = 0;
  }
}
