const { default: axios } = require("axios");

const endpoint = "https://graph.instagram.com";


const ig = {
    getAccessToken: async (code) => {
        try {
            const response = await axios.post(
                "https://api.instagram.com/oauth/access_token",
                new URLSearchParams({
                    client_id: process.env.INSTAGRAM_CLIENT_ID,
                    client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: "https://api.alquify.app/auth/instagram/callback/bypass"
                }),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                }
            );
        
            return response.data;
        } catch (error) {
            console.log("IG Code Exchange Failed: ", error.response?.data || error.message);
        }
        
    },
    getLongLivedToken: async (shortLivedToken) => {
        try {
            const response = await axios.get(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${shortLivedToken}`);
            return response.data;

        } catch (error) {
            console.log("IG ShortToken Exchange Failed: ", error.response?.data || error.message);
        }
        
    },
    refreshToken: async () => {
        try{

            const response = await axios.get(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${shortLivedToken}`);
            return response.data;

        }catch(error){
            console.log("IG Code Refresh Failed: ", error.response?.data || error.message);
        }
    },
    getIgUserPosts: async (/*igUserId,*/_, accessToken) => {
        let allPosts = []; // Array to store all posts
        let nextUrl = `${endpoint}/me/media?fields=id,caption,like_count,comments_count,media_type,media_url,thumbnail_url,permalink,timestamp&access_token=${accessToken}`; // Initial request URL
        //console.log("UserID: ", igUserId);
        try {
            while (nextUrl) {
                //console.log("URL: ", nextUrl);
                const response = await axios.get(nextUrl);
                //console.log("Fetcg iG post response: ", response);
                
    
                // Add the current page of posts to the array
                allPosts = allPosts.concat(response.data.data);
    
                // Update the nextUrl for the next iteration
                nextUrl = response.data.paging?.next || null; // Get the next URL or set to null if none
            }
    
            return allPosts; // Return all collected posts
        } catch (error) {
            console.error("Error fetching Instagram Media(s):", error.response?.data || error.message);
            //throw error; // Rethrow the error for further handling
        }
    },
    getPostChildrenID: async (postID, accessToken) => {
        try{

            const response = await axios.get(`${endpoint}/${postID}?fields=children&access_token=${accessToken}`);
            return response?.data?.children?.data || [];

        }catch(error){
            console.error("Error fetching Instagram Media Children:", error.response?.data || error.message);
        }
    },
    getIGPostChildDetails: async (childID, accessToken) => {
        try{

            const response = await axios.get(`${endpoint}/${childID}?fields=media_type,media_url,thumbnail_url&access_token=${accessToken}`);
            return response?.data || {};

        }catch(error){
            console.error("Error fetching Instagram Media Children:", error.response?.data || error.message);
        }
    },
    getPostInsight: async (mediaID, accessToken) => {
        try{

        }catch(error){
            console.log("")
        }
    }
}
/*
const ig = {
    getLongLivedToken: async (shortLivedToken) => {
        try {
          const response = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
            params: {
              grant_type: 'fb_exchange_token',
              client_id: process.env.FACEBOOK_CLIENT_ID,
              client_secret: process.env.FACEBOOK_CLIENT_SECRET,
              fb_exchange_token: shortLivedToken
            }
          });
      
          console.log('Long-lived token:', response.data.access_token);
          return response.data.access_token;
        } catch (error) {
          console.error('Error exchanging token:', error.response?.data || error.message);
        }
    },
    refreshToken: async (refresh_token) => {
        
    },
    getIgFbPages: async (accessToken) => {
        console.log("Access Token:", accessToken); // Log the access token to check its value
        const response = await axios.get(`${endpoint}/me/accounts?fields=name,id,picture,category&access_token=${accessToken}`);
        return response;
    },

    //after user select the page they connect to the instagram account, save to db for token refreshing later, and we pass the id here and get the instagram account id
    getIgUserId: async (pageID, accessToken) => {
        //console.log("Access Token:", accessToken); // Log the access token to check its value

        try{
            const response = await axios.get(`${endpoint}/${pageID}?fields=instagram_business_account&access_token=${accessToken}`);
            if(!response.data.instagram_business_account) return null; // Return null if no Instagram account is linked
            return response.data.instagram_business_account.id;
        }catch(error) {
            console.error("Error fetching Instagram user ID:", error.response?.data || error.message);
            //throw error; // Rethrow the error to handle it in the calling function
        }

    },

    getIgUserDetails: async (igUserId, accessToken) => {
        //console.log("Access Token:", accessToken); // Log the access token to check its value
        try{
            const response = await axios.get(`${endpoint}/${igUserId}?fields=biography,followers_count,follows_count,media_count,name,username,profile_picture_url&access_token=${accessToken}`);
            return response;
        }catch(error) {
            console.error("Error fetching Instagram user details:", error.response?.data || error.message);
            //throw error; // Rethrow the error to handle it in the calling function
        }

    },

    getIgUserPosts: async (igUserId, accessToken) => {
        let allPosts = []; // Array to store all posts
        let nextUrl = `${endpoint}/${igUserId}/media?fields=id,caption,like_count,comments_count,media_type,media_url,thumbnail_url,permalink,timestamp&access_token=${accessToken}`; // Initial request URL
    
        try {
            while (nextUrl) {
                const response = await axios.get(nextUrl);
    
                // Add the current page of posts to the array
                allPosts = allPosts.concat(response.data.data);
    
                // Update the nextUrl for the next iteration
                nextUrl = response.data.paging?.next || null; // Get the next URL or set to null if none
            }
    
            return allPosts; // Return all collected posts
        } catch (error) {
            console.error("Error fetching Instagram Media(s):", error.response?.data || error.message);
            //throw error; // Rethrow the error for further handling
        }
    },
    getPostChildrenID: async (postID, accessToken) => {
        try{

            const response = await axios.get(`${endpoint}/${postID}?fields=children&access_token=${accessToken}`);
            return response?.data?.children?.data || [];

        }catch(error){
            console.error("Error fetching Instagram Media Children:", error.response?.data || error.message);
        }
    },
    getIGPostChildDetails: async (childID, accessToken) => {
        try{

            const response = await axios.get(`${endpoint}/${childID}?fields=media_type,media_url,thumbnail_url&access_token=${accessToken}`);
            return response?.data || {};

        }catch(error){
            console.error("Error fetching Instagram Media Children:", error.response?.data || error.message);
        }
    }

}
*/
module.exports = ig;