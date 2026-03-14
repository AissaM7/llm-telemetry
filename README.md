# @llm-telemetry/react-native

**Production-ready, provider-agnostic LLM observability SDK for React Native.**

Turn every LLM interaction into an OpenTelemetry trace with latency, token usage, RAG quality metrics, and automated evaluation scores — exported to Grafana Tempo, Loki, Datadog, Honeycomb, or any OTLP-compatible backend.

## Features

- 🔭 **OpenTelemetry native** — W3C trace context, OTLP JSON export
- 🤖 **Provider agnostic** — OpenAI, Anthropic, Gemini, Mistral, Cohere, custom APIs
- 📱 **React Native first** — No Node.js builtins, works with Hermes
- 🔒 **Privacy built-in** — PII scrubbing, prompt truncation, system prompt hashing
- 📊 **Auto-evaluation** — Correctness, hallucination, relevance, grounding scores
- 🔄 **RAG pipeline tracing** — Embedding → search → context → LLM as child spans
- 📡 **Multi-backend** — Grafana Tempo, Loki, Datadog, Honeycomb, console
- 💾 **Offline resilient** — AsyncStorage buffering with exponential retry
- 🚀 **Zero-code option** — `installFetchInterceptor()` auto-instruments all LLM calls
- 🌳 **Tree-shakeable** — Import only what you use

---

## Installation

```bash
npm install @llm-telemetry/react-native
# or
yarn add @llm-telemetry/react-native
```

### Peer Dependencies

```bash
npm install @react-native-async-storage/async-storage
# Optional:
npm install react-native-device-info
```

---

## Quick Start (5 lines)

```typescript
import { initTelemetry, traceLLM } from '@llm-telemetry/react-native';

// 1. Initialize once at app startup
await initTelemetry({
  exporterType: 'otlp-http',
  collectorUrl: 'http://your-tempo:4318',
});

// 2. Wrap any LLM call
const result = await traceLLM({
  fn: () => openai.chat.completions.create({ model: 'gpt-4o', messages }),
  model: 'gpt-4o',
  provider: 'openai',
  extractResponse: (r) => r.choices[0].message.content,
  extractTokens: (r) => ({
    promptTokens: r.usage.prompt_tokens,
    completionTokens: r.usage.completion_tokens,
  }),
});
```

---

## Configuration Reference

```typescript
interface LLMTelemetryConfig {
  // Required
  exporterType: 'otlp-http' | 'otlp-grpc' | 'datadog' | 'honeycomb' | 'loki' | 'console';
  collectorUrl: string;

  // Identity
  serviceName?: string;       // default: 'llm-app'
  serviceVersion?: string;    // default: '1.0.0'
  appId?: string;
  environment?: string;       // 'production' | 'staging' | 'development'

  // Auth
  apiKey?: string;
  headers?: Record<string, string>;

  // Behavior
  enabled?: boolean;          // default: true
  sampleRate?: number;        // 0.0-1.0, default: 1.0
  batchSize?: number;         // default: 10
  flushIntervalMs?: number;   // default: 30000
  maxQueueSize?: number;      // default: 100

  // Evaluation
  evaluationEnabled?: boolean;  // default: true
  evaluationAsync?: boolean;    // default: true
  evaluationModel?: string;     // default: 'gpt-4o'
  evaluationApiKey?: string;
  evaluationEndpoint?: string;

  // Privacy
  sanitizePrompts?: boolean;    // default: true
  maxPromptLength?: number;     // default: 500
  stripPII?: boolean;           // default: true

  // Loki
  lokiUrl?: string;
  lokiLabels?: Record<string, string>;
}
```

---

## Usage Examples

### a. `traceLLM()` — Universal Wrapper

```typescript
import { traceLLM } from '@llm-telemetry/react-native';

const response = await traceLLM({
  fn: () => myCustomLLM.ask(query),
  model: 'my-model-v2',
  provider: 'custom',
  messages: [{ role: 'user', content: query }],
  extractResponse: (r) => r.text,
  extractTokens: (r) => ({
    promptTokens: r.tokenCount.input,
    completionTokens: r.tokenCount.output,
  }),
  ragContext: {
    query,
    documents: retrievedDocs,
    searchStrategy: 'hybrid',
  },
});
```

### b. `instrumentOpenAI()` — Auto-Instrument OpenAI SDK

```typescript
import OpenAI from 'openai';
import { instrumentOpenAI, initTelemetry } from '@llm-telemetry/react-native';

await initTelemetry({ exporterType: 'otlp-http', collectorUrl: '...' });
const openai = instrumentOpenAI(new OpenAI({ apiKey: '...' }));

// All calls are now auto-traced — no other changes needed
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### c. `instrumentAnthropic()` — Auto-Instrument Anthropic SDK

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { instrumentAnthropic } from '@llm-telemetry/react-native';

const anthropic = instrumentAnthropic(new Anthropic({ apiKey: '...' }));

const message = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### d. `installFetchInterceptor()` — Zero-Code Auto-Instrument

```typescript
import { initTelemetry, installFetchInterceptor, LLMTracer } from '@llm-telemetry/react-native';

const { tracer } = await initTelemetry({ exporterType: 'console', collectorUrl: '' });

// Auto-detect ALL LLM API calls via fetch — zero code changes
const uninstall = installFetchInterceptor(tracer);

// Every fetch to api.openai.com, api.anthropic.com, etc. is now traced
```

### e. `RAGPipeline` — Full RAG Tracing

```typescript
import { RAGPipeline } from '@llm-telemetry/react-native';

const pipeline = new RAGPipeline({ query: 'events this weekend' });

const embedding = await pipeline.traceEmbedding(
  () => openai.embeddings.create({ model: 'text-embedding-3-small', input: query }),
  { model: 'text-embedding-3-small', inputLength: query.length }
);

const results = await pipeline.traceVectorSearch(
  () => supabase.rpc('match_events', { query_embedding: embedding }),
  { strategy: 'hybrid', threshold: 0.7 }
);

const { contextString } = pipeline.traceContextBuild(results);

const answer = await pipeline.traceLLMCompletion(
  () => openai.chat.completions.create({ model: 'gpt-4o', messages: [...] })
);

pipeline.end();
```

---

## Grafana Tempo Setup

Use the included `docker-compose.grafana.yml` for a local observability stack:

```bash
docker-compose -f docker-compose.grafana.yml up -d
```

This starts:
- **Grafana** on `localhost:3000`
- **Tempo** on `localhost:4318` (OTLP HTTP)
- **Loki** on `localhost:3100`

Configure your SDK:

```typescript
await initTelemetry({
  exporterType: 'otlp-http',
  collectorUrl: 'http://localhost:4318',
  lokiUrl: 'http://localhost:3100',
});
```

---

## Trace Correlation

The SDK injects W3C `traceparent` headers into outgoing requests, enabling end-to-end correlation:

```
Mobile App → Backend API → LLM Provider
    │              │            │
    └── traceparent header ────┘
```

Your backend can read the `traceparent` header and create child spans, linking the entire request lifecycle into a single trace visible in Grafana Tempo.

---

## Evaluation Scores

| Metric | Range | Meaning |
|---|---|---|
| `correctness` | 0-1 | Did the AI accurately answer? |
| `hallucination` | 0-1 | Higher = more fabricated facts |
| `relevance` | 0-1 | Were retrieved docs relevant? |
| `helpfulness` | 0-1 | Was the response actionable? |
| `coherence` | 0-1 | Was it well-structured? |
| `grounding` | 0-1 | Was it supported by context? |

Evaluation runs in two stages:
1. **Rule-based pre-score** — instant, no API call (token overlap + claim extraction)
2. **LLM-as-judge** — async, calls any OpenAI-compatible endpoint for deeper analysis

---

## Privacy & Sanitization

- **PII stripping**: Emails, phone numbers, credit cards, SSNs, API keys, bearer tokens
- **Prompt truncation**: Configurable max length (default 500 chars)
- **System prompt hashing**: Only a hash is exported, never the raw system prompt
- **Configurable**: Disable any privacy feature via config

---

## License

MIT
