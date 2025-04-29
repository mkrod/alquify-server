const client = "http://localhost:5173"//"https://alquify.app"; //"http://localhost:5173"
//const pro_client = "https://alquify.up.railway.app"; //producction client url
//const pro_client_2 = "https://railway.app"; //production domain
const client2 = "http://localhost" //"https://alquify.app"//"http://localhost";
const this_server_url = "http://localhost:3000"; //"https://api.alquify.app"//"https://alquify-server-production.up.railway.app"; // the url where this will be hosted

const ws_clients = {};
const express = require("express");
const OpenAI = require("openai").OpenAI;
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const uploadDir = "./../../../../xampp/htdocs/temp/";
// Ensure the temp directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir}); //questions
const cors = require("cors");
const argon2 = require("argon2");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");
const PORT = 3000;
const app = express();
const config = require("./config");
const GoogleAuth = require("./google-auth");
const posts = require("./media_handler");

const { createClient } = require("redis");
const { RedisStore } = require("connect-redis"); // <-- Fix this line!


// Create Redis client
const redisClient = createClient({ url: process.env.REDIS_URL });


const redisPublisher = createClient({ url: process.env.REDIS_URL });

const redisSubscriber = createClient({ url: process.env.REDIS_URL });

redisClient.on("error", (err) => console.error("Redis error:", err));

redisClient.connect().then(() => console.log("Connected to Redis"));

module.exports = redisClient;

app.use((req, res, next) => {
    //console.log("Origin:", req.headers.origin);
    next();
});

app.use(express.json());

const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [client, client2, this_server_url, "http://localhost", "http://localhost:5173"];
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    exposedHeaders: ['set-cookie']
};
app.use(cors(corsOptions));


app.use(express.urlencoded({ extended: true }));

const secret = process.env.SESSION_SECRET;

const generateUserID = () => {
    const ID = crypto.randomBytes(10).toString("hex");
    return ID
}

app.use((req, res, next) => {
    //console.log("Incoming Headers:", req.headers);
    next();
});

app.use((req, res, next) => {
    //console.log("Request Cookies:", req.headers.cookie);
    next();
});

const isProduction = process.env.NODE_ENV === 'production';
const cookie = {
    secure: isProduction, // true in production, false in development
    sameSite: isProduction ? 'none' : 'lax',
    httpOnly: false,
    domain: isProduction ? '.alquify.app' : undefined,
    path: "/",
    maxAge: 86400000 // 24h
}

// Session middleware with production-ready config
app.use(
    session({
        store: new RedisStore({ client: redisClient }), // <-- Now works correctly
        name: "_alquify-session-id_", 
        secret: secret,
        resave: false,
        saveUninitialized: false,
        cookie: cookie,
        proxy: true, // Trust reverse proxy
        rolling: true, // Refresh session on activity
    })
);



/*
const cookie = {            
    secure: false,
    sameSite: "lax",
}


//dev
app.use(
    session({
        name: "_alquify-session-id_", 
        secret: secret,
        resave: false,
        saveUninitialized: false,
        cookie: cookie,
        
    })
);
*/


const success = (message, data) => ({
    status: 200,
    message: message,
    data: data,
});

const failed = (message, data) => ({
    status: 500,
    message: message,
    data: data,
});

// WebSocket Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Subscribe to Redis for messages
redisSubscriber.subscribe("chat");
redisSubscriber.on("message", (channel, message) => {
    const data = JSON.parse(message);
    if (ws_clients[data.sender]) {
        ws_clients[data.sender].send(message);
    }
    if (ws_clients[data.receiver]) {
        ws_clients[data.receiver].send(message);
    }
});

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    ws.send(JSON.stringify({ message: 'Welcome to the WebSocket server!' }));

    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        console.log("raw message", message.toString());

        if (data.type === 'register') {
            ws_clients[data.userId] = ws;
            console.log(`${data.userId} is now connected`);
            await redisClient.set(`ws_user:${data.userId}`, "online");

            Object.values(ws_clients).forEach((client) => {
                client.send(JSON.stringify({ type: 'user-online', userId: data.userId }));
            });
        }

        if (data.type === 'send-message') {
            insertMessage(data).then((res) => {
                if (res) {
                    const event = JSON.stringify({ type: 'new-message', sender: data.sender, receiver: data.receiver });
                    redisPublisher.publish("chat", event); // Publish to Redis for syncing across servers
                }
            });
        }
    });

    ws.on('close', async () => {
        for (const userId in ws_clients) {
            if (ws_clients[userId] === ws) {
                delete ws_clients[userId];
                console.log(`WebSocket client ${userId} disconnected`);
                await redisClient.del(`ws_user:${userId}`);
            }
        }
        Object.values(ws_clients).forEach((client) => {
            client.send(JSON.stringify({ type: 'user-offline', clients: Object.keys(ws_clients) }));
        });
    });

});


app.post("/get-user-config", async (req, res) => {
    const { userID } = req.body;

    console.log("userID: ", userID);

    const [result] = await config.db.execute("SELECT * FROM chat_config WHERE user = ?", [userID]);
    console.log("result: ", result[0]);
    res.json(result[0]);
})



// Google auth callback route
app.get("/auth/callback", async (req, res) => {
    console.log("Google Auth now getting code and user Details...");
try{
    const code = req.query.code;
    if(!code) return res.send("Inappropriate Request or No code from auth");
    const userInfo = await GoogleAuth.getUserInfoFromGoogleAuth(code);
     console.log("User Info: ", userInfo);
    if(!userInfo) return console.log("Code returned no userInfo - code: ", code);
    const user_id = `${userInfo?.given_name?.toString()?.toLowerCase()}-${userInfo?.sub}` || "";
    if(user_id === "") return console.log("No UserId found from: ", userInfo);


    const [results] = await config.db.execute("SELECT * FROM users WHERE email = ?", [userInfo?.email]);
    //console.log("sql: ", results);
    if (results.length === 0) {
        const [results] = await config.db.execute("INSERT INTO users (user_id, email, auth_method, social_auth_id) VALUES (?, ? , ?, ?)", [user_id, userInfo?.email, "google", userInfo?.sub]);
        if (results.affectedRows > 0) {
            req.session.isLoggedIn = true;
            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.send(failed("Session error", {}));
                }
                console.log("should be true");
                //res.send(success("started", { isLoggedIn: req.session.isLoggedIn }));
            });
            req.session.email = userInfo.email;
            req.session.user_id = user_id;

            res.cookie("user_email", userInfo.email, cookie);
            res.cookie("user_id", user_id, cookie);
            

            
            res.send(`
                <html>
                    <body>
                        <script>
                            var newTab = window.open("${client}/dash", "_blank");
                            window.opener = null;
                            window.close();
                        </script>
                    </body>
                </html>
        ` );
           }
    } else {

            req.session.isLoggedIn = true;
            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.send(failed("Session error", {}));
                }
            });
            req.session.email = userInfo.email;
            req.session.user_id = user_id;
            
            res.cookie("user_email", userInfo.email, cookie);
            res.cookie("user_id", user_id, cookie);
            console.log("Set Cookies: ", userInfo.email + " and " + userInfo.sub)
            //res.send(success("started", { isLoggedIn: req.session.isLoggedIn }));
            
            res.send(`
                <html>
                    <body>
                        <script>
                            var newTab = window.open("${client}/dash");
                            window.opener = null;
                            window.close();
                        </script>
                    </body>
                </html>
        ` );
            
    }

}catch(err){
    console.log("Google Auth Error: ", err);
}

});


// Start session route
app.post("/start-session", async (req, res) => {
    req.session.isLoggedIn = true;
    req.session.save((err) => {
        if (err) {
            console.error("Session save error:", err);
            return res.send(failed("Session error", {}));
        }
        //console.log("inside start session started")
        res.send(success("started", { isLoggedIn: true }));
    });
});

// Check session status route
app.post("/is-logged-in", async (req, res) => {
    //console.log("Session data in /is-logged-in:", req.session);
    if (req.session?.isLoggedIn) {
        res.send(success("started", { isLoggedIn: req.session.isLoggedIn }));
    } else {
        res.send(success("not started", { isLoggedIn: req.session.isLoggedIn }));
    }
});



// Sign-up route
app.post("/sign-up", async (req, res) => {
    const { email, password, auth_checkbox } = req.body;
    const method = "local";
    const hashedPassword = await argon2.hash(password);
    const userID = email.slice(0,2) + "-" + generateUserID();

    try {
        const results = await config.db.execute("SELECT * FROM users WHERE email = ? ", [email]);
        console.log("check existing user: ", results)
        if (results[0].length === 0) {
            const results = await config.db.execute("INSERT INTO users (user_id, email, password, auth_method) VALUES (?, ?, ?, ?)", [userID, email, hashedPassword, method]);
            if (results?.affectedRows > 0) {
                req.session.isLoggedIn = true;
                req.session.email = email;
                req.session.user_id = userID;
            }

            
            res.send(JSON.stringify(success("success", { userExists: false, remember: auth_checkbox === 'on', data: {email, user_id: userID} })));
        } else {
            res.send(JSON.stringify(failed("error", { userExists: true })));
        }
    } catch (err) {
        console.log("Error:", err);
        res.send(failed("error", { message: err.message }));
    }
});

app.post("/login", async (req, res) => {
    const { email, password, auth_checkbox } = req.body;

    try {
        const results = await config.db.execute("SELECT * FROM users WHERE email = ? ", [email]);
        //console.log("Results:", results[0][0]);
        if (results[0].length > 0) {
            const user = results[0][0];
            const isPasswordMatch = await argon2.verify(user.password, password);
            if (isPasswordMatch) {
                req.session.isLoggedIn = true;
                req.session.email = email;
                req.session.user_id = user.user_id;
                res.send(JSON.stringify(success("success", { remember: auth_checkbox === 'on', data: user })));
            } else {
                res.send(JSON.stringify(failed("error", { message: "Invalid email or password" })));
            }
        } else {
            res.send(JSON.stringify(failed("error", { message: "Invalid email or password" })));
        }
    } catch (err) {
        console.log("Error:", err);
        res.send(failed("error", { message: err.message }));
    }
    
});






app.post("/get-messages", async (req, res)  => {
    const {msg_client, reciever} = req.body;

    //console.log(req.body)
    const [results] = await config.db.execute(`SELECT * FROM messages WHERE incoming_id = "${msg_client}" AND outgoing_id  = "${reciever}" OR incoming_id = "${reciever}" AND outgoing_id  = "${msg_client}"`);

    if(results[0]){
        res.json(results);
    }
});

app.post("/user-get-messages", async (req, res)  => {
    const { currentChat } = req.body;

    //console.log(req.body)
    const [results] = await config.db.execute(`SELECT * FROM messages WHERE incoming_id = "${currentChat}" AND outgoing_id  = "${req.session.user_id}" OR incoming_id = "${req.session.user_id}" AND outgoing_id  = "${currentChat}"`);

    if(results[0]){
        res.json(results);
    }
});


app.get("/fetch-message-list", async (req, res) => {

    if(!req.session.user_id) return res.json([]);
    const user_id = req.session.user_id;

    const sql = `SELECT 
        m1.outgoing_id,
        m1.incoming_id, 
        m1.outgoing_msg, 
        m1.file,
        m1.msg_timestamp, 
        m1.msg_date,
        (SELECT COUNT(*) FROM messages m2 
        WHERE m2.outgoing_id = m1.outgoing_id 
        AND m2.incoming_id = ? 
        AND m2.viewed = FALSE) AS message_count
        FROM messages m1
        WHERE (m1.outgoing_id = ? OR m1.incoming_id = ?)
        AND m1.id = (SELECT MAX(m3.id) FROM messages m3
                     WHERE (m3.outgoing_id = m1.outgoing_id AND m3.incoming_id = m1.incoming_id) 
                     OR (m3.outgoing_id = m1.incoming_id AND m3.incoming_id = m1.outgoing_id))
        ORDER BY m1.id DESC`;

    const [result] = await config.db.execute(sql, [user_id, user_id, user_id]);
    console.log("reults: ", result)
    res.json(result);
});



app.post("/send-message", upload.single("file"), async (req, res) => {
    //console.log("FormData: ", req.body)

    const { sender, reciever, date, time, message } = req.body;
    let fileName = "";
    if(req.file){
        const media = req.file;
        const originalname = media.originalname;
        const mediaTmp = media.path;
        const size = media.size;
        const ext = path.extname(originalname).toLowerCase();
        const newMediaName = `${originalname}-${sender}_${Date.now()}${ext}`;
        //console.log("newMediaName: ", newMediaName);

        fileName = newMediaName;
    }

    const [results] = await config.db.execute("INSERT INTO messages (incoming_id, outgoing_id, outgoing_msg, file, msg_timestamp, msg_date) VALUES (?, ?, ?, ?, ?, ?)", [
        reciever,
        sender,
        message,
        fileName,
        time,
        date
    ])

    //console.log("insert result: ", results);
    if(fileName !== "" ||  req?.file?.size > 0){
        
        const newPath = path.join(uploadDir, fileName);
        //console.log(req.file.path, newPath)

        try {
            // Move file to new location
            fs.renameSync(req.file.path, newPath);
            //console.log("File moved successfully");
        } catch (error) {
            console.error("Error moving file:", error);
            return res.status(500).json({ error: "File move failed" });
        }
    }


    if(results.affectedRows > 0){
        const event = JSON.stringify({ type: 'new-message', sender, reciever }); 
        ws_clients[sender]?.send(event)
        ws_clients[reciever]?.send(event)
        return null;
    }else{
        return;
    }

    

    //console.log(`${sender} sent "${message}" to ${reciever} at ${date}  ${time}`)
})


app.post("/reg-chat-data", upload.single("file"), async (req, res) => {

    console.log("type: ", req.body.request_type);

    if(req.body.request_type === "check"){
        const [result] = await config.db.execute("SELECT * FROM chat_config WHERE user = ?", [req?.session?.user_id]);
        if(result.length === 0){
            res.json(JSON.stringify(success("not_registered", null)))
        }else{
            res.json(JSON.stringify(success("registered", null)))
        }



    }else if(req.body.request_type === "register"){

    const { name, website, theme, scheme, welcome_msg, suggested_msg } = req.body;
    const sug_msg = JSON.parse(suggested_msg);
    let keys = sug_msg.map((_, i) => `suggested_${i + 1}`).join(",");
    //let values = sug_msg.join(",");
    let placeholders = sug_msg.map(() => "?").join(",");

    console.log("session: ", req.session)
    console.log("user: ", req.session.email)
    console.log("Keys:", keys);
    //console.log("Values:", values);
    console.log("Placeholders:", placeholders);

    let fileName = "";



    if(req.file && req.session.email){
        const file = req.file;
        const originalname = file.originalname;
        const fileTmp = file.path;
        //const size = file.size;
        const ext = path.extname(originalname).toLowerCase();
        const newMediaName = `${originalname}-${req.session.email}_${Date.now()}${ext}`;
        //console.log("newMediaName: ", newMediaName);

        

        fileName = newMediaName;
    }

    if(fileName && req.session.email){
        const [result] = await config.db.execute(`INSERT INTO chat_config (user, org_name, org_web, theme, scheme, welcome_msg, ${keys}, file) VALUES (?,?,?,?,?,?,${placeholders},?)`, [req.session.email, name, website, theme, scheme, welcome_msg, ...sug_msg, fileName]);

        console.log(result);
        if(result?.affectedRows > 0){
            res.json(JSON.stringify(success("success", null)));
        }
    }



  }
});



app.post("/ai-assist-message", async (req, res) => {
    const {q} = req.body;
    const openai = new OpenAI({
        apiKey: config.open_ai.api_key,
    });

   // console.log("q: ", q);git

    
    
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            {
                role: "user",
                content: q,
            },
        ],
        store: true,
    });
    
    res.json({data: completion.choices[0].message});

});


app.post("/user-send-message", upload.single("file"), async (req, res) => {
    const { reciever, date, time, message, channel } = req.body;
    const sender = req.session.user_id;  


    let fileName = "";
    if(req.file){
        const media = req.file;
        const originalname = media.originalname;
        const mediaTmp = media.path;
        const size = media.size;
        const ext = path.extname(originalname).toLowerCase();
        const newMediaName = `${originalname}-${sender}_${Date.now()}${ext}`;
        //console.log("newMediaName: ", newMediaName);

        fileName = newMediaName;
    }

    const [results] = await config.db.execute("INSERT INTO messages (incoming_id, outgoing_id, outgoing_msg, file, msg_timestamp, msg_date) VALUES (?, ?, ?, ?, ?, ?)", [
        reciever,
        sender,
        message,
        fileName,
        time,
        date
    ])

    if(results.affectedRows > 0){
        const event = JSON.stringify({ type: 'new-message', sender, reciever }); 
        ws_clients[sender]?.send(event)
        ws_clients[reciever]?.send(event)
        res.json(JSON.stringify(success("success", null)));
        return null;
    }else{
        return;
    }

    //console.log(`${sender} sent "${message}" to ${reciever} at ${date}  ${time}`)
});


app.post("/update-profile", upload.none(), async (req, res) => {
    console.log(req.body);
    const data = req.body;

    // Remove empty values
    const filteredData = Object.fromEntries(
        Object.entries(data).filter(([_, value]) => value.trim() !== "")
    );

    const keys = Object.keys(filteredData);
    const values = Object.values(filteredData);

    if (keys.length > 0) { 
        const setClause = keys.map(key => `${key} = ?`).join(", ");
        const sql = `UPDATE users SET ${setClause} WHERE user_id = ?`;

        // ✅ Corrected: Ensure user_id is added to values array
        const [result] = await config.db.query(sql, [...values, req.session.user_id]);

        if(result.affectedRows > 0){
            // ✅ Corrected: Use req.session.user_id instead of req.session.id
            const [result2] = await config.db.execute("SELECT * FROM users WHERE user_id = ?", [req.session.user_id]);
            return res.json(result2[0]);
        }
    } 

    res.status(400).json({ error: "No valid data provided" });
});








app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.status(500).send('Failed to logout');
        }

        // Clear the cookie from the client side too
        res.clearCookie('_alquify-session-id_');
        console.log("Session: ", req.session);
        res.send(true);
    });
});

/////////////////////
///////////////////
////////////////////////
///////////////////////
////////socials codes////////
/////////////////////////////
//////////////////////////
//////////////////
///////////////////
////////////////////////
///////////////////////
const axios = require('axios');
/*
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');

passport.use( new OAuth2Strategy({
      authorizationURL: 'https://www.facebook.com/v17.0/dialog/oauth',
      tokenURL: 'https://graph.facebook.com/v17.0/oauth/access_token',
      clientID: config.facebook.client_id,
      clientSecret: config.facebook.client_secret,
      callbackURL: config.facebook.redirect_uris[0],
    },(accessToken, refreshToken, profile, done) => {
      return done(null, { accessToken, refreshToken });
    }) );

app.get('/auth/socials/facebook', passport.authenticate('oauth2'));
app.get('/auth/callback', passport.authenticate('oauth2', { failureRedirect: '/' }), (req, res) => {

      res.send('Authentication successful!');

});
*/

app.get('/auth/facebook/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.redirect(`${client}/dash/socials/`);
    }
  
    try {
      // Step 1: Exchange code for short-lived access token
      const tokenResponse = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
        params: {
          client_id: config.facebook.client_id,
          client_secret: config.facebook.client_secret,
          redirect_uri: config.facebook.redirect_uris[0],
          code,
        },
      });
  
      const { access_token: shortLivedToken } = tokenResponse.data;
  
      // Step 2: Exchange short-lived token for long-lived token
      const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: config.facebook.client_id,
          client_secret: config.facebook.client_secret,
          fb_exchange_token: shortLivedToken,
        }
      });
  
      const longLivedToken = response.data.access_token; // This is the long-lived token

      console.log("Long-lived token:", longLivedToken); 
  
      // Step 3: Store token in session
      req.session.fb_accessToken = longLivedToken;
  
      // Step 4: Store or update in database
      const [result] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [req.session.user_id]);
  
      if (result && result.length > 0) {
        const [update] = await config.db.execute("UPDATE social_tokens SET fb_token = ? WHERE user_id = ?", [longLivedToken, req.session.user_id]);
        if (update.affectedRows > 0) {
            res.cookie("linked_account", "facebook", { maxAge: 5000, httpOnly: false }); // Temporary
          return res.redirect(`${client}/dash/socials/`);
        }
      } else {
        const [insert] = await config.db.execute("INSERT INTO social_tokens (user_id, fb_token) VALUES (?, ?)", [req.session.user_id, longLivedToken]);
        if (insert.affectedRows > 0) {
            res.cookie("linked_account", "facebook", { maxAge: 5000, httpOnly: false }); // Temporary
          return res.redirect(`${client}/dash/socials/`);
        }
      }
  
      // If it reaches here, something went wrong
      res.status(500).json({ error: "Token stored but failed to redirect." });
  
    } catch (error) {
      console.error("Error getting Facebook token:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to get access token" });
    }
  });
  


app.get('/auth/get-fb-token', (req, res) => {
    const token = req.session?.fb_accessToken;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ access_token: token });
});

const token_manager = require("./token_manager");
app.get('/auth/get-tokens', async (req, res) => {
    try{
            const user_id = req.session.user_id;
            if(!user_id) return console.log("No UserID to Fetch Token");

            //object of the token saved as redisClient.set(`${req.session?.user_id}_platformname_token`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
            const tiktok_token = await redisClient.get(`${req.session?.user_id}_tiktok_token`);
            const x_token = await redisClient.get(`${req.session?.user_id}_x_token`);
            const fb_token = await redisClient.get(`${req.session?.user_id}_fb_token`);
            const linkedin_token = await redisClient.get(`${req.session?.user_id}_linkedin_token`);
            const ig_token = await redisClient.get(`${req.session?.user_id}_ig_token`);
            const youtube_token = await redisClient.get(`${user_id}_youtube_tokens`);
            //console.log('youtube_token ', youtube_token)

            //check if any of them have expire then refresh them and update the db before sending them to the frontend
            if(x_token){
                const is_x_expired = token_manager.isTokenExpired(JSON.parse(x_token));
                if(x_token && is_x_expired){
                    const response = await token_manager.handleRefresh("x", JSON.parse(x_token), user_id);
                    if(response !== "done") return console.log("Cannot Refresh X Token");
                }
            }

            if(tiktok_token){
                const is_tiktok_expired = token_manager.isTokenExpired(JSON.parse(tiktok_token));
                //console.log("Tiktok Expired: ", is_tiktok_expired);
                if(tiktok_token && is_tiktok_expired){
                 const response = await token_manager.handleRefresh("tiktok", JSON.parse(tiktok_token), user_id);
                  if(response !== "done") return console.log("Cannot Refresh Tiktok Token");
                }  
            }

            if(fb_token){
                const is_fb_expired = token_manager.isTokenExpired(JSON.parse(fb_token));
                if(fb_token && is_fb_expired){
                    const response = await token_manager.handleRefresh("facebook", JSON.parse(fb_token), user_id);
                    if(response !== "done") return console.log("Cannot Refresh Facebook Token");
                }
            }

            if(linkedin_token){
                const is_linkedin_expired = token_manager.isTokenExpired(JSON.parse(linkedin_token));
                if(linkedin_token && is_linkedin_expired){
                    const response = await token_manager.handleRefresh("linkedin", JSON.parse(linkedin_token), user_id);
                    if(response !== "done") return console.log("Cannot Refresh LinkedIn Token");
                }
            }

            if(ig_token){
                const is_ig_expired = token_manager.isTokenExpired(JSON.parse(ig_token));
                if(ig_token && is_ig_expired){
                    const response = await token_manager.handleRefresh("instagram", JSON.parse(ig_token), user_id);
                    if(response !== "done") return console.log("Cannot Refresh Instagram Token");
                }
            }

            //console.log("YT token: ", youtube_token);
            if(youtube_token){
                const is_youtube_expired = token_manager.isTokenExpired(JSON.parse(youtube_token));
                //console.log("YT Expired: ", is_youtube_expired);
                if(youtube_token && is_youtube_expired){
                    const response = await token_manager.handleRefresh("youtube", JSON.parse(youtube_token), user_id);
                    if(response !== "done") return console.log("Cannot Refresh Youtube Token");
                }
            }




            const sql = `SELECT * FROM social_tokens WHERE user_id = ?`;
            const [results] = await config.db.execute(sql, [user_id]);
            if(results.length > 0){
                const data = results[0];
                return res.json(success("success", data));

            }else{
                return res.json(success("empty", null));
            }
        }catch(error){
            console.log("Get Token Error: ", error?.response?.data || error?.message);
                return res.json(failed("error", null));
        }
});


////////////// linkedin



app.get('/auth/linkedin/callback', async (req, res) => {
    const { code } = req.query;
    console.log("linkedin code: ", code);
    if (!code) {
       return res.redirect(`${client}/dash/socials/`);
    }
    
    try {
      // Step 1: Exchange code for access token
      const tokenResponse = await axios.post(`https://www.linkedin.com/oauth/v2/accessToken`, null, {
        params: {
          grant_type: 'authorization_code',
          code,
          client_id: config.linkedin.client_id,
          client_secret: config.linkedin.client_secret,
          redirect_uri: config.linkedin.redirect_uris[0],
        },
      });
  
      const { access_token: linkedInToken } = tokenResponse.data;
  
      // Step 2: Store token in session
      req.session.linkedin_accessToken = linkedInToken;
  
      // Step 3: Store or update in database
      const [result] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [req.session.user_id]);
  
      if (result && result.length > 0) {
        const [update] = await config.db.execute("UPDATE social_tokens SET linkedin_token = ? WHERE user_id = ?", [linkedInToken, req.session.user_id]);
        if (update.affectedRows > 0) {

          res.cookie("linked_account", "linkedin", { maxAge: 5000, httpOnly: false }); // Temporary
          return res.redirect(`${client}/dash/socials/`);// send a view-once cookie alongside the redirect e.g query param, then on the clientside on sociallayout inside useEffect with empty dependency, check for the cookie and display the modal or check for the param in the url and display the modal, then remove the param appropriately..., 
        }
      } else {
        const [insert] = await config.db.execute("INSERT INTO social_tokens (user_id, linkedin_token) VALUES (?, ?)", [req.session.user_id, linkedInToken]);
        if (insert.affectedRows > 0) {
          res.cookie("linked_account", "linkedin", { maxAge: 5000, httpOnly: false }); // Temporary
          return res.redirect(`${client}/dash/socials/`);
        }
      }
  
      // If it reaches here, something went wrong
      res.status(500).json({ error: "Token stored but failed to redirect." });
  
    } catch (error) {
      console.error("Error getting LinkedIn token:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to get access token" });
    }
  });
  

/////////////
//////////////
const { TwitterApi } = require('twitter-api-v2');

const twitterClient = new TwitterApi({
    appKey: config.x.consumer.api_key,
    appSecret: config.x.consumer.api_key_secret,
    accessToken: config.x.authenticationToken.access_token,
    accessSecret: config.x.authenticationToken.access_token_secret,
});

app.get('/twitter-auth', async (req, res) => {
    console.log("Twitter Auth");
    try {
      const { url, oauth_token, oauth_token_secret } = await twitterClient.generateAuthLink(config.x.OAuth2_0.redirect_uris[0]);
      console.log("Twitter Auth 2");

      console.log("OAuth Token:", oauth_token);
      console.log("OAuth Token Secret:", oauth_token_secret);
      // Store token secret in session for later verification
      req.session.x_oauth_token_secret = oauth_token_secret;
      res.redirect(url);
    } catch (error) {
        console.log("Error getting authorization link:", error.message);
      res.status(500).send('Error getting authorization link');
    }
  });



  // Route: Handle callback from Twitter
  app.get("/auth/x/callback", async (req, res) => {
    console.log("Query Params:", req.query);

    const { oauth_token, oauth_verifier } = req.query;
    const x_oauth_token_secret = req.session.x_oauth_token_secret;

    console.log("Stored OAuth Token Secret:", x_oauth_token_secret);
    console.log("Received OAuth Token:", oauth_token);
    console.log("Received OAuth Verifier:", oauth_verifier);

    if (!oauth_token || !oauth_verifier || !x_oauth_token_secret) {
        console.error("Invalid OAuth request: Missing required parameters");
        return res.status(400).send('Invalid OAuth request');
    }

    try {
        // Create a new TwitterApi instance with the request token and secret
        const requestClient = new TwitterApi({
            appKey: config.x.consumer.api_key,
            appSecret: config.x.consumer.api_key_secret,
            accessToken: oauth_token, // From the request query
            accessSecret: x_oauth_token_secret // From the session
        });

        // Exchange the verifier for access tokens
        const { client: userClient, accessToken, accessSecret } = await requestClient.login(oauth_verifier);

        console.log("Access Token:", accessToken);
        console.log("Access Secret:", accessSecret);
        console.log("Client:", userClient);

        // Save tokens for future API calls if needed
       // req.session.accessToken = accessToken;
        //req.session.accessSecret = accessSecret;

        const [result] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [req.session.user_id]);

        if(result && result.length > 0){

            const [result] = await config.db.execute("UPDATE social_tokens SET x_token = ?, x_access_secret = ? WHERE user_id = ?", [ accessToken, accessSecret, req.session.user_id]);
            if(result && result.affectedRows > 0){
                //res.send('Authorization successful!');
                res.cookie("linked_account", "x", { maxAge: 5000, httpOnly: false }); // Temporary
                return res.redirect(`${client}/dash/socials`);
            }


        }else{

            const [result] = await config.db.execute("INSERT INTO social_tokens (user_id, x_token, x_access_secret) VALUES (?, ?, ?)", [req.session.user_id, accessToken, accessSecret]);
            if(result && result.affectedRows > 0){
                //res.send('Authorization successful!');
                res.cookie("linked_account", "x", { maxAge: 5000, httpOnly: false }); // Temporary
                return res.redirect(`${client}/dash/socials`);
            }

        }   
    } catch (error) {
        console.error("Error getting access tokens:", error);
        res.status(500).send('Error getting access tokens');
    }
});



////////x
app.post('/x-user-profile', async (req, res) => {
    const { token } =  req.body;
    let x_accessSecret = req.session.x_accessSecret;
    if(!x_accessSecret){
        const [query] = await config.db.execute("SELECT x_access_secret FROM social_tokens WHERE user_id = ?", [req.session.user_id]);
        x_accessSecret = query[0].x_access_secret;
      }
    try {

        const userClient = new TwitterApi({
            appKey: config.x.consumer.api_key,
            appSecret: config.x.consumer.api_key_secret,
            accessToken: token,  // Stored in session after callback
            accessSecret: x_accessSecret
        });

        const user = await userClient.v2.me({ "user.fields": "profile_image_url" }); // Get authenticated user's profile
        console.log("twitter user: ", user)
        res.json(user);
    } catch (error) {
        res.status(500).send('Error fetching user profile');
    }
});


app.post("/x-base", async (req, res) => {
    const { action } = req.body;


});







const ig = require("./ig_api");
////////////////////////////IG////////////////////////////////////////////////////////
const open = async (url) => (await import('open')).default(url); //can uninstall in production
app.get("/auth/instagram/callback/bypass", async (req, res) => {
    //this route is used to bypass https.. remove in production when server is on https.. and add the redirect url direct https://api.domain.com/thiscallback
    const queryParams = new URLSearchParams(req.query).toString();
    open(`http://localhost:3000/auth/instagram/callback?${queryParams}`, "_self");
});
app.get("/auth/instagram/callback", async (req, res) => {
    //logics for getting the access token from the auth code
    console.log("Instagram Callback: ", req.query);
    if(req.query.error && req.query.error === "access_denied"){
        res.redirect(`${client}/dash/socials`)
    }
    const user_id = req.session.user_id;
    if(!user_id) {
        console.log("No user ID to proceed for Instagram auth");
        return res.send("Internal server Error: 500");
    }
    const { code } = req.query;
    if(!code) {
        console.log("No Code From Instagram auth");
        return res.send("Cannot Complete Request: 401");
    }

    const response = await ig.getAccessToken(code);
    console.log("ShortLivedToken: ", response);
    if(!response){
        console.log("Cannot Get Short Lived Token");
        return res.send("Cannot Complete ShortLivedToken Request: 401");
    }

    req.session.instagram_user_id = String(response.user_id);
    const request = await ig.getLongLivedToken(response.access_token);
    if(!request){
        console.log("Cannot Get Long Lived Token");
        return res.send("Cannot Complete LongLivedToken Request: 401");
    }

///////////
    let { access_token, expires_in } = request;
    expires_in -= 3600 * 7;

    const refresh_token = access_token;
    const refresh_expires_in = expires_in;

    if(!refresh_token || !access_token) {
        console.log("No Access Token|| Refresh Token for Instagram");
        return null;
    }


    const [result] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [user_id]);
    if(result.length === 0){
        await redisClient.set(`${user_id}_ig_token`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
        const [insert] = await config.db.execute("INSERT INTO social_tokens (user_id, ig_token, ig_bus_id, ig_refresh_token) VALUES (?, ?, ?, ?)", [user_id, access_token, req.session.instagram_user_id, refresh_token]);
        if(insert.affectedRows > 0){
            // success
            res.cookie("linked_account", "instagram", { maxAge: 5000, httpOnly: false }); // Temporary
            return res.redirect(`${client}/dash/socials/`);
        }else{
            //failed
        }
    }else{
        await redisClient.set(`${user_id}_ig_token`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
        const [result] = await config.db.execute("UPDATE social_tokens set ig_token = ?, ig_bus_id = ?, ig_refresh_token = ? WHERE user_id = ?", [access_token, req.session.instagram_user_id, refresh_token, user_id]);
        res.cookie("linked_account", "instagram", { maxAge: 5000, httpOnly: false }); // Temporary
        return res.redirect(`${client}/dash/socials/`);
    }
    
});


/*
    //assuming the logic for callback is here and we have gotten the access token from the auth and save to session first
    const shortLivedToken = "EAANx9sehnT0BO3qbU6Bfakp0gkg6WLPPHzRszsozW8ZCOdJaBFNHBCfSZB93Wyj7hhV5wO10uYCTnGN4TaJIQvfHCaQvbSElTBx9HMh0xu73AbHwjx9n4kZAYRM6pdYPpiGQX4mcd7SZCc5ueKiKc5t97ETbntqCniCDS4XYc1fee8WLEBDE7Wqin3od86skLBdJ8hmv40IwKtyFfAZDZD"; //assuming we have gotten the access token from the auth and save to session first
    const longLivedToken = await ig.getLongLivedToken(shortLivedToken);
    console.log("Long-lived token: ", longLivedToken);
    req.session.meta_accessToken = longLivedToken; //save to session
    //now lets query the endpoint to fetch the user pages and return it to front-end... continue in another route below this

    const accessToken = longLivedToken;
    const response = await ig.getIgFbPages(accessToken);
    console.log("response: ", JSON.stringify(response.data.data, null, 2));
    
    
    const transformedData = response.data.data.map(item => ({
        title: "Choose The page linked to your Instagram account",
        id: item.id || null,
        picture: item.picture.data.url || null,
        name: item.name || null,
        username: item.username || null,            
        platform: "instagram",
        type: "select",
        category: item.category || null,
    }));


    console.log("Transformed Data: ", transformedData);

    res.cookie("fb_pages", JSON.stringify(transformedData), {...cookie, maxAge: 10000}); // Temporary
    res.redirect(`${client}/dash/socials/`); // Temporary
    */


/*
app.get("/get-id-from-fb-page", async (req, res) => {
    const { page_id } = req.query;
    console.log("page_id: ", page_id);


    //get the access token from the session and the page id from the query params
    const accessToken = req.session.meta_accessToken;
    console.log("accessToken: ", accessToken);
    if(!accessToken) return res.json(failed("error", { message: "No access token" }));
    if(!page_id) return res.json(failed("error", { message: "No page id" }));

    //get the page id from the fb page id
    const instagram_id = await ig.getIgUserId(page_id, accessToken);
    console.log("response: ", instagram_id);
    if(instagram_id){
        req.session.fb_page_id = page_id; //save to session
        console.log("session: ", req.session);
        //use the id to fetch user details
        const ig_user_details = await ig.getIgUserDetails(instagram_id, accessToken); 
        console.log("ig_user_details: ", ig_user_details.data);

        const data = {
            title: "Confirm Your Instagram Account",
            id: ig_user_details.data.id || null,
            picture: ig_user_details.data.profile_picture_url || null,
            name: ig_user_details.data.name || null,
            username: ig_user_details.data.username || null,
            platform: "instagram",
            type: "confirm",
            category: ig_user_details.data.category || null,
        }
        res.json(success("success", [data]));
        return;

    }else{
        res.json(failed("error", { message: "No Instagram account linked to this page" }));
        return;
    }
});

app.post("/save-instagram-token", async (req, res) => {
    const { ig_bus_id } = req.body;
    const accessToken = req.session.meta_accessToken;
    const fb_page_id = req.session.fb_page_id;

    const [result] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [req.session.user_id]);
    console.log("result: ", result);
    if(result && result.length > 0){
        const [update] = await config.db.execute("UPDATE social_tokens SET ig_token = ?, ig_bus_id = ?, fb_page_id = ? WHERE user_id = ?", [accessToken, ig_bus_id, fb_page_id, req.session.user_id]);
        if(update.affectedRows > 0){
            res.cookie("linked_account", "instagram", { maxAge: 5000, httpOnly: false }); // Temporary
            return res.json(success("success", null));
        }
    } else {
        const [insert] = await config.db.execute("INSERT INTO social_tokens (user_id, ig_token, ig_bus_id, fb_page_id) VALUES (?, ?, ?, ?)", [req.session.user_id, accessToken, ig_bus_id, fb_page_id]);
        if(insert.affectedRows > 0){
            res.cookie("linked_account", "instagram", { maxAge: 5000, httpOnly: false }); // Temporary
            return res.json(success("success", null));
        }
    }
});

*/

const tiktok = require("./tiktok");

function generateCodeVerifier(length = 64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256')
      .update(verifier)
      .digest('hex'); // TikTok expects hex, not base64url
}


app.get("/tiktok/auth", (req, res) => {

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    req.session.tiktok_code_verifier = codeVerifier;
    console.log("Saved Verifier: ", codeVerifier);
    const scope = 'user.info.basic,user.info.profile,video.upload,video.list,video.publish,user.info.stats';
    const redirect_uri = `${this_server_url}/auth/tiktok/callback`;

    const url = `https://www.tiktok.com/v2/auth/authorize?` +
        `client_key=${process.env.TIKTOK_CLIENT_ID}` +
        `&scope=${encodeURIComponent(scope)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`;

    res.redirect(url);
});




app.get("/auth/tiktok/callback", async (req, res) => {
    //console.log(`Tiktok Auth Payload: ${JSON.stringify(req.query, 2, null)}`);


    const { code } = req.query;
    if(!code) {
        return res.send("No Code From Tiktok Auth: "+JSON.stringify(req.session, 2, null));
        //return null;
    }
    const codeVerifier = req.session.tiktok_code_verifier;
    console.log("Verifier: ", codeVerifier);
    if (!codeVerifier) return res.send("Missing verifier");


    const response = await tiktok.getAuthToken(code, codeVerifier);
    console.log("Tiktok Token Response: ", response);
    const { access_token, expires_in, open_id, refresh_token, refresh_expires_in } = response;
    if(!refresh_token || !access_token) {
        console.log("No Access Token|| Refresh Token for Tiktok");
        return null;
    }
    const [result] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [req.session?.user_id]);
    if(result.length === 0){
        await redisClient.set(`${req.session?.user_id}_tiktok_token`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
        const [result] = await config.db("INSERT INTO social_tokens (user_id, tiktok_token, tiktok_refresh_token) VALUES (?,?,?)", [req.session?.user_id, access_token, refresh_token]);
        if(result.affectedRows > 0){
            // success
            res.cookie("linked_account", "tiktok", { maxAge: 5000, httpOnly: false }); // Temporary
            return res.redirect(`${client}/dash/socials/`);
        }else{
            //failed
        }
    }else{
        await redisClient.set(`${req.session?.user_id}_tiktok_token`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
        const [result] = await config.db.execute("UPDATE social_tokens set tiktok_refresh_token = ?, tiktok_token = ? WHERE user_id = ?", [refresh_token, access_token, req.session?.user_id]);
        res.cookie("linked_account", "tiktok", { maxAge: 5000, httpOnly: false }); // Temporary
        return res.redirect(`${client}/dash/socials/`);
    }
    
   // await redisClient.set(`${req.session.user_id}_tiktok_auth_data`, JSON.stringify({access_token, expires_in, open_id, refresh_token, refresh_expires_in}));


});

app.get("/tiktok/posts", async (req, res) => {
    const { type } = req.query //useless
    const { user_id } = req.session;
    if(!user_id) return console.log("UserID not Available to Fetch Tiktok Post");
    // check if the post is in cache redis
    const cache_key = `${user_id}_tiktok_posts`;
    const cache_ttl = 60 * 5;

    const cachePost = await redisClient.get(cache_key);
    if(cachePost){
        console.log("Returning Tiktok post from cache for " + user_id);
        return res.json(success("success", JSON.parse(cachePost)));
    }

    const tiktok_token = await redisClient.get(`${user_id}_tiktok_token`);
    if(tiktok_token){
        const is_tiktok_expired = token_manager.isTokenExpired(JSON.parse(tiktok_token));
        if(tiktok_token && is_tiktok_expired){
         const response = await token_manager.handleRefresh("tiktok", JSON.parse(tiktok_token), user_id);
          if(response !== "done") return console.log("Cannot Refresh Tiktok Token");
        }  
    }

    const [result] = await config.db.execute("SELECT tiktok_token FROM social_tokens WHERE user_id = ?", [user_id]);
    if(result.length === 0) return console.log("No Token in Database for Tiktok user: " + user_id);
    //console.log("SQL Tiktok token: ", result[0].tiktok_token);
    const response = await tiktok.getPosts(result[0].tiktok_token);
    //console.log("Tiktok Posts: ", JSON.stringify(response, null, 2));
    if(!response) {
        console.log("Tiktok Post Empty");
        return;
    }

    const formatted = await posts.format("tiktok", response, result[0].tiktok_token, "VIDEO");
    //console.log("Formatted", formatted);

    await redisClient.set(cache_key, JSON.stringify(formatted), {
        EX: cache_ttl
    });

    //console.log("Fetched fresh Tiktok posts and cached");

    return res.json(success("success", formatted));

});


app.get("/tiktok/webbhook", async (req, res) => {
    res.send(`Tiktok Webhook Payload: ${JSON.stringify(req.query, 2, null)}`);
});


/////////////////////////youtube auth///////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
const youtube = require("./youtube");
app.get("/auth/youtube/callback", async (req, res) => {
    console.log("Youtube auth payload :", JSON.stringify(req.query, null, 2));
    const user_id = req.session.user_id;
    if(!user_id)  {
        console.log("No User ID to save Youtube token")
        return res.send("Internal Server Error : 500"); 
    };
    const { code } = req.query;
    if(!code) {
        console.log("No code from Youtube auth")
        return res.send("Internal Server Error : 500");
    }

    const response = await youtube.getAccessToken(code);
    console.log("Youtube Access Token Response: ", response);

    const { access_token, expires_in, refresh_token, refresh_expires_in} = response;
    if(!access_token || !refresh_token){
        console.log("Access Token or Refresh Token Not Found in Auth");
        return res.send("Internal Server Error: 500");
    }

    const [results] = await config.db.execute("SELECT * FROM social_tokens WHERE user_id = ?", [user_id]);
    if(results.length === 0){
        const [insert] = await config.db.execute("INSERT INTO social_tokens (user_id, youtube_token, youtube_refresh_token) VALUES (?, ?, ?)", [user_id, access_token, refresh_token]);
        if(insert.affectedRows > 0){
            //success
            await redisClient.set(`${user_id}_youtube_tokens`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
            res.cookie("linked_account", "youtube", { maxAge: 5000, httpOnly: false }); // Temporary
            return res.redirect(`${client}/dash/socials/`);
        }else{
            console.log("Insert Youtube tokens Failed");
            res.send("Internal Server Error: 500");
        }

    }else{
        const [update] = await config.db.execute("UPDATE social_tokens SET youtube_token = ?, youtube_refresh_token = ? WHERE user_id = ?", [access_token, refresh_token, user_id]);
        if(update.affectedRows > 0){
            //success
            await redisClient.set(`${user_id}_youtube_tokens`, JSON.stringify({access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString()}));
            res.cookie("linked_account", "youtube", { maxAge: 5000, httpOnly: false }); // Temporary
            return res.redirect(`${client}/dash/socials/`);
        }else{
            console.log("Update Youtube tokens Failed");
            res.send("Internal Server Error: 500");
        }

    }
    

});

app.get("/youtube/posts", async (req, res) => {
    const { type } = req.query; //useless
    const { user_id } = req.session;
    if(!user_id) return console.log("UserID not Available to Fetch Youtube Post");
    // check if the post is in cache redis
    const cache_key = `${user_id}_youtube_posts`;
    const cache_ttl = 60 * 5;

    const cachePost = await redisClient.get(cache_key);
    if(cachePost){
        console.log("Returning Youtube post from cache for " + user_id);
        return res.json(success("success", JSON.parse(cachePost)));
    }

    const youtube_token = await redisClient.get(`${user_id}_youtube_tokens`);
    if(!youtube_token) return console.log("YT token cache no found for validation");
    //console.log("Cache YT token: ", youtube_token);
    if(youtube_token){
        const is_youtube_expired = token_manager.isTokenExpired(JSON.parse(youtube_token));
        //console.log("Is YT Expired: ", is_youtube_expired);
        if(is_youtube_expired){
         const response = await token_manager.handleRefresh("youtube", JSON.parse(youtube_token), user_id);
         //console.log("Response from YT Refresh: ", response);
          if(response !== "done") return console.log("Cannot Refresh Youtube Token");
        }  
    }

    const [result] = await config.db.execute("SELECT youtube_token FROM social_tokens WHERE user_id = ?", [user_id]);
    if(result.length === 0) return console.log("No Token in Database for Youtube user: " + user_id);
    //console.log("Yotube Token", result[0].youtube_token);
    const response = await youtube.getPosts(result[0].youtube_token);
    //console.log("Youtube Posts: ", JSON.stringify(response, null, 2));
    if(!response) return console.log("No Post Returned");

    
    const formatted = await posts.format("youtube", response, result[0].youtube_token, "VIDEO");
    //console.log("Formatted", formatted);

    await redisClient.set(cache_key, JSON.stringify(formatted), {
        EX: cache_ttl
    });

    //console.log("Fetched fresh Youtube posts and cached");

    return res.json(success("success", formatted));


});


//////////////// Fetching Media From the Social Platform ////////////////////////
/////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////
//////////////// Fetching Media From the Social Platform ////////////////////////
/////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////
//////////////// Fetching Media From the Social Platform ////////////////////////
/////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////

app.get("/ig/posts", async (req, res) => {
    try{

        const { type } = req.query;
        if(!req.session.user_id) return console.log("UserID not Available to Fetch IG Post");
        //console.log(result, "in ig media")
        const cache_key = `${req.session.user_id}_ig_posts`;
        const cache_ttl = 60 * 5;
        const cache = await redisClient.get(cache_key);
        if(cache){
            console.log("Returning IG post from cache for " + req.session.user_id);
            return res.json(success("success", JSON.parse(cache)));
        }
        const ig_token = await redisClient.get(`${req.session.user_id}_ig_token`);
        //refresh token if expired
        if(ig_token){
            const is_ig_expired = token_manager.isTokenExpired(JSON.parse(ig_token));
            if(ig_token && is_ig_expired){
                const response = await token_manager.handleRefresh("instagram", JSON.parse(ig_token), user_id);
                if(response !== "done") return console.log("Cannot Refresh Instagram Token");
            }
        }
        
        
        const [result] = await config.db.execute("SELECT ig_bus_id, ig_token FROM social_tokens WHERE user_id = ?", [req?.session?.user_id]);
        const response = await ig.getIgUserPosts(result[0].ig_bus_id, result[0].ig_token);
        if(!response){
            console.log("Cannot fetch IG Posts");
            return res.json(failed("error", {}));
        }
        //console.log("Medias", response);
        const formatted = await posts.format("instagram", response, result[0].ig_token);
        //console.log("Formatted", formatted);

        await redisClient.set(cache_key, JSON.stringify(formatted), {
            EX: cache_ttl
        });

        console.log("Fetched fresh IG posts and cached");

        return res.json(success("success", formatted));

    }catch(err){
        console.log("Error Fetching IG Post in Route: ", err?.message || "cant access err message")
        return res.json(failed("error", {}));
    }

});


app.get("ig/post/insight", async (req, res) => {
    const user_id = req.session.user_id;
    if(!user_id){
        console.log("No user ID in ig/post/insight");
        return;
    };




});













////////////


app.post("/contents/draft/save", upload.any(), async (req, res) => {
    const user_id = req.session.user_id;
    if (!user_id) {
        console.log("No user ID in contents drafts");
        return res.status(400).json({ error: "User not authenticated" });
    }

    // Access platform-specific JSON data
    const draftData = {};
    for (const platform in req.body) {
        if (platform !== 'file') {
            draftData[platform] = JSON.parse(req.body[platform]); // Parse JSON string
        }
    }

    //console.log("Draft Data: ", draftData);

    // Initialize an object to hold grouped files by platform
    const groupedFiles = {};

    // Loop through the uploaded files
    req.files.forEach(file => {
        // Extract the platform name from the fieldname (e.g., 'youtube[]' => 'youtube')
        const platform = file.fieldname.replace('[]', '');

        // Group files by platform
        if (!groupedFiles[platform]) {
            groupedFiles[platform] = [];
        }

        // Generate a unique file name to avoid conflicts
        const fileName = `${platform}_${Date.now()}_${user_id}_${file.originalname}`;

        // Define the path to save the file in 'content_draft' folder
        const savePath = path.join(__dirname, 'content_draft', fileName);

        // Ensure the 'content_draft' folder exists
        if (!fs.existsSync(path.join(__dirname, 'content_draft'))) {
            fs.mkdirSync(path.join(__dirname, 'content_draft'));
        }

        // Write the file to the 'content_draft' directory
        fs.renameSync(file.path, savePath);

        // Add the file metadata (name, path) to the platform's group
        groupedFiles[platform].push({
            originalname: file.originalname,
            mimetype: file.mimetype,
            path: savePath,  // Save the path of the file
            size: file.size,
            savedName: fileName  // Use this for saving to DB
        });
    });

    // Log the grouped files (for debugging)
    //console.log('Grouped files by platform:', groupedFiles);

    // Now you can save the grouped files' saved names (fileName) to the database
    const uploadedFiles = {};

    // Loop through each platform and its files
    for (const platform in groupedFiles) {
        const platformFiles = groupedFiles[platform];
        uploadedFiles[platform] = platformFiles.map(file => file.savedName);
    }


    //uploadedFiles, draftData, user_id
    //console.log("Uploaded Files: ", uploadedFiles);
    //console.log("Draft Data: ", draftData);
    //console.log("User ID: ", user_id);


    
    try {
        const promises = Object.entries(draftData).map(([platform, platformConfig]) => {
            const fields = ["user_id", "platform"];
            const placeholders = ["?", "?"];
            const values = [user_id, platform];
    
            if (platformConfig) {
                fields.push("data");
                placeholders.push("?");
                values.push(JSON.stringify(platformConfig));
            }
    
            if (uploadedFiles[platform]) {
                fields.push("files");
                placeholders.push("?");
                values.push(JSON.stringify(uploadedFiles[platform]));
            }
    
            const query = `INSERT INTO content_drafts (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`;
    
            return config.db.execute(query, values);
        });
    
        await Promise.all(promises);
        res.status(200).json(success("success", null));
    } catch (error) {
        console.error("Error saving drafts:", error.message);
        res.status(500).json(failed("error", null));
    }
    
});


app.get("/contents/draft/get", async (req, res) => {
    const user_id = req.session.user_id;
    if (!user_id) {
        console.log("No user ID in contents drafts");
        return res.status(400).json({ error: "User not authenticated" });
    }
    
        const [drafts] = await config.db.execute("SELECT * FROM content_drafts WHERE user_id = ?", [user_id]);
        //console.log("result: ", drafts);


        return res.json(success("success", drafts));


        
})

app.get("/contents/draft/delete", async (req, res) => {
    const { id } = req.query;
    const { user_id } = req.session;
    const active_user_id = req.session.user_id;
    if(!user_id) {
        console.log("No user ID in contents drafts Delete");
        return res.status(400).json({ error: "User not authenticated" });
    }
    if(user_id !== active_user_id){
        console.log("User ID Mismatch in contents drafts Delete");
        return res.status(200).json(failed("error", { message: "User ID Mismatch" }));
    }

    try{
        const [drafts] = await config.db.execute("SELECT * FROM content_drafts WHERE id = ? AND user_id = ?", [id, user_id]);
        if(drafts.length === 0) return res.status(400).json(failed("error", { message: "Draft not found" }));
        const files = JSON.parse(drafts[0].files);
        //console.log("Files: ", files);
        if(files && files.length > 0){
            files.forEach(file => {
                fs.unlinkSync(path.join(__dirname, 'content_draft', file)); // Delete the file
            });
        }
        await config.db.execute("DELETE FROM content_drafts WHERE id = ? AND user_id = ?", [id, user_id]);
        res.status(200).json(success("success", null));
    }catch(error){
        console.error("Error deleting drafts:", error.message);
        res.status(500).json(failed("error", null));
    }
});







///////////////////////////////////////////////////////////////////////////////////
app.post("/remove-social-token", async (req, res) => {
    const {key} = req.body;
        const user_id = req.session.user_id;
    if(!user_id){
        console.log("No user ID in remove token");
        return;
    };
    switch (key) {
        case "facebook":
            await config.db.execute("UPDATE social_tokens SET fb_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "linkedin":
            await config.db.execute("UPDATE social_tokens SET linkedin_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "tiktok":
            await config.db.execute("UPDATE social_tokens SET tiktok_token = NULL, tiktok_refresh_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "youtube":
            await redisClient.del(`${req.session.user_id}_youtube_tokens`);
            await config.db.execute("UPDATE social_tokens SET youtube_token = NULL, youtube_refresh_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "x":
            await config.db.execute("UPDATE social_tokens SET x_token = NULL, x_access_secret = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "instagram":
            await config.db.execute("UPDATE social_tokens SET ig_token = NULL, ig_bus_id = NULL, fb_page_id = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        default:
            res.status(400).json(failed("Invalid key provided", null));
            break;
    }
});
















//////////////// Subscriptions ///////////////////////////
///////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
const { createSubscriptionData, subscriptionPlanList } = require("./subscription");
app.get("/subscriptions/get", async (req, res) => {
    const { user_id } = req.session;
    if(!user_id){
        console.log("No user ID in subscriptions get");
        return res.json(success("User not authenticated", null));
    }

    const [result] = await config.db.execute("SELECT * FROM subscriptions WHERE user_id = ?", [user_id]);
    if(result.length === 0) return res.json(success("success", {}));
    
    return res.json(success("success", result[0]));

});


app.post("/billing/details/update", upload.none(), async (req, res) => {
    const { user_id } = req.session;
    if(!user_id){
        console.log("No user ID in billing details update");
        return res.json(success("User not authenticated", null));
    }
    if(!req.body){
        console.log("No Data to insert for " + user_id);
        return res.json(success("Something Went Wrong", null));
    }

    //console.log(`Billing details update payload: ${JSON.stringify(req.body, null, 2)}`);

    try{

        const [result] = await config.db.execute("SELECT * FROM subscriptions WHERE user_id = ?", [user_id]);
        if(result.length > 0){
            const oldData = JSON.parse(result[0].billing_info);
            const updatedData = { ...oldData };

            for (const key in req.body) {
                const value = req.body[key];
                if (value !== "" && value !== null && value !== undefined) {
                    updatedData[key] = value;
                }
            }

            console.log("Old Data: ", oldData);
            console.log("Updated Data: ", updatedData);

            const [update] = await config.db.execute("UPDATE subscriptions SET billing_info = ? WHERE user_id = ?", [JSON.stringify(updatedData), user_id]);
            if(update.affectedRows > 0){
                console.log("User "+user_id+" Updated Billing Details");
                return res.json(success("success", null));
            }
        }else{
            // create default data
            const createData = await createSubscriptionData(user_id, "free");
            if(!createData) {
                console.log("User "+user_id+" has no existing billing info at signup and cannot create data");
                return res.json(success("Please Contact Administrator", null));
            }
            // edit the data
            const [result] = await config.db.execute("SELECT * FROM subscriptions WHERE user_id = ?", [user_id]);
            if(result.length > 0){
                const oldData = JSON.parse(result[0].billing_info);
                const updatedData = { ...oldData };

                for (const key in req.body) {
                    const value = req.body[key];
                    if (value !== "" && value !== null && value !== undefined) {
                        updatedData[key] = value;
                    }
                }

    
                console.log("Old Data: ", oldData);
                console.log("Updated Data: ", updatedData);

                const [update] = await config.db.execute("UPDATE subscriptions SET billing_info = ? WHERE user_id = ?", [JSON.stringify(updatedData), user_id]);
                if(update.affectedRows > 0){
                    console.log("User "+user_id+" Updated Billing Details");
                    return res.json(success("success", null));
                }
            }




        }

    }catch(error){
        console.log("Error Updating Billing Info for USer "+ user_id+ ": ", error.message || error);
        return res.json(success("failed", null));
    }
});

app.get("/subscriptions/plans", async (req, res) => {
    return res.json(success("success", subscriptionPlanList));
});



app.post("/cors-bypass", async (req, res) => {
    const { url, token } = req.body;
    console.log("ReqBody:", req.body);

    try {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` },
        });

        console.log("Response:", response.data);
        res.json(response.data);
        
    } catch (error) {
        console.error("Error fetching data:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Failed to fetch data" });
    }
});

app.get("/", (req, res) => {
    req.session.views = (req.session.views || 0) + 1;
    res.send(`You visited this page ${req.session.views} times`);
});


async function testConnection() {
    try {
      const connection = await config.db.getConnection();
      console.log('✅ Successfully connected to MySQL');
      connection.release();
    } catch (error) {
      console.error('❌ MySQL Connection Error:', error.message);
    }
}
  
testConnection();

/*  
const main = async () => {
    try{
        // Replace with the tweet IDs you want to fetch
    const tweetIds = ['1318107153752797190']; // Example IDs

    const url = 'https://api.twitter.com/2/tweets';
    const params = {
        'ids': tweetIds.join(','),  // Join the tweet IDs into a comma-separated string
        'tweet.fields': 'author_id,created_at,text',
        'media.fields': 'alt_text,duration_ms,media_key,preview_image_url,type,url',
        'user.fields': 'created_at,id,name,pinned_tweet_id,profile_banner_url,profile_image_url,verified'
    };
    
    const res = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${process.env.X_AUTH_BEARER_TOKEN}`
        },
        params: params
    })
    console.log("response", JSON.stringify(res.data, null, 2));

   }catch(error){

            console.error('Error:', error.response ? error.response.data : error.message);
        
    }
}

//main();

const getUser = async () => {
        // Replace with the username of the user you want to get the ID for
    const username = 'mkrod1';  // For example: 'jack'

    const url = `https://api.twitter.com/2/users/by/username/${username}`;

    axios.get(url, {
        headers: {
            'Authorization': `Bearer ${process.env.X_AUTH_BEARER_TOKEN}`
        }
    })
    .then(response => {
        const userId = response.data.data.id; // Get the user ID from the response
        console.log(`User ID for @${username}:`, userId);
    })
    .catch(error => {
        console.error('Error:', error.response ? error.response.data : error.message);
    });
}

//getUser()



async function getUserPosts() {
    const response = await axios.get('https://api.linkedin.com/v2/shares', {
        headers: {
            'Authorization': `Bearer ${"AQWU9McFsbNxni6efSREYtHEA8PXeh0qTlz9rlyWc5eGCR7JR1Hr4cLqQid_naqFz-vTdh2tqAurMIAZ4JBSd9UvJLln7GdD4sf2gs5N3XQlvZdpvByjhbi0yqT6OMhBDV-Lphv7aGwCc2wwVs4IAaUsKqNXtqln6NUgxD2Da7qqjWaiRJdIraneTeuczZ2SQeWUnz5fMyMkIRzInwbuvjEyI8TVL3pZzu9G-DoMjnHH968TErPEwaREtVWbBGYREN5E2pPTrQ3s0mdl5_KA0Sg5nQLaDx4TKhptodWu7vV5hv7YiQPZ1tgeRriO7jDpz4xnRGywhdw1WfFnhIEPzip_mK8Ucg"}`,
            'X-Restli-Protocol-Version': '2.0.0'
        }
    });

    console.log('User Posts:', response.data);
}

getUserPosts();*/
app.use('/content_draft', express.static(path.join(__dirname, 'content_draft')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));


process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});
   
// Start the server
server.listen(PORT, "0.0.0.0", () => {
    console.log(`App is running on port ${PORT}`);
    const url = new URL(this_server_url);
    console.log(`WebSocket server is running on wss://${url.hostname}:${PORT}`);
});