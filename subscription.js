const { start } = require("repl");
const config = require("./config");


const now = new Date();
//const date = now.toISOString().slice(0, 10); // Format: YYYY-MM-DD
const end = (days) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return date;
}

const subscriptionPlanList = {
    free: {
      name: "Personal",
      price: 0,
      start_date: now,
      end_date: end(14),
      limits: {
        conversation: { usage: 0, limit: 50, reset: "monthly" },
        ai_conversation: { usage: 0, limit: 0, reset: "monthly" },
        ai_chatbot: { usage: 0, limit: 0, reset: "monthly" },
        agent: { usage: 0, limit: 0 },
        chat_shortcut: 5,
        drafts: { usage: 0, limit: 5, reset: "monthly" },
        scheduling_posts: { usage: 0, limit: 20, reset: "monthly" }, // Updated limit for scheduling posts
      },
    },
    pro: {
      name: "Professional",
      price: 99,
      start_date: now,
      end_date: end(30),
      limits: {
        conversation: { usage: 0, limit: 1000 },
        ai_conversation: { usage: 0, limit: 100 },
        ai_chatbot: { usage: 0, limit: 20 },
        agent: { usage: 0, limit: 5 },
        chat_shortcut: 20,
        drafts: { usage: 0, limit: 20 },
        scheduling_posts: { usage: 0, limit: 50, reset: "monthly" }, // Updated limit for scheduling posts
      },
    },
    team: {
      name: "Team",
      price: 299,
      start_date: now,
      end_date: end(30),
      limits: {
        conversation: { usage: 0, limit: 5000 },
        ai_conversation: { usage: 0, limit: 500 },
        ai_chatbot: { usage: 0, limit: 50 },
        agent: { usage: 0, limit: 20 },
        chat_shortcut: 50,
        drafts: { usage: 0, limit: 50 },
        scheduling_posts: { usage: 0, limit: 100, reset: "monthly"  }, // Updated limit for scheduling posts
      },
    },
    enterprise: {
      name: "Enterprise",
      price: "Contact us",
     /* limits: {
        conversation: { usage: 0, limit: 10000 },
        ai_conversation: { usage: 0, limit: 1000 },
        ai_chatbot: { usage: 0, limit: 100 },
        agent: { usage: 0, limit: 50 },
        chat_shortcut: 100,
        drafts: { usage: 0, limit: 100 },
        scheduling_posts: { usage: 0, limit: 500, reset: "monthly"  }, // Updated limit for scheduling posts
      },*/
    },
  };


const standardPlan = (item) => {
    const plans = {
        free: subscriptionPlanList.free,
        pro: subscriptionPlanList.pro,
        team: subscriptionPlanList.team,
        enterprise: subscriptionPlanList.enterprise,
    };
    return plans[item] || null;
};
  
  
  

const createSubscriptionData = async (user_id, plan) => {

    const data = standardPlan(plan);
    if (!data) {
        console.log("Invalid plan type");
        return false;
    }


    const [result] = await config.db.execute("INSERT INTO subscriptions (user_id, plan) VALUES (?, ?)", [user_id, JSON.stringify(data)]);
    if(result.affectedRows > 0){
        console.log("Subscription data created successfully");
        return true;
    }else{
        console.log("Failed to create subscription data");
        return false;
    }

}





module.exports = {createSubscriptionData, subscriptionPlanList};