# Grafana Dashboard Panels for Locall LLM Telemetry

Ready-to-paste LogQL queries for Grafana dashboards on Loki data.

## Prerequisites

- The SDK is configured with `exporterType: 'loki'` pointing to your Grafana Loki instance
- Logs are flowing to Loki with the stream labels: `app`, `env`, `platform`, `model`, `event`, `eval_triggered`

---

## Panel 1 — Token Usage Over Time

Tracks total tokens consumed per model per hour.

### LogQL Query

```logql
sum by (model) (
  sum_over_time(
    {app="locall", event="llm_trace"}
    | json
    | unwrap tokens_total [1h]
  )
)
```

### Panel Settings

| Setting | Value |
|---------|-------|
| Type | Time series |
| Legend | `{{model}}` |
| Unit | `short` |
| Draw style | Bars |

### Variant — Prompt vs Completion Breakdown

```logql
# Prompt tokens
sum by (model) (
  sum_over_time(
    {app="locall", event="llm_trace"} | json | unwrap tokens_prompt [1h]
  )
)

# Completion tokens
sum by (model) (
  sum_over_time(
    {app="locall", event="llm_trace"} | json | unwrap tokens_completion [1h]
  )
)
```

---

## Panel 2 — Evaluation Scores Trend

Shows average evaluation scores over 6-hour windows.

### LogQL Query

```logql
# Hallucination score (lower is better)
avg_over_time(
  {app="locall", event="llm_trace", eval_triggered="true"}
  | json
  | unwrap evaluation_scores_hallucination [6h]
)

# Correctness score
avg_over_time(
  {app="locall", event="llm_trace", eval_triggered="true"}
  | json
  | unwrap evaluation_scores_correctness [6h]
)

# Relevance score
avg_over_time(
  {app="locall", event="llm_trace", eval_triggered="true"}
  | json
  | unwrap evaluation_scores_relevance [6h]
)

# Overall score
avg_over_time(
  {app="locall", event="llm_trace", eval_triggered="true"}
  | json
  | unwrap evaluation_scores_overall [6h]
)
```

### Panel Settings

| Setting | Value |
|---------|-------|
| Type | Time series |
| Max | `1.0` |
| Min | `0.0` |
| Thresholds | `0.5` (warning), `0.8` (ok) |

### Alert: High Hallucination

```logql
avg_over_time(
  {app="locall", event="llm_trace", eval_triggered="true"}
  | json
  | unwrap evaluation_scores_hallucination [1h]
) > 0.3
```

---

## Panel 3 — AI Spend (USD)

Tracks cumulative LLM API cost per day.

### LogQL Query

```logql
sum(
  sum_over_time(
    {app="locall", event="llm_trace"}
    | json
    | unwrap cost_total_usd [1d]
  )
)
```

### Panel Settings

| Setting | Value |
|---------|-------|
| Type | Stat |
| Unit | `currencyUSD` |
| Color mode | Background, thresholds-based |
| Thresholds | `0` (green), `5` (yellow), `50` (red) |

### Variant — Cost by Model

```logql
sum by (model) (
  sum_over_time(
    {app="locall", event="llm_trace"}
    | json
    | unwrap cost_total_usd [1d]
  )
)
```

### Variant — Hourly Burn Rate

```logql
sum(
  sum_over_time(
    {app="locall", event="llm_trace"}
    | json
    | unwrap cost_total_usd [1h]
  )
)
```

---

## Bonus Panel — Pipeline Latency

```logql
avg_over_time(
  {app="locall", event="llm_trace"}
  | json
  | unwrap pipeline_duration_ms [1h]
)
```

| Setting | Value |
|---------|-------|
| Type | Time series |
| Unit | `ms` |
| p95 | Use `quantile_over_time(0.95, ...)` |

---

## Log Explorer

To browse individual traces:

```logql
{app="locall", event="llm_trace"} | json
```

Filter by model:

```logql
{app="locall", event="llm_trace", model="gpt-4o-2024-08-06"} | json
```

Filter by high hallucination:

```logql
{app="locall", event="llm_trace", eval_triggered="true"}
| json
| evaluation_scores_hallucination > 0.3
```
