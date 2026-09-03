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

            // --- 建立資料表 ---
            // 1. Users 資料表
            db.run(`CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
)`);

            // 2. Tools 資料表 (新增)
            db.run(`CREATE TABLE IF NOT EXISTS Tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    status TEXT DEFAULT 'available',
    borrower TEXT DEFAULT ''
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
    insert.run([name, password, role], function (err) {
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

// ==========================================
//          一般使用者：借出與歸還 API
// ==========================================

// 借出工具
app.post('/borrow', (req, res) => {
    const { toolId, userName } = req.body;
    
    // 更新 Tools 資料表，將狀態改為 borrowed
    // 注意：這裡必須用 function(err) 而不是箭頭函數，才能正確讀取 this.changes
    db.run("UPDATE Tools SET status = 'borrowed', borrower = ? WHERE id = ? AND status = 'available'", 
    [userName, toolId], function(err) {
        if (err) return res.status(500).json({ success: false, message: '借出失敗，請稍後再試' });
        
        // 如果 this.changes 是 0，代表找不到這項工具或它已經被借走了
        if (this.changes === 0) return res.json({ success: false, message: '太遲了！這項工具剛剛被別人借走囉。' });
        
        res.json({ success: true, message: '借出成功！' }); 
    });
});

// 歸還工具
app.post('/return', (req, res) => {
    const { toolId, userName } = req.body;
    
    // 更新 Tools 資料表，將狀態改回 available
    db.run("UPDATE Tools SET status = 'available', borrower = '' WHERE id = ? AND borrower = ?", 
    [toolId, userName], function(err) {
        if (err) return res.status(500).json({ success: false, message: '歸還失敗' });
        
        if (this.changes === 0) return res.json({ success: false, message: '歸還失敗，您可能不是該工具的借出人。' });
        
        res.json({ success: true, message: '歸還成功！' });
    });
});

// ==========================================
//          管理員專屬 API 區塊
// ==========================================

// ==========================================
//          工具清單與借還 API 區塊
// ==========================================

// 1. 取得所有工具與借出狀態 (主畫面與選單用)
app.get('/tools', (req, res) => {
    db.all("SELECT * FROM Tools ORDER BY status ASC, name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取工具失敗' });
        res.json({ success: true, data: rows });
    });
});

// 2. 管理員新增工具
app.post('/admin/add-tool', (req, res) => {
    const { name, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }
    db.run("INSERT INTO Tools (name) VALUES (?)", [name], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.json({ success: false, message: '這個工具名稱已經存在囉！' });
            return res.status(500).json({ success: false, message: '新增失敗' });
        }
        res.json({ success: true, message: '工具新增成功！' });
    });
});

// 3. 管理員刪除工具
app.post('/admin/delete-tool', (req, res) => {
    const { id, operatorRole } = req.body;
    if (operatorRole !== 'admin' && operatorRole !== 'super_admin') {
        return res.status(403).json({ success: false, message: '權限不足' });
    }
    db.run("DELETE FROM Tools WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '工具已刪除' });
    });
});



// 1. 取得完整人員清單 (包含 ID、密碼與權限)
app.get('/admin/users', (req, res) => {
    // 接收前端傳來的操作者權限
    const operatorRole = req.query.role;

    // 從資料庫多抓取 password 欄位
    db.all("SELECT id, name, role, password FROM Users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: '讀取失敗' });

        // 安全機制：如果不是總權限，就將密碼隱藏為星號
        if (operatorRole !== 'super_admin') {
            rows.forEach(r => r.password = '***');
        }
        res.json({ success: true, data: rows });
    });
});

// 2. 編輯人員 (更聰明的防護邏輯)
app.post('/admin/edit-user', (req, res) => {
    const { id, name, role, operatorRole } = req.body;

    // 先查詢這個人原本的權限是什麼
    db.get("SELECT role FROM Users WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: '查詢失敗' });

        const originalRole = row ? row.role : 'user';

        // 邏輯判斷：如果這次的請求試圖「改變權限」，且操作者不是總權限，就擋下
        if (role !== originalRole && operatorRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: '權限不足：只有【總權限者】才可以修改權限！' });
        }

        // 若檢查通過 (可能是總權限在操作，或者是管理員只改名字不改權限)，則執行更新
        db.run("UPDATE Users SET name = ?, role = ? WHERE id = ?", [name, role, id], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.json({ success: false, message: '此名稱已有人使用！' });
                return res.status(500).json({ success: false, message: '更新失敗' });
            }
            res.json({ success: true, message: '資料已更新' });
        });
    });
});

// --- 緊急救援通道：強制把某人升級為總權限 ---
app.get('/make-me-super/:name', (req, res) => {
    const targetName = req.params.name;
    db.run("UPDATE Users SET role = 'super_admin' WHERE name = ?", [targetName], function (err) {
        if (err) return res.send('發生錯誤');
        res.send(`<h1>救援成功！</h1><p>已將 <b>${targetName}</b> 的權限強制升級為總權限！請關閉此分頁，並回到系統重新登入。</p>`);
    });
});
// ----------------------------------------

// 3. 重設密碼
app.post('/admin/reset-password', (req, res) => {
    const { id, newPassword } = req.body;
    db.run("UPDATE Users SET password = ? WHERE id = ?", [newPassword, id], function (err) {
        if (err) return res.status(500).json({ success: false, message: '密碼重設失敗' });
        res.json({ success: true, message: `密碼已成功重設為：${newPassword}` });
    });
});

// 4. 刪除帳號
app.post('/admin/delete-user', (req, res) => {
    const { id } = req.body;
    db.run("DELETE FROM Users WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ success: false, message: '刪除失敗' });
        res.json({ success: true, message: '帳號已刪除' });
    });
});
app.listen(port, () => {
    console.log(`伺服器已經順利啟動！網址是 http://localhost:${port}`);
});