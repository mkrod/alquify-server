const ig = require("./ig_api");
const config = require("./config");
const redisClient = require("./app");


const posts = {
    format: async (platform, data, accessToken, media_type) => {
        
        const standardMedia = (item) => {
            // Function to convert a timestamp to ISO format if it's not already in ISO format
            const convertToISO = (timestamp) => {
                if (!timestamp) return null;

                // If the timestamp is already in ISO format (string)
                if (typeof timestamp === "string" && !isNaN(Date.parse(timestamp))) {
                    return timestamp; // Already ISO format
                }

                // If it's a Unix timestamp (in seconds), convert to milliseconds
                if (typeof timestamp === "number") {
                    return new Date(timestamp * 1000).toISOString();
                }

                // If it's some other format, we can't handle, just return null
                return null;
            };

            const timestamp = item.timestamp || item.create_time || item.created?.time || item.snippet?.publishedAt || null;
            const isoTimestamp = convertToISO(timestamp);
            
            return{
            
            // Common fields
            id: item.id || null,
            title: item.title || item.caption || item.text?.title || item.snippet?.title || null,
            description: item.description || item.caption || item.text?.description || item.video_description || item.snippet?.description || null,
            media_type: item.media_type || item.media?.type || media_type || null, //defaulting to VIDEO for tiktok through the variable
            media_url: item.media_url || item.media?.url || item.video?.url || item?.embed_link || platform === "youtube" && "https://www.youtube.com/embed/" + item.id || null,
            thumbnail_url: item.thumbnail_url || item.media?.thumbnail || item?.cover_image_url || item.snippet?.thumbnails?.medium?.url ||null,
            timestamp: isoTimestamp,
            permalink: item.permalink || item.link || item.share_url || platform === "youtube" && "https://www.youtube.com/watch?v="+item.id || null,
            platform: platform,
            
            // Additional fields
            username: item.username || item.owner?.name || item.snippet?.channelTitle || null, // Instagram username or LinkedIn owner name
            comments_count: item.comments_count || item.comment_count || item.comments?.summary?.total_count || item.statistics?.commentCount || null,
            like_count: item.like_count || item.likes?.summary?.total_count || item.statistics?.likeCount || null,
            dislike_count: item.dislike_count || item.dislikes?.summary?.total_count || item.statistics?.dislikeCount || null,
            shares_count: item.shares?.count || item.shares_count || item.share_count || item.statistics?.shareCount || null,
            view_count: item.views_count || item.view_count || item.views || item.view || item.statistics?.viewCount || null,
            retweet_count: item.retweet_count || null,
            favorite_count: item.favorite_count || item.statistics?.favoriteCount || null,
            reply_count: item.reply_count || null,
            verified: item.user?.verified || item.author?.verified || null,
            profile_image_url: item.user?.profile_image_url || item.author?.profile_picture || null,
            music: item.music ? {
                title: item.music.title || null,
                author: item.music.author || null,
                url: item.music.url || null
            } : null,
            comments: item.comments?.data || [], // Array of comments
            media_children: item.children || [] // For Instagram carousel posts
        }};

        const FormatChild = (item) => ({
            id: item.id,
            media_url: item.media_url || item.media?.url || item.video?.url || null,
            thumbnail_url: item.thumbnail_url || item.media?.thumbnail || null,
        });

        switch (platform) {
            case 'instagram':
                const enrichedInstagram = await Promise.all(
                    data.map(async (item) => {
                        const formatted = standardMedia(item);
            
                        if ((item.media_type || "").toLowerCase() === "carousel_album") {
                            try {
                                const cachedCarouselChildren = await redisClient.get(`ig_post_${item.id}_children`);
                                if (cachedCarouselChildren) {
                                    formatted.media_children = JSON.parse(cachedCarouselChildren);
                                    return formatted;
                                }

                                // Step 1: Get children IDs
                                const childIds = await ig.getPostChildrenID(item.id, accessToken); //returns the children id in array of object
            
                                // Step 2: Fetch each child media object
                                const childMediaPromises = childIds.map(child =>
                                    ig.getIGPostChildDetails(child.id, accessToken)
                                );
            
                                const mediaChildren = (await Promise.all(childMediaPromises)).filter(Boolean);
                                await redisClient.set(`ig_post_${item.id}_children`, JSON.stringify(mediaChildren), {EX: ((60 * 60 * 24) * 7)}); //7days
                                formatted.media_children = mediaChildren.map(child => FormatChild(child));
                            } catch (err) {
                                console.error(`Failed to fetch carousel children for post ${item.id}`, err.message);
                                formatted.media_children = [];
                            }
                        }
            
                        return formatted;
                    })
                );
            
                return { instagram: enrichedInstagram };
            case 'linkedin':
                return {
                    linkedin: data.map(standardMedia) // Assuming data is an array of LinkedIn media items
                };
            case 'facebook':
                return {
                    facebook: data.map(standardMedia) // Assuming data is an array of Facebook media items
                };
            case 'twitter':
                return {
                    twitter: data.map(standardMedia) // Assuming data is an array of Twitter media items
                };
            case 'tiktok':
                return {
                    tiktok: data.map(standardMedia) // Assuming data is an array of TikTok media items
                };
            case 'youtube':
                return {
                    youtube: data.map(standardMedia) // Assuming data is an array of Youtube media items
                }
            default:
                return {}; // Return empty if platform is unknown
        }
    },

    postInsightFormat: async (platform, data) => {
        const extractMetric = (metrics, name) => {
            const found = metrics.find(metric => metric.name === name);
            return found?.values?.[0]?.value || 0;
        };
    
        const standardInsight = (item) => {
            return {
                id: item.id || null,
                impressions: extractMetric(item.data, 'impressions'),
                reach: extractMetric(item.data, 'reach'),
                likes: extractMetric(item.data, 'likes'),
                comments: extractMetric(item.data, 'comments'),
                shares: extractMetric(item.data, 'shares'),
                saved: extractMetric(item.data, 'saved'),
                follows: extractMetric(item.data, 'follows'),
                profile_visits: extractMetric(item.data, 'profile_visits'),
                total_interactions: extractMetric(item.data, 'total_interactions'),
                views: extractMetric(item.data, 'views'),
                profile_activity: extractMetric(item.data, 'profile_activity')
            };
        };
    
        switch (platform) {
            case 'instagram':
                return {
                    instagram: data.map(standardInsight)
                };
            // You can extend this for other platforms later:
            // case 'facebook':
            // case 'linkedin':
            default:
                return {};
        }
    }
    
};



module.exports = posts;