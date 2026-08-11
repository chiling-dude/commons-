-- Commons schema. Run via `npm run migrate`.

CREATE TABLE IF NOT EXISTS accounts (
  nickname      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  is_adult      BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'user', -- 'global' | 'region' | 'user'
  created_by  TEXT REFERENCES accounts(nickname) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id                  BIGSERIAL PRIMARY KEY,
  room_id             TEXT NOT NULL,
  room_name           TEXT,
  reported_nickname   TEXT NOT NULL,
  message_text        TEXT NOT NULL,
  reason              TEXT NOT NULL,
  note                TEXT,
  reporter_nickname   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | dismissed | actioned
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- One row per violation. Escalation is computed from this history at read time
-- (see src/lib/escalation.js) — same rolling-14-day streak logic as the prototype.
CREATE TABLE IF NOT EXISTS violations (
  id          BIGSERIAL PRIMARY KEY,
  nickname    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_violations_nick_time ON violations(nickname, created_at);

CREATE TABLE IF NOT EXISTS blocks (
  nickname          TEXT NOT NULL,
  blocked_nickname  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (nickname, blocked_nickname)
);

INSERT INTO rooms (id, name, type) VALUES ('global', 'Global Lobby', 'global')
ON CONFLICT (id) DO NOTHING;

-- Region rooms — ids computed with the exact same slugify() as the frontend
-- (see src/lib/slug.js), so room selection in the UI maps 1:1 to these rows.
INSERT INTO rooms (id, name, type) VALUES
  ('telangana-india', 'Telangana, India', 'region'),
  ('maharashtra-india', 'Maharashtra, India', 'region'),
  ('delhi-ncr-india', 'Delhi NCR, India', 'region'),
  ('tamil-nadu-india', 'Tamil Nadu, India', 'region'),
  ('karnataka-india', 'Karnataka, India', 'region'),
  ('california-united-states', 'California, United States', 'region'),
  ('texas-united-states', 'Texas, United States', 'region'),
  ('new-york-united-states', 'New York, United States', 'region'),
  ('florida-united-states', 'Florida, United States', 'region'),
  ('s-o-paulo-brazil', 'São Paulo, Brazil', 'region'),
  ('rio-de-janeiro-brazil', 'Rio de Janeiro, Brazil', 'region'),
  ('minas-gerais-brazil', 'Minas Gerais, Brazil', 'region'),
  ('lagos-nigeria', 'Lagos, Nigeria', 'region'),
  ('abuja-nigeria', 'Abuja, Nigeria', 'region'),
  ('kano-nigeria', 'Kano, Nigeria', 'region'),
  ('bavaria-germany', 'Bavaria, Germany', 'region'),
  ('berlin-germany', 'Berlin, Germany', 'region'),
  ('hamburg-germany', 'Hamburg, Germany', 'region')
ON CONFLICT (id) DO NOTHING;
