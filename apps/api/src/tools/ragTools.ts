import { config } from '../config.js';
import { hybridSearch, lexicalSearch, semanticSearch, type RetrievedChunk } from '../vector/store.js';
import { type AgentTool, type ToolResult, asInt, asString, asStringArray } from './types.js';

const SOURCE_TYPES = ['policy', 'terms', 'faq', 'docs', 'website', 'generic_monograph'];

function toResult(chunks: RetrievedChunk[], label: string): ToolResult {
  if (!chunks.length) {
    return {
      summary: `No passages in the document corpus matched ${label}. `
        + 'Do not answer from prior knowledge -- say the documents do not cover it.',
      data: [],
      citations: [],
      empty: true,
    };
  }

  return {
    summary: `${chunks.length} passage(s) retrieved for ${label}. `
      + `Top match: "${chunks[0]!.title}" (score ${chunks[0]!.score.toFixed(3)}).`,
    data: chunks.map((c) => ({
      slug: c.slug,
      title: c.title,
      heading: c.heading,
      source_type: c.sourceType,
      score: Number(c.score.toFixed(4)),
      matched_by: c.matchedBy,
      content: c.content,
    })),
    citations: chunks.map((c) => ({
      kind: 'doc' as const,
      ref: c.slug,
      label: c.heading ? `${c.title} - ${c.heading}` : c.title,
      uri: c.uri,
    })),
  };
}

const semanticSearchTool: AgentTool = {
  group: 'rag',
  schema: {
    name: 'semantic_search',
    description:
      'Vector search over the published documents: privacy policy, terms & conditions, FAQ, product '
      + 'documentation and website pages. Use for questions about how the service works, what is '
      + 'allowed, data handling, retention, rate limits and support. Retrieves by meaning, so the '
      + "user's wording need not match the document's.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question, in natural language. Do not reduce it to keywords.' },
        source_types: {
          type: 'array',
          items: { type: 'string', enum: SOURCE_TYPES },
          description: 'Optional filter, e.g. ["policy","terms"] for a legal question.',
        },
        top_k: { type: 'integer', description: 'Passages to retrieve, 1-20. Default 6.' },
      },
      required: ['query'],
    },
  },

  async run(args) {
    const q = asString(args.query);
    if (!q) return toResult([], 'an empty query');
    const chunks = await semanticSearch(q, {
      topK: asInt(args.top_k, config.agent.ragTopK, { max: 20 }),
      sourceTypes: asStringArray(args.source_types),
    });
    return toResult(chunks, `"${q}"`);
  },
};

const hybridSearchTool: AgentTool = {
  group: 'rag',
  schema: {
    name: 'hybrid_search',
    description:
      'Search the documents using BOTH vector similarity and keyword matching, fused by reciprocal '
      + 'rank. Prefer this over semantic_search when the question contains exact terms that must '
      + 'appear verbatim -- a section name, an email address, a number, a product term. Vector search '
      + 'alone can miss a rare literal token.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question, in natural language.' },
        source_types: {
          type: 'array',
          items: { type: 'string', enum: SOURCE_TYPES },
          description: 'Optional source filter.',
        },
        top_k: { type: 'integer', description: 'Passages to retrieve, 1-20. Default 6.' },
      },
      required: ['query'],
    },
  },

  async run(args) {
    const q = asString(args.query);
    if (!q) return toResult([], 'an empty query');
    const chunks = await hybridSearch(q, {
      topK: asInt(args.top_k, config.agent.ragTopK, { max: 20 }),
      sourceTypes: asStringArray(args.source_types),
    });
    return toResult(chunks, `"${q}" (hybrid)`);
  },
};

const keywordSearchTool: AgentTool = {
  group: 'rag',
  schema: {
    name: 'keyword_search',
    description:
      'Full-text keyword search over the documents, with no vector component. Use as a fallback when '
      + 'semantic search returns nothing and you need to confirm whether a literal phrase appears at all.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords or a quoted phrase.' },
        top_k: { type: 'integer', description: 'Passages to retrieve, 1-20. Default 6.' },
      },
      required: ['query'],
    },
  },

  async run(args) {
    const q = asString(args.query);
    if (!q) return toResult([], 'an empty query');
    const chunks = await lexicalSearch(q, {
      topK: asInt(args.top_k, config.agent.ragTopK, { max: 20 }),
    });
    return toResult(chunks, `"${q}" (keyword)`);
  },
};

export const ragTools: AgentTool[] = [semanticSearchTool, hybridSearchTool, keywordSearchTool];
