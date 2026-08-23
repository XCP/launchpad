-- Re-open the description worklist for inscribed launches.
--
-- The first version of the mirror treated "not a URL" as "must be prose", so
-- a launch whose on-chain description is its content rather than words —
-- an HTML mint viewer, an SVG, image bytes — had the opening 2,000
-- characters of that markup copied into display_description, where it showed
-- up as the card blurb and the shared-link description. Those rows are past
-- the worklist (it only visits NULL), so the fixed classifier can never reach
-- them on its own.
--
-- Setting them back to NULL puts exactly those rows back in the queue; the
-- next tick classifies them as inscriptions and writes the checked-empty
-- string. Owner-written prose is never touched: it does not start with a tag.
UPDATE launches
   SET display_description = NULL
 WHERE display_description LIKE '<%';
