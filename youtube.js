const { default: axios } = require("axios");
const server = "http://localhost:3000"
const endpoints = {
    auth: "https://oauth2.googleapis.com",
    graph: "https://www.googleapis.com/youtube/v3",
}

const youtube = {
    getAccessToken: async (code) => {
        try{
            const response = await axios.post(`${endpoints.auth}/token`, {
                grant_type: 'authorization_code', 
                code,
                redirect_uri: `${server}/auth/youtube/callback`,
                client_id: process.env.YOUTUBE_CLIENT_ID,
                client_secret: process.env.YOUTUBE_CLIENT_SECRET,
            });

            return response.data;


        }catch(error){
            console.log("Cannot get yotube access token: ", error?.response?.data || error.message);
            return null;
        }
    },
    refreshToken: async (refreshToken) => {
        try{

            const response = await axios.post(`${endpoints.auth}/token`, null, {
                params: {
                  grant_type: 'refresh_token',
                  refresh_token: refreshToken,
                  client_id: process.env.YOUTUBE_CLIENT_ID,
                  client_secret: process.env.YOUTUBE_CLIENT_SECRET,
                },
              });
          
              // Handle the response, which includes the new access token
              return response.data; // Contains access_token, expires_in, etc.

        }catch(error){
            console.log("Cannot refresh Youtube Access Token: ", error.response?.data || error.message);
            return null;
        }
    },
    getPosts: async (access_token) => {
        try {
            // Get uploads playlist ID
            const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
                params: {
                    part: 'contentDetails',
                    mine: 'true'
                },
                headers: {
                    Authorization: `Bearer ${access_token}`
                }
            });

    
            const uploadsId = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;
    
            let allVideos = [];
            let nextPageToken = null;
    
            do {
                // Fetch videos from uploads playlist
                const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                    params: {
                        part: 'contentDetails',
                        playlistId: uploadsId,
                        maxResults: 50,
                        pageToken: nextPageToken
                    },
                    headers: {
                        Authorization: `Bearer ${access_token}`
                    }
                });
    
                const videoIds = playlistRes.data.items.map(i => i.contentDetails.videoId);
    
                // Fetch video stats
                const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                    params: {
                        part: 'snippet,statistics,contentDetails',
                        id: videoIds.join(',')
                    },
                    headers: {
                        Authorization: `Bearer ${access_token}`
                    }
                });
    
                allVideos.push(...videoRes.data.items);
                nextPageToken = playlistRes.data.nextPageToken;
    
            } while (nextPageToken);
    
            return allVideos;
    
        } catch (error) {
            console.log("Cannot fetch youtube videos: ", JSON.stringify(error.response?.data, null, 2) || JSON.stringify(error.message, null, 2));
            return null;
        }
    }
    
}


module.exports = youtube;