from __future__ import annotations

import json
from io import StringIO
from types import SimpleNamespace

from stable_baselines3.common.logger import HumanOutputFormat, Logger

from ibrawls_rl.train_ppo import JSONLMetricsWriter, MechanicsCoverageLoggerCallback


def test_mechanics_coverage_logger_keeps_jsonl_metrics_without_crashing_human_output(tmp_path):
    metrics_path = tmp_path / "metrics.jsonl"
    callback = MechanicsCoverageLoggerCallback(
        logdir="unused",
        metadata={
            "mechanics": {
                "coverage": {
                    "grifballBallReturnTimeout": {
                        "coverage_low": 0.8,
                        "coverage_high": 1.2,
                    }
                },
                "base_values": {"grifballBallReturnTimeout": 1.0},
            }
        },
    )
    writer = JSONLMetricsWriter(str(metrics_path))
    callback.model = SimpleNamespace(logger=Logger(None, [HumanOutputFormat(StringIO()), writer]))

    callback._record_rows(
        {
            "grifballBallReturnTimeout": {
                "count": 3,
                "min": 0.8,
                "max": 1.2,
                "sum": 3.0,
            }
        }
    )
    callback.logger.record("train/learning_rate", 0.0003)

    callback.logger.dump(step=3)
    writer.close()

    record = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert record["mechanics/grifballBallReturnTimeout/coverage_low"] == 0.8
    assert record["mechanics/grifballBallReturnTimeout/coverage_high"] == 1.2
