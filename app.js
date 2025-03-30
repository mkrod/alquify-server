const client = "http://localhost:5173";
const pro_client = "https://alquify.up.railway.app"; //producction client url
const pro_client_2 = "https://railway.app"; //production domain
const client2 = "http://localhost";
const this_server_url = "https://alquify-server-production.up.railway.app"; // the url where this will be hosted
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

app.use(express.json());
app.use(cors({
    origin: [client, client2, pro_client, pro_client_2 ,this_server_url],
    credentials: true,
}));
app.use(express.urlencoded({ extended: true }));

const secret = process.env.SESSION_SECRET;

const generateUserID = () => {
    const ID = crypto.randomBytes(10).toString("hex");
    return ID
}

app.use((req, res, next) => {
    console.log("Incoming Headers:", req.headers);
    next();
});

app.use((req, res, next) => {
    console.log("Request Cookies:", req.headers.cookie);
    next();
});

const cookie = {            
    secure: true, // Changed to true for HTTPS
    sameSite: "none", // Required for cross-site
    httpOnly: true,
    domain: ".railway.app", // Match production domain
    path: "/",
    maxAge: 86400000 // 24h
}

// Session middleware with production-ready config
app.use(
    session({
        name: "_alquify-session-id_", 
        secret: secret,
        resave: false,
        saveUninitialized: false,
        cookie: cookie,
        proxy: true, // Trust reverse proxy
        rolling: true, // Refresh session on activity
    })
);

// [Rest of the original file content remains exactly the same...]



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

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    // Send a welcome message to the client
    ws.send(JSON.stringify({ message: 'Welcome to the WebSocket server!' }));

    // Convert existing clients into an object { clientId: true }
    const existingClients = Object.keys(ws_clients).reduce((acc, id) => {
        acc[id] = true;
        return acc;
    }, {});

    // Send the existing clients as an object
    ws.send(JSON.stringify({ type: "existing-clients", clients: existingClients }));
    

    // Handle incoming messages from clients
    ws.on('message', (message) => {

        const data = JSON.parse(message);
        console.log("raw message", message.toString());

        //register client

        if (data.type === 'register') {
            ws_clients[data.userId] = ws;
            console.log(`${data.userId} is now connected`);

            Object.values(ws_clients).forEach((client) => {
                client.send(JSON.stringify({ type: 'user-online', userId: data.userId }));
            });
            
        }
        

        
        // incoming message useless block
        if(data.type === 'send-message'){
            // incoming message to server
            //console.log(data)
            insertMessage(data)
            .then((res) => {
                if(res){
                    const event = JSON.stringify({ type: 'new-message', sender: data.sender, reciever: data.reciever });

            // Send update to the sender
                    if (ws_clients[data.sender]) {
                        ws_clients[data.sender].send(event);
                    }

                    // Send update to the receiver
                    if (ws_clients[data.reciever]) {
                        ws_clients[data.reciever].send(event);
                    }
                }
            })
        }
        
    });

    ws.on('close', () => {
        Object.keys(ws_clients).forEach((userId) => {
            if (ws_clients[userId] === ws) {
                delete ws_clients[userId];
                console.log(`WebSocket client ${userId}, disconnected`);
            }
        });
        const existingClients = Object.keys(ws_clients).reduce((acc, id) => {
            acc[id] = true;
            return acc;
        }, {});
        Object.values(ws_clients).forEach((client) => {
            client.send(JSON.stringify({ type: 'user-offline', clients: existingClients }));
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
    const code = req.query.code;
    if(!code) return res.send("Something Went wrong");
    const userInfo = await GoogleAuth.getUserInfoFromGoogleAuth(code);
     console.log("User Info: ", userInfo);
    if(!userInfo) return;

    const user_id = `${userInfo?.given_name?.toString()?.toLowerCase()}-${userInfo?.sub}`;

    const [results] = await config.db.execute("SELECT * FROM users WHERE email = ?", [userInfo?.email]);
    //console.log("sql: ", results);
    if (results.length === 0) {
        const [results] = await config.db.execute("INSERT INTO users (user_id, email, auth_method, social_auth_id) VALUES (?, ? , ?, ?)", [user_id, userInfo.email, "google", userInfo.sub]);
        if (results.affectedRows > 0) {
            req.session.isLoggedIn = true;
            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.send(failed("Session error", {}));
                }
                console.log("should be true")
                res.send(success("started", { isLoggedIn: true }));
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
            res.send(success("started", { isLoggedIn: true }));
            
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

});


// Start session route
app.post("/start-session", async (req, res) => {
    req.session.isLoggedIn = true;
    req.session.save((err) => {
        if (err) {
            console.error("Session save error:", err);
            return res.send(failed("Session error", {}));
        }
        console.log("inside start session started")
        res.send(success("started", { isLoggedIn: true }));
    });
});

// Check session status route
app.post("/is-logged-in", async (req, res) => {
    console.log("Session data in /is-logged-in:", req.session);
    if (req.session?.isLoggedIn) {
        res.send(success("started", { isLoggedIn: true }));
    } else {
        res.send(success("not started", { isLoggedIn: false }));
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








app.get("/logout", async (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
        } else {
            console.log("Session destroyed successfully");
        }
    });
    res.send(JSON.stringify(success("done", null)))
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
  
app.get('/auth/get-tokens', async (req, res) => {
    const user_id = req.session.user_id;
    const sql = `SELECT * FROM social_tokens WHERE user_id = ?`;
    const [results] = await config.db.execute(sql, [user_id]);
    if(results.length > 0){
        const data = results[0];
        return res.json(success("success", {
            fb_token: data.fb_token,
            google_token: data.google_token,
            x_token: data.x_token,
            linkedin_token: data.linkedin_token,
            ig_token: data.instagram_token,
            tiktok_token: data.tiktok_token,
        }));

    }else{
        return res.json(success("empty", null));
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





/////////////////////tiktok
///////////////////////////////
app.get("/auth/tiktok/callback", async (req, res) => {

});
app.post("/tiktok/webhook", async (req, res) => {

});




app.post("/remove-social-token", async (req, res) => {
    const {key} = req.body;
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
            await config.db.execute("UPDATE social_tokens SET tiktok_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "youtube":
            await config.db.execute("UPDATE social_tokens SET google_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "x":
            await config.db.execute("UPDATE social_tokens SET x_token = NULL, x_access_secret = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        case "instagram":
            await config.db.execute("UPDATE social_tokens SET ig_token = NULL WHERE user_id = ?", [req.session.user_id]);
            res.json(success("success", null));
            break;
        default:
            res.status(400).json(failed("Invalid key provided", null));
            break;
    }
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
    const { message } = req.query;
    const { user_id, user_email } = req.session;
    res.send(`<html>
               <div>Alquify: Hello From server<br> 
                    ${user_email}: ${message}"</div>
             </html>`);
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
  


// Start the server
server.listen(PORT, "0.0.0.0", () => {
    console.log(`App is running on port ${PORT}`);
    console.log(`WebSocket server is running on ws://${this_server_url}:${PORT}`);
});