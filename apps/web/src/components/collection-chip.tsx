import { TONE, type Collection } from "@/lib/collections";

/** inline-flex, so the chip is one box wherever it lands: an inline span inside a narrow table cell fragments across two lines. */
export const CHIP = "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium leading-4";

/** An emoji alone; the collection's name lives in the tooltip and for screen readers. */
export function CollectionChip({ collection, title }: { collection: Collection; title?: string }) {
  return (
    <span className={`${CHIP} ${TONE[collection.tone]}`} title={title ?? `Created a ${collection.noun}`}>
      <span aria-hidden="true">{collection.emoji}</span>
      <span className="sr-only">{collection.name}</span>
    </span>
  );
}
