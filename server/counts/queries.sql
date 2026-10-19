-- Read-only questions the counts answer. Run one with:
--   npx wrangler d1 execute vocette-counts --remote --command "<query>"

-- Reports per day (each opted-in PC reports at most once a day, so this is daily active opted-in PCs).
SELECT day, COUNT(*) AS pcs FROM reports GROUP BY day ORDER BY day DESC LIMIT 30;

-- Beta pass mark (S3): in their second week, how many dictated on 4+ of the last 7 days.
SELECT SUM(active_days7 >= 4) AS kept, COUNT(*) AS week2 FROM reports
WHERE week = 1 AND day >= date('now', '-7 days');

-- Engine and plan mix over the last 7 days.
SELECT engine, plan, COUNT(*) AS reports FROM reports
WHERE day >= date('now', '-7 days') GROUP BY engine, plan;

-- Free users reaching the monthly limit, last 30 days.
SELECT SUM(limit_hit) AS hit, COUNT(*) AS free FROM reports
WHERE plan = 'free' AND day >= date('now', '-30 days');
