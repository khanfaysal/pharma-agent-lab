-- =====================================================================
-- 003_agent_schema.sql
-- Observability and evaluation.
--
-- The point of this lab is comparing agent architectures, and you cannot
-- compare what you did not record. Every agent invocation writes one
-- agent_runs row and one agent_steps row per LLM call or tool call, with
-- token counts, latency and cost. The comparison UI and the retrieval
-- evaluator both read from here.
-- =====================================================================

CREATE TABLE agent_runs (
  id            bigserial PRIMARY KEY,
  -- Groups the arms of one A/B comparison so they can be diffed.
  comparison_id text,
  conversation_id text,
  -- 'single' | 'multi' | 'router-only' | 'baseline-no-tools'
  architecture  text NOT NULL,
  -- Human-readable name of the model set, e.g. 'gemini-2.0-flash (solo)'.
  strategy_label text NOT NULL,
  question      text NOT NULL,
  answer        text,
  -- Tools the agent actually invoked, in order.
  tools_used    text[] NOT NULL DEFAULT '{}',
  -- Citations resolved into the final answer.
  citations     jsonb  NOT NULL DEFAULT '[]'::jsonb,
  step_count    integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  -- USD, computed from the per-model rates in apps/api/src/providers/pricing.ts.
  cost_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms    integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'max_steps')),
  error         text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_comparison   ON agent_runs (comparison_id);
CREATE INDEX idx_runs_conversation ON agent_runs (conversation_id);
CREATE INDEX idx_runs_architecture ON agent_runs (architecture);
CREATE INDEX idx_runs_created      ON agent_runs (created_at DESC);

CREATE TABLE agent_steps (
  id            bigserial PRIMARY KEY,
  run_id        bigint NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  step_index    integer NOT NULL,
  -- 'route' | 'plan' | 'llm' | 'tool' | 'synthesize' | 'critique'
  kind          text NOT NULL,
  -- Which role in a multi-model setup produced this step.
  agent_role    text,
  provider      text,
  model         text,
  tool_name     text,
  -- Tool arguments, or the routing decision payload.
  input         jsonb,
  output        jsonb,
  prompt_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms    integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index)
);

CREATE INDEX idx_steps_run ON agent_steps (run_id);

-- ---------------------------------------------------------------------
-- Retrieval evaluation
--
-- A gold set of questions with the chunks/entities that SHOULD be retrieved.
-- Lets us score recall@k, MRR and nDCG for a retrieval config independently
-- of whichever LLM writes the final answer -- retrieval quality and
-- generation quality are separate failure modes and must be measured apart.
-- ---------------------------------------------------------------------

CREATE TABLE eval_cases (
  id             bigserial PRIMARY KEY,
  suite          text NOT NULL DEFAULT 'default',
  question       text NOT NULL,
  -- 'sql' | 'rag' | 'hybrid' -- which tool the agent is expected to reach for.
  expected_route text CHECK (expected_route IN ('sql', 'rag', 'hybrid', 'none')),
  -- Document slugs (RAG) or 'table:pk' strings (SQL) that count as relevant.
  relevant_refs  text[] NOT NULL DEFAULT '{}',
  -- Substrings the answer must contain to be considered correct.
  expected_contains text[] NOT NULL DEFAULT '{}',
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_cases_suite ON eval_cases (suite);

CREATE TABLE eval_results (
  id             bigserial PRIMARY KEY,
  case_id        bigint NOT NULL REFERENCES eval_cases (id) ON DELETE CASCADE,
  run_id         bigint REFERENCES agent_runs (id) ON DELETE SET NULL,
  -- Free-form label for the configuration under test.
  config_label   text NOT NULL,
  retrieved_refs text[] NOT NULL DEFAULT '{}',
  actual_route   text,
  route_correct  boolean,
  recall_at_k    double precision,
  precision_at_k double precision,
  mrr            double precision,
  ndcg           double precision,
  answer_match   boolean,
  latency_ms     integer NOT NULL DEFAULT 0,
  cost_usd       numeric(12, 6) NOT NULL DEFAULT 0,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_results_case   ON eval_results (case_id);
CREATE INDEX idx_eval_results_config ON eval_results (config_label);

-- ---------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------

CREATE VIEW v_architecture_summary AS
SELECT
  architecture,
  strategy_label,
  count(*)                                              AS runs,
  round(avg(latency_ms))                                AS avg_latency_ms,
  round(avg(step_count), 2)                             AS avg_steps,
  round(avg(prompt_tokens + output_tokens))             AS avg_tokens,
  round(avg(cost_usd), 6)                               AS avg_cost_usd,
  round(sum(cost_usd), 4)                               AS total_cost_usd,
  count(*) FILTER (WHERE status <> 'ok')                AS failures
FROM agent_runs
GROUP BY architecture, strategy_label;

CREATE VIEW v_eval_summary AS
SELECT
  r.config_label,
  count(*)                                           AS cases,
  round(avg(r.recall_at_k)::numeric, 3)              AS avg_recall,
  round(avg(r.mrr)::numeric, 3)                      AS avg_mrr,
  round(avg(r.ndcg)::numeric, 3)                     AS avg_ndcg,
  round(avg(CASE WHEN r.route_correct THEN 1 ELSE 0 END)::numeric, 3) AS route_accuracy,
  round(avg(CASE WHEN r.answer_match  THEN 1 ELSE 0 END)::numeric, 3) AS answer_accuracy,
  round(avg(r.latency_ms))                           AS avg_latency_ms,
  round(sum(r.cost_usd), 4)                          AS total_cost_usd
FROM eval_results r
GROUP BY r.config_label;
