-- 習慣を全ユーザー共通の固定セットにする。
-- ユーザー作成の習慣はすべてアーカイブし、共通の習慣だけを有効にする。
UPDATE habits SET archived = 1;

INSERT INTO habits (name) VALUES ('筋トレ')
  ON CONFLICT(name) DO UPDATE SET archived = 0;
