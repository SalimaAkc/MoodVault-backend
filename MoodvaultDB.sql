DROP DATABASE IF EXISTS moodtunes;
CREATE DATABASE moodtunes;
USE moodtunes;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE moods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  description VARCHAR(255)
);

INSERT INTO moods (name, description) VALUES
('Happy', 'Upbeat and energetic music'),
('Sad', 'Emotional and calm tracks'),
('Focused', 'Music to help concentration'),
('Relaxed', 'Chill and peaceful vibes');

CREATE TABLE songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  artist VARCHAR(100) NOT NULL,
  song_url VARCHAR(255), -- FIXED: Added this column
  genre VARCHAR(50)
);

CREATE TABLE playlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  mood_id INT DEFAULT 1, -- Default to 'Happy' mood
  title VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE playlist_songs (
  playlist_id INT NOT NULL,
  song_id INT NOT NULL,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE playlist_songs;
TRUNCATE TABLE playlists;
TRUNCATE TABLE songs;
SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE songs MODIFY COLUMN song_url TEXT;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE playlist_songs;
TRUNCATE TABLE playlists;
TRUNCATE TABLE songs;

SET FOREIGN_KEY_CHECKS = 1;


SELECT id, username, email, profile_pic, is_admin FROM users WHERE email = 'salima@outlook.com';

UPDATE songs SET mood = genre WHERE mood IS NULL;

DELETE FROM songs WHERE youtube_id IS NULL AND song_url IS NULL;

ALTER TABLE playlists ADD COLUMN songs_json TEXT;

DESCRIBE songs;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS songs;

CREATE TABLE songs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    mood VARCHAR(50) NOT NULL,
    youtube_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SET FOREIGN_KEY_CHECKS = 1;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE playlist_songs;

TRUNCATE TABLE playlists;

SET FOREIGN_KEY_CHECKS = 1;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE playlist_songs;
TRUNCATE TABLE playlists;

SET FOREIGN_KEY_CHECKS = 1;

DESCRIBE songs;


SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS playlists;

CREATE TABLE playlists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL, -- Changed from 'title' to 'name'
    mood VARCHAR(50),           -- Changed from 'mood_id' to 'mood' (string)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Re-enable foreign keys
SET FOREIGN_KEY_CHECKS = 1;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS = 1;

-- Make the first user an admin manually
UPDATE users SET is_admin = 1 WHERE id = 1;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action_type VARCHAR(50), -- 'new_user', 'create_playlist', 'add_song'
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO activity_log (user_id, action_type, details) VALUES 
(1, 'user_registered', 'joined the platform as a new member!'),
(1, 'playlist_created', 'created a new playlist called "Midnight Vibes"'),
(1, 'song_saved', 'added "Blinding Lights" to their favorites');

ALTER TABLE activity_log MODIFY user_id INT NULL;


INSERT INTO users (username, email, password_hash, is_admin) VALUES
('JordanMusic', 'jordan@example.com', 'testpass123', 0),
('MelodyMaker', 'melody@example.com', 'testpass123', 0),
('Admin_Sarah', 'sarah@moodtunes.com', 'adminpass456', 1),
('BeatMaster', 'beat@example.com', 'testpass123', 0),
('LyricLover', 'lyric@example.com', 'testpass123', 0);

-- Run this in your MySQL console to sync your data
UPDATE songs SET mood = 'Relaxed' WHERE mood = 'Chill';
