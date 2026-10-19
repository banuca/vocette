-- One row per report. No IP, no ID, no time of day: only the UTC day it arrived.
CREATE TABLE IF NOT EXISTS reports (
  day TEXT NOT NULL,
  v TEXT NOT NULL,
  os TEXT NOT NULL,
  engine TEXT NOT NULL,
  plan TEXT NOT NULL,
  week INTEGER NOT NULL,
  active_days7 INTEGER NOT NULL,
  dictations7 INTEGER NOT NULL,
  limit_hit INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_day ON reports (day);
