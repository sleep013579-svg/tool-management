const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('./')); // 讓伺服器自動讀取當前目錄下的 HTML 檔案

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('資料庫連線失敗：', err.message);
    } else {
        console.log('成功連線到 SQLite 資料庫！');
        
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS Users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                password TEXT,
                role TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS Records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT,
                borrower_name TEXT,
                borrow_time TEXT,
                return_time TEXT,
                status TEXT
            )`);

            db.get("SELECT COUNT(*) AS count FROM Users", (err, row) => {
                if (row.count === 0) {
                    const insert = db.prepare("INSERT INTO Users (name, password, role) VALUES (?, ?, ?)");
                    insert.run("總權限(我)", "1234", "superadmin");
                    insert.run("管理員小明", "1234", "admin");
                    insert.run("員工小華", "1234", "user");
                    insert.finalize();
                }
            });
        });
    }
});

// --- 新增的部分：處理登入請求的 API ---
app.post('/login', (req, res) => {
    // 接收前端傳來的帳號與密碼
    const { name, password } = req.body;

    // 去資料庫尋找有沒有符合的資料
    db.get("SELECT * FROM Users WHERE name = ? AND password = ?", [name, password], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: '資料庫發生錯誤' });
        }
        
        if (row) {
            // 如果找到該名使用者，回傳成功與權限
            res.json({ success: true, message: '登入成功', role: row.role, name: row.name });
        } else {
            // 如果找不到，代表密碼輸入錯誤
            res.json({ success: false, message: '密碼錯誤' });
        }
    });
});
// ------------------------------------

// --- 新增的部分：處理註冊請求的 API ---
app.post('/register', (req, res) => {
    const { name, password } = req.body;
    const role = 'user'; // 為了安全，新註冊的人員一律預設為「一般使用者」

    if (!name || !password) {
        return res.json({ success: false, message: '名稱與密碼不能為空！' });
    }

    // 將新資料存入資料庫
    const insert = db.prepare("INSERT INTO Users (name, password, role) VALUES (?, ?, ?)");
    insert.run([name, password, role], function(err) {
        if (err) {
            // 因為我們資料庫設定 name 是 UNIQUE (唯一)，如果名稱重複會報錯
            if (err.message.includes('UNIQUE')) {
                return res.json({ success: false, message: '這個名稱已經被註冊過囉，請換一個！' });
            }
            return res.status(500).json({ success: false, message: '資料庫發生錯誤' });
        }
        res.json({ success: true, message: '註冊成功！請使用新帳號登入。' });
    });
    insert.finalize();
});
// ------------------------------------
// --- 新增的部分：取得所有使用者名稱 (供登入下拉選單使用) ---
app.get('/users', (req, res) => {
    // 從資料庫中只抓取 name 欄位
    db.all("SELECT name FROM Users", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: '讀取名單失敗' });
        }
        res.json({ success: true, data: rows });
    });
});
// --------------------------------------------------------
// 1. 讀取記錄 API (根據權限過濾資料)
app.get('/records', (req, res) => {
    const { name, role } = req.query;
    let query = "SELECT * FROM Records ORDER BY id DESC"; // 預設：管理員/總權限看全部
    let params = [];
    
    // 如果是一般使用者，只能看到自己的記錄
    if (role === 'user') {
        query = "SELECT * FROM Records WHERE borrower_name = ? ORDER BY id DESC";
        params = [name];
    }
    
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: rows });
    });
});

// 2. 借出工具 API
app.post('/borrow', (req, res) => {
    const { tool_name, borrower_name } = req.body;
    const borrow_time = new Date().toLocaleString('zh-TW'); // 取得當下時間
    const status = '借出中';
    
    db.run("INSERT INTO Records (tool_name, borrower_name, borrow_time, return_time, status) VALUES (?, ?, ?, '', ?)", 
    [tool_name, borrower_name, borrow_time, status], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// 3. 歸還工具 API
app.post('/return', (req, res) => {
    const { id } = req.body;
    const return_time = new Date().toLocaleString('zh-TW'); // 取得當下歸還時間
    
    db.run("UPDATE Records SET return_time = ?, status = '已歸還' WHERE id = ?", [return_time, id], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// ==========================================
//          管理員專屬 API 區塊
// ==========================================

// 1. 取得完整人員清單 (包含 ID 與權限)
app.get('/admin/users', (req, res) => {
    db.all("SELECT id, name, role FROM Users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });
        res.json({ success: true, data: rows });
    });
});

// 2. 編輯人員 (修改名稱與權限)
app.post('/admin/edit-user', (req, res) => {
    const { id, name, role } = req.body;
    db.run("UPDATE Users SET name = ?, role = ? WHERE id = ?", [name, role, id], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.json({ success: false, message: '此名稱已有人使用！' });
            return res.status(500).json({ success: false, message: '更新失敗' });
        }
        res.json({ success: true, message: '資料已更新' });
    });
});

// 3. 重設密碼
app.post('/admin/reset-password', (req, res) => {
    const { id, newPassword } = req.body;
    db.run("UPDATE Users SET password = ? WHERE id = ?", [newPassword, id], function(err) {
        if (err) return res.status(500).json({ success: false, message: '密碼重設失敗' });
        res.json({ success: true, message: `密碼已成功重設為：${newPassword}` });
    });
});

// 4. 刪除帳號
app.post('/admin/delete-user', (req, res) => {
    const { id } = req.body;
    db.run("DELETE FROM Users WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '帳號已刪除' });
    });
});
app.listen(port, () => {
    console.log(`伺服器已經順利啟動！網址是 http://localhost:${port}`);
});