CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('bug', 'feature', 'other')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reproduction_steps TEXT NOT NULL DEFAULT '',
  screenshot_mime TEXT,
  screenshot BLOB,
  technical_info TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewing', 'resolved', 'closed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS bug_reports_created_at_idx ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports(status);