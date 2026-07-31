#!/usr/bin/env python3
"""Production-like smoke runner for `/api/scales/*` endpoints."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

DEFAULT_BASE_URL = "http://127.0.0.1:5001"
DEFAULT_ORIGIN = "http://127.0.0.1:5001"
DEFAULT_TIMEOUT_SEC = 3.0
DEFAULT_READ_TIMEOUT_MS = 1000

SENSITIVE_KEY_TOKENS = (
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "authorization",
    "cookie",
    "host",
    "ip",
    "port",
    "tty",
    "com",
    "serial",
    "connection",
    "login",
    "username",
    "user",
)


@dataclass
class StepResult:
    """Captured response details for one smoke step."""

    name: str
    method: str
    path: str
    ok: bool
    status_code: int | None
    body: Any
    error: str | None
    elapsed_ms: int


def redact_sensitive(value: Any) -> Any:
    """Recursively redact values that may contain sensitive connection data."""

    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, nested in value.items():
            lowered = key.lower()
            if any(token in lowered for token in SENSITIVE_KEY_TOKENS):
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = redact_sensitive(nested)
        return redacted

    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]

    if isinstance(value, str):
        lower = value.lower()
        if "/dev/tty" in lower or "com" in lower or "token" in lower:
            return "***REDACTED***"
        return value

    return value


def _safe_json(response: requests.Response) -> Any:
    """Parse JSON body or return plain text for non-JSON responses."""

    try:
        return response.json()
    except ValueError:
        text = response.text.strip()
        return {"raw_text": text} if text else None


def _request_step(
    *,
    name: str,
    method: str,
    base_url: str,
    path: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None,
    timeout_sec: float,
) -> StepResult:
    """Perform one HTTP request and normalize the result."""

    url = f"{base_url.rstrip('/')}{path}"
    started = datetime.now(tz=timezone.utc)
    try:
        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            json=payload,
            timeout=timeout_sec,
        )
        elapsed_ms = int((datetime.now(tz=timezone.utc) - started).total_seconds() * 1000)
        body = redact_sensitive(_safe_json(response))
        ok = 200 <= response.status_code < 300
        return StepResult(
            name=name,
            method=method,
            path=path,
            ok=ok,
            status_code=response.status_code,
            body=body,
            error=None,
            elapsed_ms=elapsed_ms,
        )
    except requests.RequestException as error:
        elapsed_ms = int((datetime.now(tz=timezone.utc) - started).total_seconds() * 1000)
        return StepResult(
            name=name,
            method=method,
            path=path,
            ok=False,
            status_code=None,
            body=None,
            error=str(error),
            elapsed_ms=elapsed_ms,
        )


def build_report(
    *,
    run_label: str,
    base_url: str,
    origin: str,
    expected_site_id: str,
    expected_scale_id: str,
    expected_scale_role: str,
    steps: list[StepResult],
) -> dict[str, Any]:
    """Build a structured redacted report for smoke evidence."""

    session_id = None
    if steps and isinstance(steps[0].body, dict):
        session_id = steps[0].body.get("session_id")

    return {
        "meta": {
            "generated_at": datetime.now(tz=timezone.utc).isoformat(),
            "run_label": run_label,
            "environment": {
                "platform": platform.platform(),
                "python": sys.version.split()[0],
            },
        },
        "request_context": {
            "base_url": base_url,
            "origin": origin,
            "expected_site_id": expected_site_id,
            "expected_scale_id": expected_scale_id,
            "expected_scale_role": expected_scale_role,
        },
        "session_id": session_id,
        "steps": [
            {
                "name": step.name,
                "method": step.method,
                "path": step.path,
                "ok": step.ok,
                "status_code": step.status_code,
                "elapsed_ms": step.elapsed_ms,
                "body": redact_sensitive(step.body),
                "error": step.error,
            }
            for step in steps
        ],
        "summary": {
            "all_steps_passed": all(step.ok for step in steps),
            "passed_steps": sum(1 for step in steps if step.ok),
            "failed_steps": sum(1 for step in steps if not step.ok),
        },
    }


def _render_markdown(report: dict[str, Any]) -> str:
    """Render a markdown evidence report from structured smoke data."""

    meta = report["meta"]
    context = report["request_context"]
    summary = report["summary"]
    lines = [
        "# Scale API smoke evidence",
        "",
        "## Контекст запуска",
        f"- Дата (UTC): `{meta['generated_at']}`",
        f"- Запуск: `{meta['run_label']}`",
        f"- Платформа: `{meta['environment']['platform']}`",
        f"- Python: `{meta['environment']['python']}`",
        f"- Base URL: `{context['base_url']}`",
        f"- Origin: `{context['origin']}`",
        f"- Active scale context: `{context['expected_site_id']}` / `{context['expected_scale_id']}` / `{context['expected_scale_role']}`",
        f"- Session ID: `{report.get('session_id') or 'n/a'}`",
        "",
        "## Итог",
        f"- all_steps_passed: `{summary['all_steps_passed']}`",
        f"- passed_steps: `{summary['passed_steps']}`",
        f"- failed_steps: `{summary['failed_steps']}`",
        "",
        "## Шаги smoke",
    ]

    for step in report["steps"]:
        status = "PASSED" if step["ok"] else "FAILED"
        lines.extend(
            [
                f"### {step['name']}: {status}",
                f"- Request: `{step['method']} {step['path']}`",
                f"- HTTP status: `{step['status_code']}`",
                f"- Duration: `{step['elapsed_ms']} ms`",
                f"- Error: `{step['error'] or 'none'}`",
                "- Response (redacted):",
                "```json",
                json.dumps(step["body"], ensure_ascii=False, indent=2),
                "```",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def _write_report(path: str | None, content: str) -> None:
    """Write report content to file when target path is set."""

    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def _run_smoke(args: argparse.Namespace) -> dict[str, Any]:
    """Execute connect/status/read/disconnect flow and build report."""

    headers = {"Origin": args.origin}
    connect_payload = {
        "expected_site_id": args.expected_site_id,
        "expected_scale_id": args.expected_scale_id,
        "expected_scale_role": args.expected_scale_role,
    }

    steps: list[StepResult] = []
    connect = _request_step(
        name="connect",
        method="POST",
        base_url=args.base_url,
        path="/api/scales/connect",
        headers=headers,
        payload=connect_payload,
        timeout_sec=args.http_timeout_sec,
    )
    steps.append(connect)

    session_id = None
    if connect.ok and isinstance(connect.body, dict):
        session_id = connect.body.get("session_id")

    if session_id:
        steps.append(
            _request_step(
                name="status",
                method="GET",
                base_url=args.base_url,
                path=f"/api/scales/status?session_id={session_id}",
                headers=headers,
                payload=None,
                timeout_sec=args.http_timeout_sec,
            )
        )
        steps.append(
            _request_step(
                name="read",
                method="POST",
                base_url=args.base_url,
                path="/api/scales/read",
                headers=headers,
                payload={"session_id": session_id, "timeout_ms": args.read_timeout_ms},
                timeout_sec=args.http_timeout_sec,
            )
        )
        steps.append(
            _request_step(
                name="disconnect",
                method="POST",
                base_url=args.base_url,
                path="/api/scales/disconnect",
                headers=headers,
                payload={"session_id": session_id},
                timeout_sec=args.http_timeout_sec,
            )
        )

    report = build_report(
        run_label=args.run_label,
        base_url=args.base_url,
        origin=args.origin,
        expected_site_id=args.expected_site_id,
        expected_scale_id=args.expected_scale_id,
        expected_scale_role=args.expected_scale_role,
        steps=steps,
    )
    return report


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse CLI arguments."""

    parser = argparse.ArgumentParser(
        description="Run production-like smoke against /api/scales/*.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Backend URL.")
    parser.add_argument("--origin", default=DEFAULT_ORIGIN, help="Origin header.")
    parser.add_argument("--run-label", default="local-backend", help="Evidence label.")
    parser.add_argument(
        "--expected-site-id",
        default="default-site",
        help="Expected active site id for connect guard.",
    )
    parser.add_argument(
        "--expected-scale-id",
        default="scale-primary",
        help="Expected active scale id for connect guard.",
    )
    parser.add_argument(
        "--expected-scale-role",
        default="primary",
        choices=("primary", "spare"),
        help="Expected active scale role for connect guard.",
    )
    parser.add_argument(
        "--read-timeout-ms",
        type=int,
        default=DEFAULT_READ_TIMEOUT_MS,
        help="Read timeout for POST /api/scales/read.",
    )
    parser.add_argument(
        "--http-timeout-sec",
        type=float,
        default=DEFAULT_TIMEOUT_SEC,
        help="HTTP timeout per request.",
    )
    parser.add_argument("--write-json", default="", help="Write structured report JSON.")
    parser.add_argument("--write-markdown", default="", help="Write markdown evidence.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """CLI entrypoint."""

    args = parse_args(argv)
    report = _run_smoke(args)
    markdown = _render_markdown(report)

    _write_report(args.write_json or None, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    _write_report(args.write_markdown or None, markdown)

    print(markdown, end="")
    return 0 if report["summary"]["all_steps_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
