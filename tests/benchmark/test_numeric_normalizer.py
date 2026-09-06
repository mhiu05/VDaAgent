"""Kiểm thử các định dạng số tiếng Việt mà grader phải hiểu."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graders.numeric import extract_candidates


class VietnameseNumericNormalizerTests(unittest.TestCase):
    def values(self, text: str, policy: str = "aggregate") -> set[Decimal]:
        return {candidate.value for candidate in extract_candidates(text, policy)}

    def test_percentages(self) -> None:
        self.assertIn(Decimal("0.125"), self.values("12,5%", "percentage"))
        self.assertIn(Decimal("0.125"), self.values("12.5 phần trăm", "percentage"))

    def test_thousands_and_decimal_separators(self) -> None:
        self.assertIn(Decimal("1234.56"), self.values("1.234,56"))
        self.assertIn(Decimal("1234.56"), self.values("1,234.56"))
        self.assertIn(Decimal("1200"), self.values("1.200", "integer_count"))

    def test_vietnamese_units(self) -> None:
        self.assertIn(Decimal("1000000"), self.values("1 triệu đồng"))
        self.assertIn(Decimal("1200000"), self.values("1,2 triệu"))
        self.assertIn(Decimal("2000000000"), self.values("2 tỷ"))
        self.assertIn(Decimal("500000"), self.values("500 nghìn"))

    def test_ambiguous_single_separator_is_preserved(self) -> None:
        candidates = extract_candidates("1.234", "aggregate")
        self.assertTrue(any(candidate.ambiguous for candidate in candidates))
        self.assertEqual({candidate.value for candidate in candidates}, {Decimal("1.234"), Decimal("1234")})


if __name__ == "__main__":
    unittest.main()
