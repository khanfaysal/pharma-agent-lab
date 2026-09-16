-- ---------------------------------------------------------------------------
-- Fix the row fan-out in v_brand_full.
--
-- The original view reached therapeutic and systemic class through the
-- many-to-many junction `therapeutic_generic` with a plain LEFT JOIN. A generic
-- that belongs to three classes therefore produced three identical rows for
-- every one of its brands, and one in four classes produced four.
--
-- The damage was not only cosmetic duplicate rows in the UI:
--
--   * /api/generics/:id fetches brands with LIMIT 100. At 4x duplication a drug
--     with 40 brands returned 10 of them and silently hid the rest -- including,
--     potentially, the cheapest one, which is the single number this directory
--     exists to get right.
--   * /api/brands search results repeated the same brand several times.
--   * Any COUNT or MIN over the view was multiplied by the class count.
--
-- The fix is the same shape v_generic_full already uses: aggregate the classes
-- into one text column with a correlated subquery, so the view stays strictly
-- one row per brand. Column names, order and count are unchanged, so every
-- existing query keeps working.
--
-- DROP + CREATE rather than CREATE OR REPLACE because the two class columns
-- change type from varchar to the text that string_agg returns, and REPLACE
-- refuses a type change.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_brand_full;

CREATE VIEW v_brand_full AS
SELECT
  b.brand_id,
  b.brand_name,
  b.form,
  b.strength,
  b.packsize,
  b.price_text,
  b.price_min,
  (b.is_sponsored = 1)         AS is_sponsored,
  c.company_id,
  c.company_name,
  g.generic_id,
  g.generic_name,
  pc.pregnancy_name            AS pregnancy_category,

  -- Every class this generic belongs to, flattened to one cell.
  (SELECT string_agg(DISTINCT tc.therapitic_name, ', ')
     FROM therapeutic_generic tg
     JOIN therapeutic_class tc ON tc.therapitic_id = tg.therapitic_id
    WHERE tg.generic_id = g.generic_id)                AS therapeutic_class,

  (SELECT string_agg(DISTINCT sc.systemic_name, ', ')
     FROM therapeutic_generic tg
     JOIN therapeutic_class tc ON tc.therapitic_id = tg.therapitic_id
     JOIN systemic_class sc    ON sc.systemic_id = tc.systemic_id
    WHERE tg.generic_id = g.generic_id)                AS systemic_class

FROM brand b
JOIN company c ON c.company_id = b.company_id
JOIN generic g ON g.generic_id = b.generic_id
LEFT JOIN pregnancy_category pc ON pc.pregnancy_id = g.pregnancy_category_id;
