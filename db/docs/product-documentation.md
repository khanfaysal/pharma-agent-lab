---
title: Product Documentation
source_type: docs
uri: https://medindex.example/docs
effective: 2026-03-01
---

# MedIndex Product Documentation

## Data model

MedIndex organises pharmaceutical reference data around three core entities and
several classification hierarchies.

### Generic
The active-ingredient monograph. One record per active ingredient or fixed
combination. Fields: generic name, indication, adult dose, child dose, renal
dose, administration, contraindication, precaution, interaction, side effect,
mode of action, pregnancy category, and a pregnancy note. A generic is the unit
of *clinical* truth.

### Brand
One marketed pack. A brand record is the tuple of brand name, manufacturer,
generic, dosage form, strength, pack size, and price. The same brand name
appears as several records when it is sold in multiple strengths or forms — for
example a syrup and a tablet under one trade name are two brand records. A brand
is the unit of *commercial* truth.

### Company
The manufacturer or marketing authorisation holder. Companies own brands, not
generics.

### Classification
- **Systemic class** — body system, hierarchical (a class can have a parent).
- **Therapeutic class** — drug family, belongs to one systemic class.
- **Indication** — condition treated; many-to-many with generics.
- **Pregnancy category** — A/B/C/D/X with a descriptive note.

### Herbal
Herbal generics and herbal brands mirror the allopathic structure with a reduced
field set: composition, description, indication, dosage, mode of action,
contraindication, side effects, precaution, drug interaction, and pregnancy or
lactation notes.

## Search behaviour

### Matching
Name search is case-insensitive and accent-insensitive. It runs in three tiers
and returns the first tier that produces results:

1. **Exact** — the normalised query equals the normalised name.
2. **Prefix** — the name starts with the query. Ranked by name length ascending,
   so "Nap" surfaces "Napa" before "Naproxen Sodium".
3. **Fuzzy** — trigram similarity above 0.3, ranked by similarity descending.

Substring matches inside a name are included at the prefix tier but ranked below
true prefixes.

### Filters
Filters compose with AND: company, therapeutic class, systemic class, dosage
form, pregnancy category, price range, and sponsored status. Filtering never
changes which tier matched; it only removes rows.

### Ordering
Default ordering is relevance, then sponsored status, then price ascending.
Sponsored placement applies only within an equal relevance band — it can never
promote a less relevant result above a more relevant one.

## The AI assistant

### Architecture
The assistant is an agent, not a single prompt. A request flows:

```
question -> router -> agent loop -> tools -> answer + citations
```

**Router.** Classifies the question into `sql`, `rag`, `hybrid`, or `none`, and
picks a model tier. Cheap classification decides expensive execution.

**Agent loop.** Iteratively calls tools and feeds results back to the model until
it produces a final answer or hits the step budget (default 6).

**Tools.** The model does not write raw SQL against the database. It calls
typed, parameterised tools:

| Tool | Purpose |
| --- | --- |
| `search_brands` | Brand lookup with filters, sorting, pagination |
| `search_generics` | Generic/monograph lookup |
| `search_companies` | Manufacturer lookup with aggregate stats |
| `get_generic_detail` | Full monograph by id or exact name |
| `compare_brand_prices` | All brands of one generic, price-sorted |
| `search_by_indication` | Condition to generics to brands |
| `semantic_search` | Vector search over the document corpus |
| `hybrid_search` | Vector plus lexical, reciprocal-rank fused |

Each tool returns structured rows plus a citation reference. Answers quote only
what a tool returned.

### Why tools instead of text-to-SQL
Generated SQL against 15 tables with a misspelled join column produces a high
rate of silently wrong answers — a query that runs and returns plausible rows
that answer a different question. Typed tools trade a little flexibility for
answers that fail loudly instead of quietly.

### Retrieval
Documents are split into chunks of roughly 900 characters with 150 characters of
overlap, respecting markdown heading boundaries. Each chunk is embedded to 768
dimensions. Retrieval is cosine similarity, top-k of 6 by default, with a
similarity floor of 0.25 — below the floor a chunk is dropped rather than padded
into the context, because an irrelevant chunk is worse than a short context.

Hybrid search fuses vector results with PostgreSQL full-text results using
reciprocal rank fusion at k=60. RRF is used rather than score normalisation
because cosine scores and ts_rank scores are not on comparable scales.

### Context management
The agent keeps a running budget. Tool results are truncated per-tool before
entering the context: brand rows to 25, monograph text fields to 1200 characters,
document chunks to 6. When the accumulated context exceeds 70% of the model's
input budget, the oldest tool results are summarised into a compact digest and
replaced. The original results remain in the run log, so a truncated answer can
still be audited.

### Single-model versus multi-model
In **single-model** mode one model does routing, tool selection, and synthesis.
In **multi-model** mode the roles are split: a small fast model routes and plans,
a mid model executes tool calls, and a stronger model synthesises the final
answer. Multi-model usually costs less per run and is slower per run; whether it
is more accurate depends on the question mix, which is what the evaluation
harness measures.

## Evaluation

Retrieval and generation are scored separately.

- **Retrieval** — recall@k, precision@k, MRR, nDCG against a gold set of
  question-to-relevant-reference pairs.
- **Routing** — accuracy of the predicted route against the expected route.
- **Generation** — substring assertions on the answer, plus latency and cost.

Every run is persisted, so any two configurations can be diffed after the fact.

## Rate limits and quotas

| Plan | Search/min | Assistant msgs/hr | API req/s |
| --- | --- | --- | --- |
| Anonymous | 30 | 0 | 0 |
| Free account | 60 | 30 | 0 |
| Institutional | 600 | 600 | 10 |

Exceeding a limit returns HTTP 429 with a `Retry-After` header.
