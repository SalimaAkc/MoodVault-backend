const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Set up the connection to my MySQL database
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'moodtunes',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise();

// Handling profile picture uploads
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir); // Make the folder if it's missing

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        // Name the file using the user ID and timestamp so nothing gets overwritten
        cb(null, `${req.params.id}-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// Let the app show the images stored in the uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// A quick way to track what users are doing (logging)
const logActivity = async (userId, type, details) => {
    try {
        await pool.query(
            "INSERT INTO activity_log (user_id, action_type, details) VALUES (?, ?, ?)",
            [userId, type, details]
        );
    } catch (err) {
        console.error("Failed to log activity:", err);
    }
};

// --- AUTH ROUTES ---

// Check if user exists and password is right
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const sql = "SELECT id, username, profile_pic, is_admin FROM users WHERE email = ? AND password_hash = ?";
    try {
        const [results] = await pool.query(sql, [email, password]);
        if (results.length > 0) res.json({ user: results[0] });
        else res.status(401).json({ error: "Invalid email or password" });
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// Create a new account
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        // Make sure the name isn't taken
        const [userResults] = await pool.query("SELECT id FROM users WHERE username = ?", [username]);
        if (userResults.length > 0) return res.status(400).json({ message: "Username already taken." });

        const insertSql = "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)";
        const [result] = await pool.query(insertSql, [username, email, password]);
        
        await logActivity(result.insertId, 'user_registered', `joined the platform as a new member!`);
        res.json({ message: "User registered! You can now login." });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: "Email already exists." });
        res.status(500).json({ message: "Registration failed." });
    }
});

// --- PROFILE SETTINGS ---

// Change username or pic
app.put('/api/users/:id/update', async (req, res) => {
    const { username, profile_pic } = req.body;
    try {
        await pool.query("UPDATE users SET username = ?, profile_pic = ? WHERE id = ?", [username, profile_pic, req.params.id]);
        await logActivity(req.params.id, 'profile_updated', 'updated their profile');
        res.json({ success: true, message: "Profile updated" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// Change account password
app.put('/api/users/:id/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const [users] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [req.params.id]);
        if (users.length === 0) return res.status(404).json({ error: "User not found" });
        if (users[0].password_hash !== currentPassword) return res.status(401).json({ error: "Current password incorrect" });
        
        await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [newPassword, req.params.id]);
        await logActivity(req.params.id, 'password_changed', 'updated their password');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to change password" });
    }
});

// Wipe account and all their playlists from the DB
app.delete('/api/users/:id/delete-account', async (req, res) => {
    const userId = req.params.id;
    const { password } = req.body;
    try {
        const [users] = await pool.query("SELECT username, password_hash FROM users WHERE id = ?", [userId]);
        if (users.length === 0) return res.status(404).json({ error: "User not found" });
        if (users[0].password_hash !== password) return res.status(401).json({ error: "Incorrect password" });
        
        const username = users[0].username;

        // Delete their songs and playlists first to avoid foreign key errors
        await pool.query("DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)", [userId]);
        await pool.query("DELETE FROM playlists WHERE user_id = ?", [userId]);
        
        // Log the deletion before we kill the user record
        await pool.query(
            "INSERT INTO activity_log (user_id, action_type, details, created_at) VALUES (NULL, 'account_deleted', ?, NOW())",
            [`User @${username} has permanently deleted their account.`]
        );
        
        await pool.query("DELETE FROM activity_log WHERE user_id = ?", [userId]);
        await pool.query("DELETE FROM users WHERE id = ?", [userId]);
        res.json({ success: true });
    } catch (err) {
        console.error("Account deletion error:", err);
        res.status(500).json({ error: "Deletion failed" });
    }
});

// Get all playlists and songs for the profile page
app.get('/api/profile/:userId', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.id as playlist_id, p.name as playlist_name, p.mood, p.created_at,
                   s.id as song_id, s.title, s.artist, s.youtube_id
            FROM playlists p
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            LEFT JOIN songs s ON ps.song_id = s.id
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC`, [req.params.userId]);
        
        // Group the flat SQL rows into playlist objects with song arrays
        const playlists = {};
        rows.forEach(row => {
            if (!playlists[row.playlist_id]) {
                playlists[row.playlist_id] = {
                    id: row.playlist_id,
                    name: row.playlist_name,
                    mood: row.mood,
                    created_at: row.created_at,
                    songs: []
                };
            }
            if (row.song_id) {
                playlists[row.playlist_id].songs.push({
                    id: row.song_id,
                    title: row.title,
                    artist: row.artist,
                    youtube_id: row.youtube_id
                });
            }
        });
        
        res.json(Object.values(playlists));
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// --- SEARCH & MOOD ENGINE ---

// Search for songs in the database
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const [localSongs] = await pool.query(
            "SELECT id, title, artist, mood, youtube_id FROM songs WHERE title LIKE ? OR artist LIKE ?", 
            [`%${q}%`, `%${q}%`]
        );
        res.json({ songs: localSongs });
    } catch (error) {
        res.status(500).json({ error: "Search failed" });
    }
});

// Pick 15 random songs that match a specific mood
app.get('/api/mood/generate', async (req, res) => {
    const { mood } = req.query;
    try {
        const [songs] = await pool.query(
            "SELECT id, title, artist, mood, youtube_id FROM songs WHERE mood = ? ORDER BY RAND() LIMIT 15",
            [mood]
        );
        
        if (songs.length === 0) {
            return res.json({ songs: [], message: "No songs found for this mood." });
        }
        res.json({ songs });
    } catch (error) {
        res.status(500).json({ error: "Failed to generate mood playlist" });
    }
});

// --- PLAYLIST MANAGEMENT ---

// Save a new playlist to the database
app.post('/api/playlists/create', async (req, res) => {
    const { userId, name, songs, mood } = req.body;
    try {
        const [playlistResult] = await pool.query(
            'INSERT INTO playlists (user_id, name, mood) VALUES (?, ?, ?)', 
            [userId, name, mood || 'General']
        );
        const playlistId = playlistResult.insertId;

        // Link each song to the playlist (or add the song if it's new to the system)
        for (const song of songs) {
            const [existing] = await pool.query('SELECT id FROM songs WHERE youtube_id = ?', [song.youtube_id]);
            let songId = existing.length > 0 ? existing[0].id : 
                (await pool.query(
                    "INSERT INTO songs (title, artist, youtube_id, mood) VALUES (?, ?, ?, ?)", 
                    [song.title, song.artist, song.youtube_id, mood]
                ))[0].insertId;
            
            await pool.query('INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)', [playlistId, songId]);
        }
        
        await logActivity(userId, 'playlist_created', `saved a new mix: ${name}`);
        res.status(201).json({ success: true, playlistId });
    } catch (err) {
        res.status(500).json({ error: "Save failed" });
    }
});

// Remove just one song from a playlist
app.delete('/api/playlists/:playlistId/songs/:songId', async (req, res) => {
    const { playlistId, songId } = req.params;
    const { userId } = req.body;
    try {
        await pool.query('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?', [playlistId, songId]);
        if (userId) await logActivity(userId, 'song_removed', 'removed a song');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to remove song" });
    }
});

// Delete an entire playlist
app.delete('/api/playlists/:playlistId', async (req, res) => {
    const { playlistId } = req.params;
    const { userId } = req.body;
    try {
        await pool.query('DELETE FROM playlist_songs WHERE playlist_id = ?', [playlistId]);
        await pool.query('DELETE FROM playlists WHERE id = ?', [playlistId]);
        if (userId) await logActivity(userId, 'playlist_deleted', 'deleted a playlist');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete playlist" });
    }
});

// --- ADMIN FEATURES ---

// Get numbers for the dashboard
app.get('/api/admin/stats', async (req, res) => {
    try {
        const [[u]] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [[p]] = await pool.query('SELECT COUNT(*) as total FROM playlists');
        const [[s]] = await pool.query('SELECT COUNT(*) as total FROM songs');
        const [[l]] = await pool.query('SELECT COUNT(*) as total FROM activity_log');
        res.json({ 
            totalUsers: u.total, 
            totalPlaylists: p.total, 
            totalSongs: s.total, 
            totalLogs: l.total 
        });
    } catch (err) { 
        res.status(500).json({ error: "Stats failed" }); 
    }
});

// Get recent activity across the whole site
app.get('/api/admin/activity', async (req, res) => {
    try {
        const query = `
            SELECT al.*, COALESCE(u.username, 'System') as username
            FROM activity_log al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC LIMIT 50`;
        const [logs] = await pool.query(query);
        res.json(logs);
    } catch (err) { 
        res.status(500).json({ error: "Logs failed" }); 
    }
});

// List all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, email, is_admin FROM users');
        res.json(users);
    } catch (err) { 
        res.status(500).json({ error: "Users failed" }); 
    }
});

// Make someone an admin (or take it away)
app.put('/api/admin/users/:id/toggle-admin', async (req, res) => {
    const { is_admin } = req.body;
    try {
        await pool.query('UPDATE users SET is_admin = ? WHERE id = ?', [is_admin, req.params.id]);
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: "Toggle admin failed" }); 
    }
});

// Force delete a user account
app.delete('/api/admin/users/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const [user] = await pool.query("SELECT username FROM users WHERE id = ?", [userId]);
        const name = user.length > 0 ? user[0].username : "Unknown";

        await pool.query("DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)", [userId]);
        await pool.query("DELETE FROM playlists WHERE user_id = ?", [userId]);
        await pool.query(
            "INSERT INTO activity_log (user_id, action_type, details) VALUES (NULL, 'admin_action', ?)", 
            [`Admin deleted user: @${name}`]
        );
        await pool.query("DELETE FROM activity_log WHERE user_id = ?", [userId]);
        await pool.query("DELETE FROM users WHERE id = ?", [userId]);
        res.json({ message: "User deleted" });
    } catch (err) { 
        res.status(500).json({ error: "Delete failed" }); 
    }
});

// Get all playlists in the system
app.get('/api/admin/playlists', async (req, res) => {
    try {
        const [playlists] = await pool.query('SELECT * FROM playlists');
        res.json(playlists);
    } catch (err) { 
        res.status(500).json({ error: "Playlists failed" }); 
    }
});


// Add a song manually to the library
app.post('/api/admin/songs', async (req, res) => {
    const { youtube_id, title, artist, mood } = req.body;
    try {
        await pool.query(
            'INSERT INTO songs (youtube_id, title, artist, mood) VALUES (?, ?, ?, ?)', 
            [youtube_id, title, artist, mood]
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: "Add song failed" }); 
    }
});

// Delete song from the main library 
app.delete('/api/admin/songs/:id', async (req, res) => {
    try {
        // First, remove the song from any user playlists (The link)
        await pool.query('DELETE FROM playlist_songs WHERE song_id = ?', [req.params.id]);
        // Now, delete the actual song
        await pool.query('DELETE FROM songs WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: "Delete failed" }); 
    }
});

app.post('/api/users/:id/upload', upload.single('profile_pic'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = `/uploads/${req.file.filename}`;

        await pool.query("UPDATE users SET profile_pic = ? WHERE id = ?", [filePath, req.params.id]);

        res.json({ 
            success: true, 
            profile_pic: filePath 
        });
    } catch (err) {
        console.error("Upload route error:", err);
        res.status(500).json({ error: "File upload failed" });
    }
});

// Start the app!
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));