const config = require("./config");
const axios = require("axios");

module.exports = {
    getUserInfoFromGoogleAuth: async (code) => {
        console.log("Google Auth Redirect URI: ", config.google.redirect_uris[0])

        try{
            const tokenResponse = await axios.post(config.google.token_uri, {
                grant_type: 'authorization_code', 
                code,
                redirect_uri: config.google.redirect_uris[0],
                client_id: config.google.client_id,
                client_secret: config.google.client_secret,
            });
    
            const accessToken = tokenResponse.data.access_token
    
            console.dir("accessToken dir: ", accessToken);
            console.log("accessToken Log: ", accessToken);
            if(!accessToken){ console.log("Cannot proceed without access token"); return null };
    
            const userInfoRequest = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            })
    
            const userInfo = await userInfoRequest.json();
            return userInfo;
            
        }
        catch(error){
            console.log("Google Auth Error: ", error.response?.data || error.message);
            return null
        }

    }
}