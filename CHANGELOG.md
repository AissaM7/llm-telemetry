# Changelog

All notable changes to `@llm-telemetry/react-native` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-03-13

### Added
- Core tracing: `traceLLM()`, `installFetchInterceptor()`, `RAGPipeline`
- 8 export backends: Loki, OTLP-HTTP, OTLP-gRPC, Datadog, Honeycomb, Supabase, Console, Multi
- LLM-as-judge evaluation pipeline with 6 quality scores (correctness, hallucination, relevance, helpfulness, coherence, grounding)
- Rule-based hallucination pre-scoring (zero API calls)
- 10-second grading timeout to prevent blocked exports
- Batch processor with span deduplication, offline buffer, and exponential backoff retry
- PII sanitizer (email, phone, SSN, credit card, API key, bearer token stripping)
- Session management with 4-hour timeout and AsyncStorage persistence
- W3C Trace Context (`traceparent` / `tracestate`) header injection
- Dynamic platform detection via `Platform.OS`
- Bundled Grafana dashboard JSON for one-click import
- `globalAttributes` config for company-wide span tagging
- `onError` callback for telemetry failure notifications
- Configurable `multi` exporter (choose which backends to combine)
- Config validation with dev-mode warnings
- Cost calculation for 15+ models (GPT-4o/4.1, Claude 3.5/3.7/4, Gemini 2.5, o4-mini)
- 45 unit tests, MIT license
