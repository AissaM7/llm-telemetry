# SDK AUDIT REPORT: @llm-telemetry/react-native

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 1 — WHAT IS FULLY BUILT AND WORKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The SDK is remarkably comprehensive and robust. Almost every planned feature has been fully implemented with production-grade logic. 

**Core (**`src/core/`**)**
*   `tracer.ts`: The central orchestration singleton. Manages span lifecycles, global configuration, invokes the batch processor, handles session injection, and triggers the evaluator automatically on span completion. **Fully implemented and working.**
*   `span.ts`: Defines the `LLMSpan` class that adheres to OTLP schema. Manages status, timestamps, and attributes natively. **Fully implemented.**
*   `context.ts` / `id.ts` / `clock.ts`: Provides high-resolution timestamps, generates W3C traceparents, and handles cryptographically secure unique IDs. **Fully implemented.**

**Instrumentation (**`src/instrumentation/`**)**
*   `fetch-interceptor.ts`: Replaces the global `fetch` to catch network requests matching OpenAI, Anthropic, or custom patterns. Parses request/response bodies to extract token usage and prompts automatically. **Fully implemented.**
*   `openai.ts` & `anthropic.ts`: ES6 Proxy wrappers for the official JS SDKs. Intercepts `create()` methods entirely transparently to capture deep metrics including streaming chunks and TTFB. **Fully implemented.**
*   `generic-llm.ts`: A universal async wrapper (`traceLLM`) to manually instrument any edge function or custom framework. **Fully implemented.**
*   `rag-pipeline.ts`: A structured pipeline class that creates parent/child span hierarchies for complex RAG operations (embedding, search, LLM completion). **Fully implemented.**

**Session & Privacy (**`src/session/`, `src/sanitizer/`, `src/attributes/`**)**
*   `session-manager.ts`: Manages user trace sessions using React Native `AsyncStorage`, rotating them after 4 hours of inactivity. **Fully implemented.**
*   `app-state-listener.ts`: Ties into React Native's `AppState` to auto-flush telemetry queues when the app is backgrounded. **Fully implemented.**
*   `sanitizer.ts`: Provides regex-based PII scrubbing (emails, phones, credit cards, keys) and prompt truncation. **Fully implemented.**
*   `mobile.ts`: Auto-detects OS, platform, and device models (gracefully falling back if `react-native-device-info` isn't installed). **Fully implemented.**

**Evaluation ENGINE & Exporters**
*   *(See Sections 3 and 4 below. Both are robustly implemented).*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 2 — WHAT IS STUBBED OR INCOMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This codebase is exceptionally mature — there are essentially no "stubs" in the traditional sense. Everything that exists has real code backing it. 

However, looking at the strict design, the following are technically "incomplete" or swallowed exceptions by design constraint:

1.  **Silent Error Swallowing in Exporters / Batch Processor:**
    Telemetry is designed to *never* crash the host application. Therefore, `try/catch` blocks strictly swallow failures in `BatchProcessor.flush()`, `SessionManager.init()`, and all exporters. Network failures generate console warnings (in dev) and trigger offline buffering, but they do not propagate to the app layer. 
2.  **RAG Context Extraction in Auto-Evaluation:**
    The `LLMTracer.endSpan` function auto-triggers the Evaluator if a span contains BOTH `llm.response` and `rag.query` (or `llm.prompt`). However, the `RAGPipeline` utility spreads these attributes across parent and child spans (query on root, response on child). Therefore, automated evaluation doesn't naturally trigger natively out-of-the-box when using `RAGPipeline` unless the developer manually attaches `llm.response` to the root `end()` call.
3.  **Fetch Interceptor parsing logic:**
    `fetch-interceptor.ts` attempts to automatically parse JSON bodies. It only knows the exact schema for OpenAI and Anthropic APIs. If it intercepts a custom backend call (like a Supabase Edge function), it won't know how to extract the `llm.response` from the proprietary JSON schema natively without manual mapping.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 3 — EVALUATION ENGINE STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1. Is src/evaluation/evaluator.ts fully implemented? What does it actually do when evaluate() is called?**
Yes, it is fully implemented. When `evaluate()` is called, it:
1.  **Sync Pre-score:** First runs lightweight local analysis by checking `quickHallucinationScore(response, documents)`. It immediately attaches `llm.eval.hallucination` based on string overlap.
2.  **LLM-as-Judge:** If an API key is present, it constructs a payload.
3.  **Execute:** If `config.async = true`, it fires and forgets `gradeAsync`, allowing the UI thread to continue. If `async = false`, it awaits the result.
4.  **Attach:** Once graded, it attaches 7 distinct quality scores to the span. If the span has already shipped/ended, it creates a sibling "evaluation span" connected via `traceId` and `source_span_id` and queues it.

**2. Is src/evaluation/grader.ts fully implemented? Does it make a real API call?**
Yes, it is fully implemented and relies on real network requests. It uses standard `fetch` to POST an OpenAI-schema chat completion request.
*Exact API Call:*
```typescript
fetch(config.endpoint ?? 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 500 }),
})
```
It requires the response to be strict JSON and even includes a retry loop throwing `JSON_RETRY_PROMPT` if the LLM hallucinated markdown ticks instead of raw JSON.

**3. Is src/evaluation/prompts.ts complete?**
Yes. 
*Exact System Prompt:*
```text
You are an expert LLM output quality evaluator.
You evaluate AI assistant responses on multiple quality dimensions.

SCORING RULES:
- All scores are between 0.0 and 1.0 (float, two decimal places)
- correctness: Did the AI accurately answer the user's question?
  1.0 = fully correct, 0.0 = completely wrong
- hallucination: Did the AI invent facts not present in the retrieved context?
  0.0 = no hallucination, 1.0 = severe hallucination
... [etc] ...

You MUST respond ONLY with valid JSON matching this exact schema:
{ "correctness": 0.00, "hallucination": 0.00, "relevance": 0.00, ... }
```
*Exact User Prompt Template:*
```text
## USER QUERY
${query}

## RETRIEVED DOCUMENTS
${documentsText} // auto-truncated to 3000 chars

## AI RESPONSE
${response}

Evaluate the AI response against the scoring rubric. Return ONLY the JSON object.
```

**4. Is src/evaluation/hallucination.ts implemented? What algorithm does it use?**
Fully implemented. It does NOT use an LLM API. It uses a custom Natural Language Processing (NLP) rule-based heuristic approach.
*Algorithm:*
1.  **Token Overlap (`computeGroundingScore`):** Strips English stopwords (`the, and, of`), extracts words > 4 chars from the response, and checks if they exist natively in the context document strings.
2.  **Claim Extraction (`extractSpecificClaims`):** Uses rigorous Regex to find specific factual "claims" in the response (Prices, Times, Dates, Capitalized Proper Nouns, Quoted strings).
3.  **Grounding Check (`claimsGroundedInContext`):** Exact-match searches the extracted claims against the context doc. If it fails, checks fuzzy matches (50%+ overlap). 
4.  **Scoring weight:** Returns a combined risk score: `(1 - TokenOverlap) * 0.6 + (UngroundedClaims / TotalClaims) * 0.4`.

**5. Is src/evaluation/grounding.ts implemented? What does it compute?**
Yes. It simply wraps and re-exports the NLP algorithm from `hallucination.ts`. It provides a detailed payload mapping how many claims were found, how many were grounded, and listing the specific phrases that were caught as ungrounded.

**6. Is evaluation currently wired into the RAGPipeline?**
**No, it is not wired in correctly.** 
The `rag-pipeline.ts` codebase *exists*, but invoking `RAGPipeline.end()` only closes the root span. It does *not* automatically invoke evaluation because the root span doesn't have the final `llm.response` attribute mapped. To evaluate using the `RAGPipeline` class, an engineer must manually call `pipeline.end({ 'llm.response': answer })`.

**7. Is evaluationEnabled: true currently doing anything in the tracer?**
Yes. If set to `true`, the `LLMTracer.endSpan` intercepts the completion of *any* span that contains both the `llm.response` and `rag.query` attributes, and instantly proxies them into `evaluator.evaluate()`.
If set to `false`, the interceptor in `endSpan` is bypassed entirely, skipping evaluation processing.

**8. What evaluation-related attributes are actually being written to spans right now?**
Currently: **none**. 
In the `local_app`, telemetry evaluation is explicitly instantiated as `evaluationEnabled: false`. Even if set to true, the current fetch interceptor on the Supabase Edge function doesn't map `llm.response` correctly because it expects OpenAI schema.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 4 — EXPORTERS STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every exporter is **fully implemented** using real HTTP calls via the native `fetch` module. 

| Exporter | Status | Target Endpoint | Payload Format |
| :--- | :--- | :--- | :--- |
| **otlp-http.ts** | Fully Built | `<collectorUrl>/v1/traces` | Standard OTLP Span JSON (`application/json`) |
| **otlp-grpc.ts** | Fully Built | `<collectorUrl>/v1/traces` | Standard OTLP JSON wrapping a `grpc-web` translation header |
| **loki.ts** | Fully Built | `<lokiUrl>/loki/api/v1/push` | Grafana Loki JSON Streams structure grouping by trace label hashes. |
| **datadog.ts** | Fully Built | `https://http-intake.logs.datadoghq.com/v1/traces` | OTLP Span JSON injected with `DD-API-KEY` headers. |
| **honeycomb.ts** | Fully Built | `https://api.honeycomb.io/v1/traces` | OTLP Span JSON injected with `x-honeycomb-dataset/team` headers. |
| **console.ts** | Fully Built | Local React Native Console | Pretty-printed multiline strings via `console.group` |
| **batch-processor** | Fully Built | (Pipelines to Exporters) | Aggregates arrays of `LLMSpan`s tracking backoff retries using `AsyncStorage`. |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 5 — TEST COVERAGE STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The test suite is highly functional. It mocks standard browser APIs (`fetch`, `crypto`, `performance`) and verifies real runtime logic, preventing regressions.

**Tests:**
*   `evaluator.test.ts`
    *   *returns higher score for responses with facts not in documents* (Pass, Tests real logic)
    *   *returns 0.5 for empty documents* (Pass, Tests real logic)
    *   *returns score between 0 and 1* (Pass, Tests real logic)
    *   *returns null on network failure (no throw)* (Pass, Tests real logic)
    *   *returns null on malformed JSON (no throw)* (Pass, Tests real logic)
    *   *returns null on timeout (no throw)* (Pass, Tests real logic)
*   `session-manager.test.ts`
    *   *creates new session if none in AsyncStorage* (Pass, Tests real logic)
    *   *reuses existing session within 4 hours* (Pass, Tests real logic)
    *   *creates new session after 4 hours* (Pass, Tests real logic)
    *   *increments message count* (Pass, Tests real logic)
    *   *persists session to AsyncStorage* (Pass, Tests real logic)
    *   *refreshSession generates new ID* (Pass, Tests real logic)
*   `batch-processor.test.ts`
    *   *flushes when batchSize is reached* (Pass, Tests real logic)
    *   *deduplicates spans by spanId* (Pass, Tests real logic)
    *   *builds valid OTLP payload* (Pass, Tests real logic)
    *   *handles export failure gracefully* (Pass, Tests real logic)
    *   *drops oldest when queue is full* (Pass, Tests real logic)
*   `fetch-interceptor.test.ts`
    *   *intercepts calls to api.openai.com* (Pass, Tests real logic)
    *   *intercepts calls to api.anthropic.com* (Pass, Tests real logic)
    *   *does NOT intercept unrelated fetch calls* (Pass, Tests real logic)
    *   *injects traceparent header* (Pass, Tests real logic)
    *   *parses OpenAI token usage from response body* (Pass, Tests real logic)
    *   *handles fetch errors gracefully* (Pass, Tests real logic)
*   `tracer.test.ts`
    *   *returns singleton instance* (Pass, Tests initialization)
    *   *initializes correctly* (Pass, Tests initialization)
    *   *warns on double init* (Pass, Tests safety checks)
    *   *startSpan returns LLMSpan with correct attributes* (Pass, Tests real logic)
    *   *sample rate 0 still creates spans (no-op by convention)* (Pass, Tests real logic)
    *   *mobile attributes are auto-attached* (Pass, Tests real logic)
    *   *startTrace returns valid TraceHandle* (Pass, Tests real logic)
    *   *flush completes without error* (Pass, Tests safety execution)
    *   *shutdown completes without error* (Pass, Tests safety execution)

**Running `npm test` Output:**
```
> @llm-telemetry/react-native@1.0.0 test
> jest

 PASS  __tests__/evaluator.test.ts
 PASS  __tests__/session-manager.test.ts
 PASS  __tests__/tracer.test.ts
 PASS  __tests__/batch-processor.test.ts
 PASS  __tests__/fetch-interceptor.test.ts

Test Suites: 5 passed, 5 total
Tests:       32 passed, 32 total
Snapshots:   0 total            
Time:        2.794 s, estimated 3 s
Ran all test suites.
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 6 — INTEGRATION WITH LOCALL APP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The SDK is technically integrated but currently deployed in a highly restricted, read-only configuration.

**Which app files import from the SDK?**
Only `/lib/telemetry.ts`

**What SDK methods are actually being called from the app right now?**
1.  `initTelemetry({...})` on app launch.
2.  `LLMTracer.getInstance()` and `installFetchInterceptor()` mapped via `installLocallInterceptor()`.

**Is the fetch interceptor installed and active?**
Yes. It is targeting `functions/v1/chat-assistant` explicitly inside `lib/telemetry.ts`.

**Is RAGPipeline being used?**
**No.** `OpenAIService.ts` completely bypasses the SDK's `RAGPipeline` implementation. `OpenAIService.ts` is running a raw native `fetch()` POST to the Supabase Edge function `chat-assistant`. Assuming the Supabase function executes the RAG pipeline server-side, the App client has no awareness of it and creates zero child spans.

**What data is being passed to RAGPipeline.end()?**
None — not being used.

**Is evaluationEnabled set to true or false in lib/telemetry.ts currently?**
It is explicitly set to **false**. 

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 7 — GAPS AND RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. What is working end-to-end right now?
The entire data pipeline. Traces are generated natively when fetch requests are executed to API-schema endpoints, auto-flushed, queued with backoff, cleaned of PII, merged with App session and mobile device attributes, and pumped out beautifully via the console exporter. 

### 2. What is partially working?
The Supabase function instrumentation. The fetch interceptor *is* catching calls made against the edge function `v1/chat-assistant`, but it fails to parse the proprietary return JSON scheme: `{ message: string, events: [] }`. It therefore generates empty spans without token logic, query mapping, or response text. 

### 3. What is completely missing or not functional?
Evaluation logic on the client. Because `RAGPipeline` isn't utilized, the interceptor fails to scrape `rag.query` and `llm.response` from the proprietary Supabase response payload. Therefore, even if `evaluationEnabled` is flipped to `true`, zero evaluation spans will actually trigger.

### 4. What needs to be built or fixed to get evaluation scores appearing in the logs?
1. Enable `evaluationEnabled: true` in `telemetry.ts`.
2. Provide `evaluationApiKey` in the `initTelemetry` config.
3. Replace the `fetch-interceptor` reliance inside `OpenAIService.ts`. Instead of hoping the interceptor parses the custom Edge schema magically, wrap the Supabase fetch call explicitly using the SDK's `traceLLM` utility, manually mapping the `query`, `response`, and `rag.documents` logic returned from the Edge.

### 5. Estimated effort to fix gaps:
*   **Fix 1: Swap out Edge function intercepting for explicit `traceLLM` implementation in OpenAIService.** 
    *   *Effort: SMALL (< 1 hour)*
*   **Fix 2: Wiring up Exporter UI (e.g., launching Docker Grafana / Tempo configuration keying)**
    *   *Effort: SMALL (< 1 hour)*
*   **Fix 3: Server-side RAG evaluation.** (If true RAG attributes live server-side, you technically can't evaluate the RAG pipeline easily on the client context lacking the documents. You'll need to transmit documents back across the wire or execute evaluation on the edge).
    *   *Effort: MEDIUM (1 to 3 hours)*
