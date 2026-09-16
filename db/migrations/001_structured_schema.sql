-- =====================================================================
-- 001_structured_schema.sql
-- The structured half of the RAG system: a DIMS-style pharmaceutical
-- reference database, ported from the original MySQL dump.
--
-- Column ORDER matters: db/seed/pharma_data.sql emits column-less
-- INSERT ... VALUES, so these definitions must match the source dump
-- field-for-field.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram indexes for fuzzy name search
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------
-- Reference / lookup tables
-- ---------------------------------------------------------------------

CREATE TABLE company (
  company_id    integer PRIMARY KEY,
  company_name  varchar(150) NOT NULL,
  company_order integer NOT NULL DEFAULT 0
);

CREATE TABLE district (
  id   integer PRIMARY KEY,
  name varchar(100) NOT NULL
);

CREATE TABLE occupation (
  id   integer PRIMARY KEY,
  name varchar(100) NOT NULL
);

CREATE TABLE specialty (
  id        integer PRIMARY KEY,
  specialty varchar(150) NOT NULL
);

CREATE TABLE pregnancy_category (
  pregnancy_id          integer PRIMARY KEY,
  pregnancy_name        varchar(100) NOT NULL,
  pregnancy_description text
);

-- Self-referencing hierarchy of body systems (e.g. "Cardiovascular system").
CREATE TABLE systemic_class (
  systemic_id        integer PRIMARY KEY,
  systemic_name      varchar(200) NOT NULL,
  systemic_parent_id integer REFERENCES systemic_class (systemic_id) ON DELETE SET NULL
);

-- NOTE: `therapitic_*` is misspelled in the source data. Kept verbatim so the
-- generated seed file loads unchanged; the v_* views below expose clean names.
CREATE TABLE therapeutic_class (
  therapitic_id   integer PRIMARY KEY,
  therapitic_name varchar(200) NOT NULL,
  systemic_id     integer REFERENCES systemic_class (systemic_id) ON DELETE SET NULL
);

CREATE TABLE indication (
  indication_id   integer PRIMARY KEY,
  indication_name varchar(255) NOT NULL
);

-- ---------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------

-- A "generic" is the active-ingredient monograph: the long-form clinical text
-- that the agent's SQL tools read from, and that doubles as a RAG corpus.
CREATE TABLE generic (
  generic_id              integer PRIMARY KEY,
  generic_name            varchar(255) NOT NULL,
  indication              text,
  adult_dose              text,
  child_dose              text,
  renal_dose              text,
  administration          text,
  contra_indication       text,
  precaution              text,
  interaction             text,
  side_effect             text,
  mode_of_action          text,
  pregnancy_category_id   integer REFERENCES pregnancy_category (pregnancy_id) ON DELETE SET NULL,
  pregnancy_category_note text,
  data_source             varchar(16) NOT NULL DEFAULT 'json'
                            CHECK (data_source IN ('json', 'csv', 'json+csv'))
);

-- A "brand" is one marketed pack: brand name x company x form x strength.
CREATE TABLE brand (
  brand_id     integer PRIMARY KEY,
  brand_name   varchar(150) NOT NULL,
  company_id   integer NOT NULL REFERENCES company (company_id) ON DELETE CASCADE,
  generic_id   integer NOT NULL REFERENCES generic (generic_id) ON DELETE CASCADE,
  form         varchar(100),
  strength     varchar(255),
  packsize     varchar(255),
  price_text   varchar(255),
  price_min    numeric(12, 2),
  is_sponsored smallint NOT NULL DEFAULT 0
);

CREATE TABLE sponsored_brand (
  id         bigserial PRIMARY KEY,
  brand_id   integer NOT NULL REFERENCES brand (brand_id) ON DELETE CASCADE,
  generic_id integer REFERENCES generic (generic_id) ON DELETE SET NULL,
  UNIQUE (brand_id, generic_id)
);

-- ---------------------------------------------------------------------
-- Many-to-many joins
-- ---------------------------------------------------------------------

CREATE TABLE indication_generic (
  id            bigserial PRIMARY KEY,
  indication_id integer NOT NULL REFERENCES indication (indication_id) ON DELETE CASCADE,
  generic_id    integer NOT NULL REFERENCES generic (generic_id) ON DELETE CASCADE,
  UNIQUE (indication_id, generic_id)
);

CREATE TABLE therapeutic_generic (
  id            bigserial PRIMARY KEY,
  therapitic_id integer NOT NULL REFERENCES therapeutic_class (therapitic_id) ON DELETE CASCADE,
  generic_id    integer NOT NULL REFERENCES generic (generic_id) ON DELETE CASCADE,
  UNIQUE (therapitic_id, generic_id)
);

-- ---------------------------------------------------------------------
-- Herbal / traditional-medicine parallel hierarchy
-- ---------------------------------------------------------------------

CREATE TABLE herbal_generic (
  generic_id          integer PRIMARY KEY,
  generic_name        varchar(255) NOT NULL,
  composition         text,
  description         text,
  indication          text,
  dosage              text,
  mode_of_actions     text,
  contraindication    text,
  side_effects        text,
  precaution          text,
  drug_interaction    text,
  pregnancy_lactation text,
  therapeutic_class   varchar(255)
);

CREATE TABLE herbal_brand (
  brand_id   integer PRIMARY KEY,
  brand_name varchar(150) NOT NULL,
  company_id integer REFERENCES company (company_id) ON DELETE SET NULL,
  generic_id integer NOT NULL REFERENCES herbal_generic (generic_id) ON DELETE CASCADE,
  form       varchar(100),
  strength   varchar(255),
  packsize   varchar(255),
  price_text varchar(255),
  price_min  numeric(12, 2)
);

-- =====================================================================
-- Indexes
--
-- The agent's SQL tools search overwhelmingly by name, so every user-facing
-- name column gets both a lower() btree (exact / prefix) and a GIN trigram
-- index (fuzzy + ILIKE '%x%', which a btree cannot serve).
-- =====================================================================

CREATE INDEX idx_brand_name_lower    ON brand (lower(brand_name));
CREATE INDEX idx_brand_name_trgm     ON brand USING gin (brand_name gin_trgm_ops);
CREATE INDEX idx_brand_company       ON brand (company_id);
CREATE INDEX idx_brand_generic       ON brand (generic_id);
CREATE INDEX idx_brand_price         ON brand (price_min);
CREATE INDEX idx_brand_form_lower    ON brand (lower(form));

CREATE INDEX idx_generic_name_lower  ON generic (lower(generic_name));
CREATE INDEX idx_generic_name_trgm   ON generic USING gin (generic_name gin_trgm_ops);
CREATE INDEX idx_generic_pregnancy   ON generic (pregnancy_category_id);

CREATE INDEX idx_company_name_lower  ON company (lower(company_name));
CREATE INDEX idx_company_name_trgm   ON company USING gin (company_name gin_trgm_ops);

CREATE INDEX idx_indication_name_trgm ON indication USING gin (indication_name gin_trgm_ops);
CREATE INDEX idx_therapeutic_name_trgm ON therapeutic_class USING gin (therapitic_name gin_trgm_ops);

CREATE INDEX idx_ig_generic          ON indication_generic (generic_id);
CREATE INDEX idx_tg_generic          ON therapeutic_generic (generic_id);
CREATE INDEX idx_therapeutic_systemic ON therapeutic_class (systemic_id);
CREATE INDEX idx_systemic_parent     ON systemic_class (systemic_parent_id);

CREATE INDEX idx_herbal_brand_name_trgm   ON herbal_brand USING gin (brand_name gin_trgm_ops);
CREATE INDEX idx_herbal_generic_name_trgm ON herbal_generic USING gin (generic_name gin_trgm_ops);
CREATE INDEX idx_herbal_brand_generic     ON herbal_brand (generic_id);
CREATE INDEX idx_herbal_brand_company     ON herbal_brand (company_id);

-- =====================================================================
-- Denormalised views
--
-- These exist so the text-to-SQL tool has a small, well-named surface to
-- target. Pointing a model at 15 raw tables with a misspelled join key
-- produces markedly worse SQL than pointing it at three clean views.
-- =====================================================================

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
  tc.therapitic_name           AS therapeutic_class,
  sc.systemic_name             AS systemic_class
FROM brand b
JOIN company c            ON c.company_id = b.company_id
JOIN generic g            ON g.generic_id = b.generic_id
LEFT JOIN pregnancy_category pc ON pc.pregnancy_id = g.pregnancy_category_id
LEFT JOIN therapeutic_generic tg ON tg.generic_id = g.generic_id
LEFT JOIN therapeutic_class tc  ON tc.therapitic_id = tg.therapitic_id
LEFT JOIN systemic_class sc     ON sc.systemic_id = tc.systemic_id;

CREATE VIEW v_generic_full AS
SELECT
  g.generic_id,
  g.generic_name,
  g.indication,
  g.adult_dose,
  g.child_dose,
  g.renal_dose,
  g.administration,
  g.contra_indication,
  g.precaution,
  g.interaction,
  g.side_effect,
  g.mode_of_action,
  pc.pregnancy_name AS pregnancy_category,
  g.pregnancy_category_note,
  (SELECT count(*) FROM brand b WHERE b.generic_id = g.generic_id)        AS brand_count,
  (SELECT min(b.price_min) FROM brand b WHERE b.generic_id = g.generic_id) AS cheapest_brand_price,
  (SELECT string_agg(DISTINCT tc.therapitic_name, ', ')
     FROM therapeutic_generic tg
     JOIN therapeutic_class tc ON tc.therapitic_id = tg.therapitic_id
    WHERE tg.generic_id = g.generic_id)                                    AS therapeutic_classes,
  (SELECT string_agg(DISTINCT i.indication_name, ', ')
     FROM indication_generic ig
     JOIN indication i ON i.indication_id = ig.indication_id
    WHERE ig.generic_id = g.generic_id)                                    AS indications
FROM generic g
LEFT JOIN pregnancy_category pc ON pc.pregnancy_id = g.pregnancy_category_id;

CREATE VIEW v_company_stats AS
SELECT
  c.company_id,
  c.company_name,
  count(b.brand_id)                     AS brand_count,
  count(DISTINCT b.generic_id)          AS generic_count,
  round(avg(b.price_min), 2)            AS avg_price,
  min(b.price_min)                      AS min_price,
  max(b.price_min)                      AS max_price
FROM company c
LEFT JOIN brand b ON b.company_id = c.company_id
GROUP BY c.company_id, c.company_name;
