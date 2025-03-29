const { userInfo } = require("os");
const config = require("./config");
const axios = require("axios");

module.exports = {
    getUserInfoFromGoogleAuth: async (code) => {

        try{
            const tokenResponse = await axios.post(config.google.token_uri, {
                grant_type: 'authorization_code', code,
                redirect_uri: config.google.redirect_uris[0],
                client_id: config.google.client_id,
                client_secret: config.google.client_secret,
            });
    
            const accessToken = tokenResponse.data.access_token
    
            //console.dir("accessToken dir: ", accessToken);
            //console.log("accessToken Log: ", accessToken);
    
            const userInfoRequest = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            })
    
            const userInfo = await userInfoRequest.json();
            return userInfo;
            
        }
        catch(err){
            console.log("err: ", err);
        }

    }
}