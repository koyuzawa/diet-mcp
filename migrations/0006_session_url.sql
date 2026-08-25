-- ユーザーごとにClaudeセッションの共有URLを保存できるようにする
ALTER TABLE users ADD COLUMN session_url TEXT;
