const { default: axios } = require("axios");
const { env } = require("process");
require("dotenv").config();
const config = require("./config");
const redisClient = require("./app");
const endpoints = {
    auth: "https://open.tiktokapis.com/v2/oauth/token/",
    graph: "https://open.tiktokapis.com",
} 


const tiktok = {
    getAuthToken: async (code, verifier) => { 
        try {
            const params = new URLSearchParams();
            // Required parameters
            params.append('client_key', process.env.TIKTOK_CLIENT_ID);
            params.append('client_secret', process.env.TIKTOK_CLIENT_SECRET);
            params.append('code', code);
            params.append('grant_type', 'authorization_code');
            params.append('redirect_uri', `http://localhost:3000/auth/tiktok/callback`);
            params.append('code_verifier', verifier);
    
    
            // Send POST request to get the access token
            const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', params.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });
    
            // Return the access token (or whatever data is returned in response)
            console.log("Response inside getAuthToken(): ", response.data);
            return response?.data;
    
        } catch (err) {
            console.log("Error Getting TikTok accessToken: ", err.response?.data || err.message);
            throw err;  // Optionally propagate the error to be handled elsewhere
        }
    },        
    refreshToken: async (refresh_token) => { //refresh the token
        try{
            const params = new URLSearchParams();
            params.append('client_key', process.env.TIKTOK_CLIENT_ID);
            params.append('client_secret', process.env.TIKTOK_CLIENT_SECRET);
            params.append('grant_type', 'authorization_code');
            params.append('refresh_token', refresh_token);

            const response = await axios.post(endpoints.auth, params.toString(),{
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });

            return response?.data;
        }
        catch(err){
            console.log("Cannot Refresh Token: ", err?.response?.data || err.message);
            return null;
        }
    },
    getPosts: async (token) => {
        //const response = await axios.post(endpoints.graph + "/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,embed_link,like_count,comment_count,share_count,view_count", {max_count: 20},{
            let hasMore = true;
            let cursor = 0;
            const allVideos = [];
          
            while (hasMore) {
              const body = {
                max_count: 20, // Max allowed
                ...(cursor ? { cursor } : {}) // Include cursor only if it's not the first request
              };
          
              try {
                const response = await axios.post(endpoints.graph + "/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,embed_link,share_url,like_count,comment_count,share_count,view_count,create_time", body, {
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                });
          
                const { data, error } = response.data;
          
                if (error?.code !== "ok") {
                  console.error("TikTok API Error:", error?.message);
                  break;
                }
          
                allVideos.push(...(data.videos || []));
                hasMore = data.has_more;
                cursor = data.cursor;
          
              } catch (err) {
                console.error("Request failed:", err.message);
                break;
              }
            }
          
            return allVideos.length > 0 ? allVideos : null;



    }


}

module.exports = tiktok;