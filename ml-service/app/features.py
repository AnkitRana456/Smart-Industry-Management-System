"""The six inputs the model uses. All of them are values SIMS already records."""
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field


@dataclass(frozen=True)
class Feature:
    name: str
    label: str
    unit: str


FEATURES = [
    Feature("runHours", "Run hours", "h"),
    Feature("daysSinceService", "Days since last service", "days"),
    Feature("downtimeCount30d", "Downtime events in the last 30 days", "events"),
    Feature("toolWearMin", "Tool wear", "min"),
    Feature("temperatureC", "Temperature", "°C"),
    Feature("vibrationMms", "Vibration", "mm/s"),
]
FEATURE_NAMES = [f.name for f in FEATURES]
BY_NAME = {f.name: f for f in FEATURES}


class PredictRequest(BaseModel):
    """Hard bounds only reject impossible values. Unusual-but-possible ones get a warning instead."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    runHours: float = Field(ge=0, le=200_000)
    daysSinceService: float = Field(ge=0, le=5_000)
    downtimeCount30d: float = Field(ge=0, le=1_000)
    toolWearMin: float = Field(ge=0, le=100_000)
    temperatureC: float = Field(ge=-50, le=1_500)
    vibrationMms: float = Field(ge=0, le=200)

    def as_row(self) -> list[float]:
        return [getattr(self, n) for n in FEATURE_NAMES]
