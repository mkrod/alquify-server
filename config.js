const mysql = require("mysql2/promise");
require("dotenv").config();
const this_server_url = "http://localhost:3000";//require("./app");


const config  = {
    google: {

            client_id: process.env.GOOGLE_CLIENT_ID,
            project_id: "alquify-test",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: [`${this_server_url}/auth/callback`],
    },

    facebook: {
        client_id: process.env.FACEBOOK_CLIENT_ID,
        client_secret: process.env.FACEBOOK_CLIENT_SECRET,
        redirect_uris: ["http://localhost:3000/auth/facebook/callback"],
    },

    
    linkedin: {
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
        redirect_uris: ["http://localhost:3000/auth/linkedin/callback"],
    },

    x: {
        consumer: {
            api_key: process.env.X_CONSUMER_KEY,
            api_key_secret: process.env.X_CONSUMER_SECRET,
        },
        authenticationToken: {
            BearerToken: process.env.X_AUTH_BEARER_TOKEN,
            access_token: process.env.X_AUTH_ACCESS_TOKEN,
            access_token_secret: process.env.X_AUTH_ACCESS_SECRET,
        },
        OAuth2_0:{
            client_id: process.env.X_OAUTH_CLIENT_ID,
            client_secret: process.env.X_OAUTH_CLIENT_SECRET,
            redirect_uris: ["http://localhost:3000/auth/x/callback"],
        }, // OAuth 2.0
    },

    tiktok: {
        client_id: process.env.TIKTOK_CLIENT_ID,
        client_secret: process.env.TIKTOK_CLIENT_SECRET
    },


    db: mysql.createPool({
        host: process.env.DB_HOST,
        database: process.env.DB_NAME, 
        user: process.env.DB_USER, 
        password: process.env.DB_PASSWORD, 
        port: 3306,
        queueLimit: 200,
        connectionLimit: 10,
        /*ssl: {
            rejectUnauthorized: false,
        }*/
    }),

    open_ai:  {
        api_key: process.env.OPENAI_API_KEY, 
    }

}


module.exports = config;