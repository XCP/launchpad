import { TONE, type Collection } from "@/lib/collections";

export const CHIP = "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium";

/** An emoji alone; the collection's name lives in the tooltip and for screen readers. */
export function CollectionChip({ collection, title }: { collection: Collection; title?: string }) {
  return (
    <span className={`${CHIP} ${TONE[collection.tone]}`} title={title ?? `Created a ${collection.noun}`}>
      <span aria-hidden="true">{collection.emoji}</span>
      <span className="sr-only">{collection.name}</span>
    </span>
  );
}
