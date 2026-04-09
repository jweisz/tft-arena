"""Inference runtime snapshot helpers for websocket telemetry."""

from __future__ import annotations

from typing import Any


def _base_process(
    *,
    process_id: str,
    process_kind: str,
    process_label: str,
    provider: str,
    model: str,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    previous = previous or {}
    return {
        "process_id": process_id,
        "process_kind": process_kind,
        "process_label": process_label,
        "provider": provider,
        "model": model,
        "loaded": True,
        "active": bool(previous.get("active", False)),
        "tokens_per_sec": previous.get("tokens_per_sec"),
    }


def sync_loaded_processes(
    *,
    active_agents: list[dict[str, Any]],
    non_agent_provider: str,
    non_agent_model: str,
    existing: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Return a fresh process map preserving runtime fields for unchanged process IDs."""
    existing = existing or {}
    synced: dict[str, dict[str, Any]] = {}

    synced["router"] = _base_process(
        process_id="router",
        process_kind="router",
        process_label="Router",
        provider=non_agent_provider,
        model=non_agent_model,
        previous=existing.get("router"),
    )
    synced["semantic"] = _base_process(
        process_id="semantic",
        process_kind="semantic",
        process_label="Summarizer",
        provider=non_agent_provider,
        model=non_agent_model,
        previous=existing.get("semantic"),
    )

    for agent in active_agents:
        process_id = f"agent:{agent['name']}"
        synced[process_id] = _base_process(
            process_id=process_id,
            process_kind="agent",
            process_label=f"Agent: {agent['name']}",
            provider=agent.get("provider", ""),
            model=agent.get("model", ""),
            previous=existing.get(process_id),
        )

    return synced


def set_process_runtime(
    processes: dict[str, dict[str, Any]],
    process_id: str,
    *,
    active: bool,
    tokens_per_sec: float | None = None,
) -> None:
    process = processes.get(process_id)
    if not process:
        return

    process["active"] = active
    process["tokens_per_sec"] = tokens_per_sec


def ordered_processes(processes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    order = {"router": 0, "semantic": 1, "agent": 2}
    return sorted(
        processes.values(),
        key=lambda process: (
            order.get(process.get("process_kind", "agent"), 9),
            process.get("process_label", ""),
        ),
    )


def compute_tokens_per_second(tokens_used: int | float | None, latency_ms: int | float | None) -> float | None:
    if tokens_used is None or latency_ms is None:
        return None

    try:
        tokens = float(tokens_used)
        latency_seconds = float(latency_ms) / 1000.0
    except (TypeError, ValueError):
        return None

    if tokens <= 0 or latency_seconds <= 0:
        return None

    return round(tokens / latency_seconds, 2)
