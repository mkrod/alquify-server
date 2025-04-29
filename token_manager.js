const dayjs = require("dayjs");
const tiktok = require("./tiktok");
const youtube = require("./youtube");
//const facebook = require("./facebook");
const ig = require("./ig_api");
//const x = require("./x_api");
//const linkedin = require("./linkedin");
const config = require("./config");
const redisClient = require("./app");

const token_manager = {
    // Helper function
    isTokenExpired: (tokenObj) => {
        const createdTime = dayjs(tokenObj.created);
        const expiresInSec = parseInt(tokenObj.expires_in, 10);
        return dayjs().isAfter(createdTime.add(expiresInSec, 'second'));
    },

    handleRefresh: async (platform, tokenObj, user_id) => {
        switch (platform) {
            case "tiktok": {
                const response = await tiktok.refreshToken(tokenObj.refresh_token);
                if (!response) throw Error("Tiktok Token not refreshed");

                const { access_token, expires_in, refresh_token, refresh_expires_in } = response;
                await redisClient.set(`${user_id}_tiktok_token`, JSON.stringify({ access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString() }));
                const [result] = await config.db.execute("UPDATE social_tokens SET tiktok_token = ?, tiktok_refresh_token = ? WHERE user_id = ?", [access_token, refresh_token, user_id]);
                if (result.affectedRows > 0) return "done";
                break;
            }

            case "instagram": {
                const response = await ig.refreshToken(tokenObj.refresh_token);
                if (!response) throw Error("Instagram Token not refreshed");

                let { access_token, expires_in } = response;
                expires_in -= 3600 * 7;
            
                const refresh_token = access_token;
                const refresh_expires_in = expires_in;
            
                if(!refresh_token || !access_token) {
                    console.log("No Access Token|| Refresh Token for Instagram");
                    return null;
                }

                await redisClient.set(`${user_id}_ig_token`, JSON.stringify({ access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString() }));
                const [result] = await config.db.execute("UPDATE social_tokens SET ig_token = ?, ig_refresh_token = ? WHERE user_id = ?", [access_token, refresh_token, user_id]);
                if (result.affectedRows > 0) return "done";
                break;
            }

            case "facebook": {
                const response = await facebook.refreshToken(tokenObj.refresh_token);
                if (!response) throw Error("Facebook Token not refreshed");

                const { access_token, expires_in, refresh_token, refresh_expires_in } = response;
                await redisClient.set(`${user_id}_fb_token`, JSON.stringify({ access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString() }));
                const [result] = await config.db.execute("UPDATE social_tokens SET fb_token = ?, fb_refresh_token = ? WHERE user_id = ?", [access_token, refresh_token, user_id]);
                if (result.affectedRows > 0) return "done";
                break;
            }

            case "x": {
                const response = await x.refreshToken(tokenObj.refresh_token);
                if (!response) throw Error("X Token not refreshed");

                const { access_token, expires_in, refresh_token, refresh_expires_in } = response;
                await redisClient.set(`${user_id}_x_token`, JSON.stringify({ access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString() }));
                const [result] = await config.db.execute("UPDATE social_tokens SET x_token = ?, x_refresh_token = ? WHERE user_id = ?", [access_token, refresh_token, user_id]);
                if (result.affectedRows > 0) return "done";
                break;
            }

            case "youtube": {
                const response = await youtube.refreshToken(tokenObj.refresh_token);
                if(!response) throw Error("Youtube Token not refreshed");
                //console.log("YT Refresh Response: ", response);
                const { access_token, expires_in } = response;
                const oldToken = await redisClient.get(`${user_id}_youtube_tokens`);
                //console.log("old token: ", oldToken);
                if(!oldToken) return null;
                const parsedOldToken = JSON.parse(oldToken);
                const newToken = {...parsedOldToken, access_token, expires_in, created: new Date().toISOString()}
                await redisClient.set(`${user_id}_youtube_token`, JSON.stringify(newToken));
                const [result] = await config.db.execute("UPDATE social_tokens SET youtube_token = ? WHERE user_id = ?", [access_token, user_id]);
                if (result.affectedRows > 0) return "done";
                break;

            }

            case "linkedin": {
                const response = await linkedin.refreshToken(tokenObj.refresh_token);
                if (!response) throw Error("LinkedIn Token not refreshed");

                const { access_token, expires_in, refresh_token, refresh_expires_in } = response;
                await redisClient.set(`${user_id}_linkedin_token`, JSON.stringify({ access_token, expires_in, refresh_token, refresh_expires_in, created: new Date().toISOString() }));
                const [result] = await config.db.execute("UPDATE social_tokens SET linkedin_token = ?, linkedin_refresh_token = ? WHERE user_id = ?", [access_token, refresh_token, user_id]);
                if (result.affectedRows > 0) return "done";
                break;
            }

            default:
                throw new Error("Unsupported platform");
        }
    },
};

module.exports = token_manager;
