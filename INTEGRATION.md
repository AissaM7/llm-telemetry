# @llm-telemetry/react-native — Integration Guide

## 1. Install

```bash
npm install @llm-telemetry/react-native
```

## 2. Initialize (once at app startup)

```typescript
import { initTelemetry } from '@llm-telemetry/react-native';

const { tracer, traceLLM, installFetchInterceptor } = await initTelemetry({
  appId: 'my-app',
  environment: 'production',

  // Loki endpoint
  exporterType: 'loki',
  lokiUrl: 'http://localhost:3100',

  // Optional: LLM-as-judge evaluation
  evaluationEnabled: true,
  evaluationApiKey: 'sk-...',
  evaluationModel: 'gpt-4o-mini',
});
```

## 3. Trace LLM calls

### Option A: Manual tracing (recommended)

Wrap any async function that calls an LLM:

```typescript
const result = await traceLLM({
  fn: async () => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: query }] }),
    });
    return res.json();
  },
  model: 'gpt-4o',
  query: 'What is the weather?',
  extractResponse: (r) => r.choices[0].message.content,
  extractTokens: (r) => ({
    promptTokens: r.usage.prompt_tokens,
    completionTokens: r.usage.completion_tokens,
  }),
});
```

### Option B: Auto-instrumentation

Intercepts all `fetch()` calls to known LLM endpoints automatically:

```typescript
installFetchInterceptor();
```

> When both are active, `traceLLM()` takes priority — the fetch interceptor skips requests already being traced.

## 4. Import the Grafana Dashboard

The SDK ships a pre-built Grafana dashboard:

```typescript
import { GRAFANA_DASHBOARD } from '@llm-telemetry/react-native';

// POST to Grafana API:
await fetch('http://localhost:3000/api/dashboards/db', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <grafana-api-key>' },
  body: JSON.stringify({ dashboard: GRAFANA_DASHBOARD, overwrite: true }),
});
```

Or copy `grafana/dashboard.json` from the package and import it manually in the Grafana UI.

## 5. What gets logged

Each request produces **one** Loki log entry with:

| Field | Description |
|---|---|
| `tokens_prompt` / `tokens_completion` / `tokens_total` | Token counts |
| `cost_total_usd` | Estimated USD cost (auto-calculated from model pricing) |
| `pipeline_duration_ms` | End-to-end latency |
| `evaluation_scores_correctness` | LLM-as-judge correctness score (0–1) |
| `evaluation_scores_relevance` | Relevance score (0–1) |
| `evaluation_scores_hallucination` | Hallucination risk (0–1, lower is better) |
| `evaluation_scores_overall` | Weighted average score |
| `eval_triggered` | `"true"` / `"false"` — stream label for filtering |

## 6. Supported Models (cost calculation)

OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o4-mini`
Anthropic: `claude-4-sonnet`, `claude-3.7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`
Google: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`

Unrecognized models fall back to GPT-4o pricing with a dev-mode warning.

## Safety Guarantees

- **Never throws** — all telemetry is wrapped in try/catch
- **Never blocks the UI** — tracing runs in the background after `fn()` returns
- **10s grading timeout** — slow LLM-as-judge calls don't block span export
- **No duplicate logs** — `traceLLM()` and the fetch interceptor coordinate to emit exactly one log per request
