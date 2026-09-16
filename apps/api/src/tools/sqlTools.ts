import { query } from '../db.js';
import {
  type AgentTool, type Citation, type ToolResult,
  asInt, asNumber, asString,
} from './types.js';

/**
 * Typed, parameterised SQL tools.
 *
 * Deliberately NOT text-to-SQL. Generated SQL over 15 tables with a misspelled
 * join column (`therapitic_id`) fails in the worst way: it runs, returns
 * plausible rows, and answers a different question than the one asked. These
 * tools give up some flexibility to make failures visible -- a tool either
 * matches or reports `empty`, and every row carries a citable primary key.
 *
 * Every value reaches PostgreSQL as a bound parameter; no user or model text
 * is ever concatenated into SQL.
 */

/** Row cap per tool call, so one broad query cannot blow the context budget. */
const MAX_ROWS = 50;

/**
 * Three-tier name matching, mirroring the behaviour documented in
 * db/docs/product-documentation.md: exact, then prefix, then trigram-fuzzy.
 * Returning the tier lets the answer say "no exact match, showing similar".
 */
function nameMatchSql(column: string, paramIndex: number) {
  return {
    where: `(
      lower(${column}) = lower($${paramIndex})
      OR ${column} ILIKE $${paramIndex} || '%'
      OR ${column} ILIKE '%' || $${paramIndex} || '%'
      OR similarity(${column}, $${paramIndex}) > 0.3
    )`,
    rank: `CASE
      WHEN lower(${column}) = lower($${paramIndex}) THEN 0
      WHEN ${column} ILIKE $${paramIndex} || '%'     THEN 1
      WHEN ${column} ILIKE '%' || $${paramIndex} || '%' THEN 2
      ELSE 3
    END`,
  };
}

const brandCitation = (r: { brand_id: number; brand_name: string; company_name?: string }): Citation => ({
  kind: 'sql',
  ref: `brand:${r.brand_id}`,
  label: r.company_name ? `${r.brand_name} (${r.company_name})` : r.brand_name,
});

const genericCitation = (r: { generic_id: number; generic_name: string }): Citation => ({
  kind: 'sql',
  ref: `generic:${r.generic_id}`,
  label: r.generic_name,
});

const empty = (what: string): ToolResult => ({
  summary: `No matching ${what}. Try a different spelling, or the generic name instead of the brand name.`,
  data: [],
  citations: [],
  empty: true,
});

/* ================================================================== *
 * search_brands
 * ================================================================== */

const searchBrands: AgentTool = {
  group: 'sql',
  schema: {
    name: 'search_brands',
    description:
      'Search marketed medicine brands (trade names) by brand name, generic name, or manufacturer. '
      + 'Supports filtering by dosage form, strength, price range and company. '
      + 'Use this for "who makes X", "what forms does X come in", "what does X cost".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Brand name, generic name, or manufacturer to search for.' },
        company: { type: 'string', description: 'Restrict to this manufacturer.' },
        form: { type: 'string', description: 'Dosage form, e.g. Tablet, Syrup, Injection, Capsule.' },
        generic_name: { type: 'string', description: 'Restrict to brands of this active ingredient.' },
        max_price: { type: 'number', description: 'Only brands at or below this price.' },
        min_price: { type: 'number', description: 'Only brands at or above this price.' },
        sort: { type: 'string', enum: ['relevance', 'price_asc', 'price_desc'], description: 'Default relevance.' },
        limit: { type: 'integer', description: 'Max rows, 1-50. Default 15.' },
      },
      required: ['query'],
    },
  },

  async run(args) {
    const q = asString(args.query);
    if (!q) return empty('brands (no search term given)');

    const limit = asInt(args.limit, 15, { max: MAX_ROWS });
    const params: unknown[] = [q];
    const match = nameMatchSql('b.brand_name', 1);

    // The search term may be a brand, a generic, or a company, so match all
    // three and let the rank expression decide which interpretation wins.
    const conditions: string[] = [
      `(${match.where}
        OR g.generic_name ILIKE '%' || $1 || '%'
        OR c.company_name ILIKE '%' || $1 || '%')`,
    ];

    const push = (value: unknown, sql: (i: number) => string) => {
      params.push(value);
      conditions.push(sql(params.length));
    };

    const company = asString(args.company);
    if (company) push(company, (i) => `c.company_name ILIKE '%' || $${i} || '%'`);

    const form = asString(args.form);
    if (form) push(form, (i) => `b.form ILIKE '%' || $${i} || '%'`);

    const genericName = asString(args.generic_name);
    if (genericName) push(genericName, (i) => `g.generic_name ILIKE '%' || $${i} || '%'`);

    const maxPrice = asNumber(args.max_price);
    if (maxPrice !== null) push(maxPrice, (i) => `b.price_min <= $${i}`);

    const minPrice = asNumber(args.min_price);
    if (minPrice !== null) push(minPrice, (i) => `b.price_min >= $${i}`);

    const sort = asString(args.sort, 'relevance');
    const orderBy = sort === 'price_asc' ? 'b.price_min ASC NULLS LAST'
                  : sort === 'price_desc' ? 'b.price_min DESC NULLS LAST'
                  : `${match.rank}, b.price_min ASC NULLS LAST`;

    params.push(limit);

    const rows = await query<{
      brand_id: number; brand_name: string; company_name: string; generic_name: string;
      form: string | null; strength: string | null; packsize: string | null;
      price_min: number | null; is_sponsored: boolean; generic_id: number;
    }>(
      `SELECT b.brand_id, b.brand_name, c.company_name, g.generic_name, g.generic_id,
              b.form, b.strength, b.packsize, b.price_min,
              (b.is_sponsored = 1) AS is_sponsored
         FROM brand b
         JOIN company c ON c.company_id = b.company_id
         JOIN generic g ON g.generic_id = b.generic_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.length}`,
      params,
    );

    if (!rows.length) return empty(`brands for "${q}"`);

    return {
      summary: `${rows.length} brand(s) matching "${q}"`
        + (rows.length === limit ? ' (truncated to the row limit)' : ''),
      data: rows,
      citations: rows.map(brandCitation),
    };
  },
};

/* ================================================================== *
 * search_generics
 * ================================================================== */

const searchGenerics: AgentTool = {
  group: 'sql',
  schema: {
    name: 'search_generics',
    description:
      'Search active ingredients (generic names) and return a summary of each: '
      + 'indication, therapeutic class, pregnancy category, how many brands exist and the cheapest price. '
      + 'Use this to find the right ingredient before drilling into a full monograph.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Generic/active ingredient name, or part of one.' },
        therapeutic_class: { type: 'string', description: 'Restrict to this drug class, e.g. "Proton pump inhibitor".' },
        limit: { type: 'integer', description: 'Max rows, 1-50. Default 10.' },
      },
      required: ['query'],
    },
  },

  async run(args) {
    const q = asString(args.query);
    if (!q) return empty('generics (no search term given)');

    const limit = asInt(args.limit, 10, { max: MAX_ROWS });
    const match = nameMatchSql('g.generic_name', 1);
    const params: unknown[] = [q];
    const conditions = [match.where];

    const cls = asString(args.therapeutic_class);
    if (cls) {
      params.push(cls);
      conditions.push(`EXISTS (
        SELECT 1 FROM therapeutic_generic tg
          JOIN therapeutic_class tc ON tc.therapitic_id = tg.therapitic_id
         WHERE tg.generic_id = g.generic_id
           AND tc.therapitic_name ILIKE '%' || $${params.length} || '%')`);
    }

    params.push(limit);

    const rows = await query<Record<string, unknown>>(
      `SELECT g.generic_id, g.generic_name,
              left(g.indication, 300)  AS indication,
              left(g.mode_of_action, 250) AS mode_of_action,
              pc.pregnancy_name AS pregnancy_category,
              (SELECT count(*)::int FROM brand b WHERE b.generic_id = g.generic_id)   AS brand_count,
              (SELECT min(b.price_min) FROM brand b WHERE b.generic_id = g.generic_id) AS cheapest_price,
              (SELECT string_agg(DISTINCT tc.therapitic_name, ', ')
                 FROM therapeutic_generic tg
                 JOIN therapeutic_class tc ON tc.therapitic_id = tg.therapitic_id
                WHERE tg.generic_id = g.generic_id) AS therapeutic_classes
         FROM generic g
         LEFT JOIN pregnancy_category pc ON pc.pregnancy_id = g.pregnancy_category_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${match.rank}, g.generic_name
        LIMIT $${params.length}`,
      params,
    );

    if (!rows.length) return empty(`generics for "${q}"`);

    return {
      summary: `${rows.length} generic(s) matching "${q}"`,
      data: rows,
      citations: rows.map((r) => genericCitation(r as { generic_id: number; generic_name: string })),
    };
  },
};

/* ================================================================== *
 * get_generic_detail
 * ================================================================== */

const getGenericDetail: AgentTool = {
  group: 'sql',
  schema: {
    name: 'get_generic_detail',
    description:
      'Fetch the full clinical monograph for one active ingredient: indication, adult dose, child dose, '
      + 'renal dose, administration, contraindication, precaution, interaction, side effects, mode of action '
      + 'and pregnancy category. Use this for dosing, safety and interaction questions.',
    parameters: {
      type: 'object',
      properties: {
        generic_name: { type: 'string', description: 'Exact or near-exact active ingredient name.' },
        generic_id: { type: 'integer', description: 'Use when a previous tool call returned an id.' },
      },
      required: [],
    },
  },

  async run(args) {
    const id = asNumber(args.generic_id);
    const name = asString(args.generic_name);
    if (id === null && !name) return empty('monograph (give generic_name or generic_id)');

    const rows = await query<Record<string, unknown>>(
      id !== null
        ? `SELECT * FROM v_generic_full WHERE generic_id = $1`
        : `SELECT * FROM v_generic_full
            WHERE lower(generic_name) = lower($1)
               OR generic_name ILIKE $1 || '%'
               OR similarity(generic_name, $1) > 0.4
            ORDER BY CASE WHEN lower(generic_name) = lower($1) THEN 0 ELSE 1 END,
                     similarity(generic_name, $1) DESC
            LIMIT 1`,
      [id ?? name],
    );

    const row = rows[0];
    if (!row) return empty(`monograph for "${name || id}"`);

    // Long free-text fields are truncated before they enter the model context.
    // The full text stays available through the REST API for the UI.
    const TRUNCATE_AT = 1200;
    const trimmed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      trimmed[key] = typeof value === 'string' && value.length > TRUNCATE_AT
        ? `${value.slice(0, TRUNCATE_AT)}... [truncated]`
        : value;
    }

    return {
      summary: `Monograph for ${row.generic_name} (${row.brand_count} brand(s) on the market)`,
      data: trimmed,
      citations: [genericCitation(row as { generic_id: number; generic_name: string })],
    };
  },
};

/* ================================================================== *
 * compare_brand_prices
 * ================================================================== */

const compareBrandPrices: AgentTool = {
  group: 'sql',
  schema: {
    name: 'compare_brand_prices',
    description:
      'List every marketed brand of one active ingredient, sorted by price, to find the cheapest '
      + 'equivalent. Accepts either a generic name or a brand name -- given a brand it first resolves '
      + 'which ingredient that brand contains. Use for "cheapest alternative to X".',
    parameters: {
      type: 'object',
      properties: {
        generic_name: { type: 'string', description: 'Active ingredient to compare across.' },
        brand_name: { type: 'string', description: 'Brand name; its ingredient is resolved first.' },
        form: { type: 'string', description: 'Restrict to one dosage form so the comparison is like-for-like.' },
        strength: { type: 'string', description: 'Restrict to one strength, e.g. "500mg".' },
        limit: { type: 'integer', description: 'Max rows, 1-50. Default 20.' },
      },
      required: [],
    },
  },

  async run(args) {
    const limit = asInt(args.limit, 20, { max: MAX_ROWS });
    let genericName = asString(args.generic_name);
    let resolvedFrom: string | null = null;

    // Resolve brand -> generic first; comparing prices across brand names that
    // contain different ingredients would be meaningless.
    const brandName = asString(args.brand_name);
    if (!genericName && brandName) {
      const hit = await query<{ generic_name: string }>(
        `SELECT g.generic_name
           FROM brand b JOIN generic g ON g.generic_id = b.generic_id
          WHERE lower(b.brand_name) = lower($1) OR b.brand_name ILIKE $1 || '%'
          ORDER BY CASE WHEN lower(b.brand_name) = lower($1) THEN 0 ELSE 1 END
          LIMIT 1`,
        [brandName],
      );
      if (!hit[0]) return empty(`brand "${brandName}"`);
      genericName = hit[0].generic_name;
      resolvedFrom = brandName;
    }

    if (!genericName) return empty('price comparison (give generic_name or brand_name)');

    const params: unknown[] = [genericName];
    const conditions = [
      `(lower(g.generic_name) = lower($1) OR g.generic_name ILIKE $1 || '%')`,
    ];

    const form = asString(args.form);
    if (form) { params.push(form); conditions.push(`b.form ILIKE '%' || $${params.length} || '%'`); }

    const strength = asString(args.strength);
    if (strength) { params.push(strength); conditions.push(`b.strength ILIKE '%' || $${params.length} || '%'`); }

    params.push(limit);

    const rows = await query<{
      brand_id: number; brand_name: string; company_name: string;
      form: string | null; strength: string | null; packsize: string | null;
      price_min: number | null; is_sponsored: boolean;
    }>(
      `SELECT b.brand_id, b.brand_name, c.company_name, b.form, b.strength,
              b.packsize, b.price_min, (b.is_sponsored = 1) AS is_sponsored
         FROM brand b
         JOIN company c ON c.company_id = b.company_id
         JOIN generic g ON g.generic_id = b.generic_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.price_min ASC NULLS LAST
        LIMIT $${params.length}`,
      params,
    );

    if (!rows.length) return empty(`brands of "${genericName}"`);

    const priced = rows.filter((r) => r.price_min !== null);
    const cheapest = priced[0];
    const dearest = priced[priced.length - 1];

    return {
      summary: [
        resolvedFrom ? `${resolvedFrom} contains ${genericName}.` : '',
        `${rows.length} brand(s) of ${genericName}.`,
        cheapest ? `Cheapest: ${cheapest.brand_name} (${cheapest.company_name}) at ${cheapest.price_min} per ${cheapest.packsize ?? 'pack'}.` : '',
        dearest && dearest !== cheapest ? `Dearest: ${dearest.brand_name} at ${dearest.price_min}.` : '',
        'Prices are per the pack size shown, not per unit -- compare like-for-like pack sizes.',
      ].filter(Boolean).join(' '),
      data: { generic_name: genericName, resolved_from: resolvedFrom, brands: rows },
      citations: rows.map(brandCitation),
    };
  },
};

/* ================================================================== *
 * search_companies
 * ================================================================== */

const searchCompanies: AgentTool = {
  group: 'sql',
  schema: {
    name: 'search_companies',
    description:
      'Look up pharmaceutical manufacturers and their portfolio statistics: how many brands and '
      + 'distinct ingredients they market, and their price range.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Company name or part of one.' },
        limit: { type: 'integer', description: 'Max rows, 1-50. Default 10.' },
      },
      required: ['query'],
    },
  },

  async run(args) {
    const q = asString(args.query);
    if (!q) return empty('companies (no search term given)');
    const limit = asInt(args.limit, 10, { max: MAX_ROWS });
    const match = nameMatchSql('company_name', 1);

    const rows = await query<{ company_id: number; company_name: string }>(
      `SELECT * FROM v_company_stats
        WHERE ${match.where}
        ORDER BY ${match.rank}, brand_count DESC
        LIMIT $2`,
      [q, limit],
    );

    if (!rows.length) return empty(`companies for "${q}"`);

    return {
      summary: `${rows.length} manufacturer(s) matching "${q}"`,
      data: rows,
      citations: rows.map((r) => ({
        kind: 'sql' as const,
        ref: `company:${r.company_id}`,
        label: r.company_name,
      })),
    };
  },
};

/* ================================================================== *
 * search_by_indication
 * ================================================================== */

const searchByIndication: AgentTool = {
  group: 'sql',
  schema: {
    name: 'search_by_indication',
    description:
      'Find active ingredients used to treat a condition, with an example brand and price for each. '
      + 'Use for "what is used for hypertension", "which medicines treat X".',
    parameters: {
      type: 'object',
      properties: {
        indication: { type: 'string', description: 'Condition or indication, e.g. "hypertension", "peptic ulcer".' },
        limit: { type: 'integer', description: 'Max rows, 1-50. Default 15.' },
      },
      required: ['indication'],
    },
  },

  async run(args) {
    const q = asString(args.indication);
    if (!q) return empty('indications (no condition given)');
    const limit = asInt(args.limit, 15, { max: MAX_ROWS });

    // Match the curated indication table first; fall back to the monograph
    // free text, which covers conditions that were never normalised into a row.
    const rows = await query<{ generic_id: number; generic_name: string }>(
      `SELECT DISTINCT ON (g.generic_id)
              g.generic_id, g.generic_name,
              i.indication_name AS matched_indication,
              left(g.indication, 250) AS indication_text,
              (SELECT count(*)::int FROM brand b WHERE b.generic_id = g.generic_id) AS brand_count,
              (SELECT min(b.price_min) FROM brand b WHERE b.generic_id = g.generic_id) AS cheapest_price
         FROM generic g
         LEFT JOIN indication_generic ig ON ig.generic_id = g.generic_id
         LEFT JOIN indication i ON i.indication_id = ig.indication_id
        WHERE i.indication_name ILIKE '%' || $1 || '%'
           OR g.indication ILIKE '%' || $1 || '%'
        ORDER BY g.generic_id
        LIMIT $2`,
      [q, limit],
    );

    if (!rows.length) return empty(`medicines for "${q}"`);

    return {
      summary: `${rows.length} active ingredient(s) associated with "${q}". `
        + 'This is a reference listing, not a treatment recommendation.',
      data: rows,
      citations: rows.map(genericCitation),
    };
  },
};

/* ================================================================== *
 * database_overview
 * ================================================================== */

const databaseOverview: AgentTool = {
  group: 'sql',
  schema: {
    name: 'database_overview',
    description:
      'Report what the database contains: table row counts and the largest manufacturers. '
      + 'Use when asked about coverage, scope, or "how many X do you have".',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  async run() {
    const [counts] = await query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM company)        AS companies,
              (SELECT count(*)::int FROM generic)        AS generics,
              (SELECT count(*)::int FROM brand)          AS brands,
              (SELECT count(*)::int FROM herbal_generic) AS herbal_generics,
              (SELECT count(*)::int FROM herbal_brand)   AS herbal_brands,
              (SELECT count(*)::int FROM indication)     AS indications,
              (SELECT count(*)::int FROM therapeutic_class) AS therapeutic_classes`,
    );
    const top = await query(
      `SELECT company_name, brand_count FROM v_company_stats
        ORDER BY brand_count DESC LIMIT 10`,
    );

    return {
      summary: `Database holds ${counts?.brands ?? 0} brands across ${counts?.generics ?? 0} `
        + `generics from ${counts?.companies ?? 0} manufacturers.`,
      data: { counts, top_companies: top },
      citations: [],
    };
  },
};

export const sqlTools: AgentTool[] = [
  searchBrands,
  searchGenerics,
  getGenericDetail,
  compareBrandPrices,
  searchCompanies,
  searchByIndication,
  databaseOverview,
];
