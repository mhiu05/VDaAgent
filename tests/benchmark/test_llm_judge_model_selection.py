"""Unit tests for dynamic Gemini judge model selection without API access."""
from __future__ import annotations

import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graders import llm_judge
from graders.llm_judge import _judge_payload, _select_openai_model, select_judge_model


def model(name: str, *actions: str) -> dict:
    return {"name": name, "display_name": name, "supported_actions": list(actions or ("generateContent",))}


class GeminiJudgeModelSelectionTests(unittest.TestCase):
    def test_prefers_stable_pro_over_preview_and_flash(self) -> None:
        selected, details = select_judge_model([
            model("gemini-2.5-flash"),
            model("gemini-2.5-pro"),
            model("gemini-3.0-pro-preview"),
            model("gemini-2.5-flash-image"),
        ])
        self.assertEqual(selected, "gemini-2.5-pro")
        self.assertEqual(details["source"], "DISCOVERED_POLICY")

    def test_honors_available_explicit_benchmark_override(self) -> None:
        selected, details = select_judge_model([
            model("gemini-2.5-pro"), model("gemini-2.5-flash"),
        ], "models/gemini-2.5-flash")
        self.assertEqual(selected, "gemini-2.5-flash")
        self.assertEqual(details["source"], "BENCHMARK_JUDGE_MODEL")

    def test_does_not_select_models_without_generate_content(self) -> None:
        selected, details = select_judge_model([
            model("text-embedding-004", "embedContent"), model("imagen-4.0-generate", "generateContent"),
        ])
        self.assertIsNone(selected)
        self.assertEqual(details["candidate_count"], 0)


class OpenAIJudgeFallbackTests(unittest.TestCase):
    def test_payload_contains_independent_truth_and_public_claim_binding(self) -> None:
        payload = _judge_payload(
            {
                "question": "Giá trị là gì?",
                "expected_answer": "Giá trị đúng.",
                "judge_reference": "Trả lời đúng giá trị đã profile.",
                "judge_evidence": "Ground truth độc lập: 3.",
                "expected_evidence": {"required": True},
            },
            {
                "answer": "Giá trị là 3. [S1]",
                "sources": [
                    {
                        "citation_id": "S1",
                        "tool": "get_stat",
                        "status": "ok",
                        "profile_run_id": "must-not-be-exported",
                    }
                ],
                "provenance": {
                    "evidence_status": "verified",
                    "findings": [
                        {
                            "citations": [
                                {
                                    "citation_id": "S1",
                                    "metric": "count",
                                    "value": 3,
                                    "profile_run_id": "must-not-be-exported",
                                }
                            ]
                        }
                    ],
                },
            },
        )

        self.assertEqual(payload["reference"], "Trả lời đúng giá trị đã profile.")
        self.assertIn("Ground truth độc lập: 3.", payload["evidence"])
        self.assertIn('"value": 3', payload["evidence"])
        self.assertNotIn("must-not-be-exported", payload["evidence"])

    def test_prefers_documented_default_when_available(self) -> None:
        selected, details = _select_openai_model(
            ["gpt-5-mini", "gpt-5.4-mini"], None
        )
        self.assertEqual(selected, "gpt-5.4-mini")
        self.assertEqual(details["source"], "DOCUMENTED_DEFAULT")

    def test_honors_available_openai_override(self) -> None:
        selected, details = _select_openai_model(
            ["gpt-5-mini", "gpt-5.4-mini"], "gpt-5-mini"
        )
        self.assertEqual(selected, "gpt-5-mini")
        self.assertEqual(details["source"], "BENCHMARK_OPENAI_JUDGE_MODEL")

    @patch.object(llm_judge, "_score_openai")
    @patch.object(llm_judge, "_score_gemini")
    def test_score_falls_back_after_gemini_failure(
        self, gemini: object, openai: object
    ) -> None:
        gemini.return_value = {  # type: ignore[attr-defined]
            "status": "FAILED",
            "reason": "GEMINI_AUTH_FAILED",
            "model_catalog": {"status": "FAILED"},
        }
        openai.return_value = {  # type: ignore[attr-defined]
            "status": "EVALUATED",
            "reason": None,
            "judge_configuration": {"provider": "openai"},
        }

        result = llm_judge.score({}, [], [])

        self.assertTrue(result["fallback_used"])
        self.assertEqual(result["status"], "EVALUATED")
        self.assertEqual(result["fallback_from"]["reason"], "GEMINI_AUTH_FAILED")
        self.assertEqual(
            [item["provider"] for item in result["provider_attempts"]],
            ["gemini", "openai"],
        )


if __name__ == "__main__":
    unittest.main()
