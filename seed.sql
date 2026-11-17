-- Dữ liệu 2 buổi đầu tiên. Chạy SAU schema.sql, chỉ 1 lần.
-- Ngày buổi 1 chưa chắc chắn, sửa lại trong app nếu cần.
INSERT INTO players (id, name, note) VALUES
  (1, 'An', NULL),
  (2, 'Chang', 'Bi 8'),
  (3, 'Hữu', NULL),
  (4, 'Loan', NULL),
  (5, 'Đức', NULL);

INSERT INTO sessions (id, date, created_by) VALUES
  (1, '2026-11-11', 'seed'),
  (2, '2026-11-13', 'seed');

INSERT INTO results (session_id, player_id, type, win, lose, rank) VALUES
  -- Buổi 1 - League
  (1, 1, 'LEAGUE', 9, 4, NULL),
  (1, 2, 'LEAGUE', 9, 4, NULL),
  (1, 3, 'LEAGUE', 7, 6, NULL),
  (1, 4, 'LEAGUE', 6, 7, NULL),
  (1, 5, 'LEAGUE', 4, 9, NULL),
  -- Buổi 1 - Cup
  (1, 1, 'CUP', 2, 0, 1),
  (1, 2, 'CUP', 2, 0, 1),
  (1, 3, 'CUP', 1, 1, 2),
  (1, 4, 'CUP', 1, 1, 3),
  (1, 5, 'CUP', 0, 2, 4),
  -- Buổi 2 - League (An nghỉ)
  (2, 4, 'LEAGUE', 9, 4, NULL),
  (2, 3, 'LEAGUE', 7, 6, NULL),
  (2, 5, 'LEAGUE', 5, 8, NULL),
  (2, 2, 'LEAGUE', 5, 8, NULL),
  -- Buổi 2 - Cup
  (2, 2, 'CUP', 2, 0, 1),
  (2, 3, 'CUP', 1, 1, 2),
  (2, 5, 'CUP', 1, 1, 3),
  (2, 4, 'CUP', 0, 2, 4);
