import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.predictor import Predictor  # noqa: E402
from app.train import train  # noqa: E402

GOOD = {
    "runHours": 1500, "daysSinceService": 30, "downtimeCount30d": 1,
    "toolWearMin": 60, "temperatureC": 58, "vibrationMms": 1.8,
}


@pytest.fixture(scope="session")
def trained(tmp_path_factory):
    out = tmp_path_factory.mktemp("artifacts")
    metadata = train(n_samples=8000, seed=7, out_dir=out)
    return out, metadata


@pytest.fixture(scope="session")
def predictor(trained):
    return Predictor.load(trained[0])
