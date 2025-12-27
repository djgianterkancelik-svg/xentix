// Xentix (XTX) Mining Simulator - Telegram Mini App
const express = require("express");
const { Telegraf } = require("telegraf");
const { Pool } = require("pg");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Initialize Telegram bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Database connection (Heroku PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Initialize database tables
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL DEFAULT 0,
        mining_rate DECIMAL DEFAULT 0.01,
        last_mined TIMESTAMP,
        referrer_id BIGINT,
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT,
        referred_id BIGINT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (referrer_id) REFERENCES users(user_id),
        FOREIGN KEY (referred_id) REFERENCES users(user_id)
      );
      
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT,
        description TEXT,
        reward DECIMAL,
        required_action TEXT
      );
      
      CREATE TABLE IF NOT EXISTS completed_tasks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        task_id INTEGER,
        completion_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
    `);

    // Insert default tasks
    await client.query(`
      INSERT INTO tasks (title, description, reward, required_action)
      VALUES 
        ('Daily Check-in', 'Open the app daily to mine XTX', 0.5, 'daily_check'),
        ('Invite Friends', 'Invite 3 friends to join Xentix', 2.0, 'invite_friends'),
        ('Complete Profile', 'Fill out your mining profile', 1.0, 'complete_profile'),
        ('Join Community', 'Join the Xentix Telegram group', 1.5, 'join_group'),
        ('Share on Social', 'Share about Xentix on social media', 2.5, 'share_social')
      ON CONFLICT DO NOTHING;
    `);
  } finally {
    client.release();
  }
};

// Initialize database
initDB().catch((err) => console.error("Database initialization error:", err));

// Register user
const registerUser = async (userId, username, referrerId = null) => {
  const client = await pool.connect();
  try {
    // Check if user exists
    const userCheck = await client.query(
      "SELECT * FROM users WHERE user_id = $1",
      [userId]
    );

    if (userCheck.rows.length === 0) {
      // Register new user
      await client.query(
        "INSERT INTO users (user_id, username, mining_rate, last_mined, referrer_id) VALUES ($1, $2, $3, $4, $5)",
        [userId, username, 0.01, new Date(), referrerId]
      );

      // Record referral if applicable
      if (referrerId) {
        await client.query(
          "INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)",
          [referrerId, userId]
        );

        // Bonus for referrer
        await client.query(
          "UPDATE users SET balance = balance + 1.0 WHERE user_id = $1",
          [referrerId]
        );
      }

      return true;
    }
    return false;
  } finally {
    client.release();
  }
};

// Mine XTX tokens
const mineTokens = async (userId) => {
  const client = await pool.connect();
  try {
    const user = await client.query("SELECT * FROM users WHERE user_id = $1", [
      userId,
    ]);

    if (user.rows.length === 0) {
      return { success: false, message: "User not found" };
    }

    const currentTime = new Date();
    const lastMined = new Date(user.rows[0].last_mined);
    const timeDiff = (currentTime - lastMined) / 1000; // in seconds

    // Can mine every 60 seconds
    if (timeDiff < 60) {
      return {
        success: false,
        message: `You can mine again in ${Math.ceil(60 - timeDiff)} seconds`,
        timeRemaining: Math.ceil(60 - timeDiff),
      };
    }

    const miningRate = parseFloat(user.rows[0].mining_rate);
    const minedAmount = miningRate * (Math.random() * 0.5 + 0.75); // Random factor between 0.75 and 1.25

    await client.query(
      "UPDATE users SET balance = balance + $1, last_mined = $2 WHERE user_id = $3",
      [minedAmount, currentTime, userId]
    );

    return {
      success: true,
      message: `Successfully mined ${minedAmount.toFixed(4)} XTX!`,
      amount: minedAmount,
    };
  } finally {
    client.release();
  }
};

// Get user balance and stats
const getUserStats = async (userId) => {
  const client = await pool.connect();
  try {
    const user = await client.query("SELECT * FROM users WHERE user_id = $1", [
      userId,
    ]);

    if (user.rows.length === 0) {
      return null;
    }

    // Count referrals
    const referrals = await client.query(
      "SELECT COUNT(*) FROM referrals WHERE referrer_id = $1",
      [userId]
    );

    // Count completed tasks
    const tasks = await client.query(
      "SELECT COUNT(*) FROM completed_tasks WHERE user_id = $1",
      [userId]
    );

    return {
      userId: user.rows[0].user_id,
      username: user.rows[0].username,
      balance: parseFloat(user.rows[0].balance).toFixed(4),
      miningRate: parseFloat(user.rows[0].mining_rate).toFixed(4),
      referrals: parseInt(referrals.rows[0].count),
      completedTasks: parseInt(tasks.rows[0].count),
      lastMined: user.rows[0].last_mined,
    };
  } finally {
    client.release();
  }
};

// Get available tasks
const getAvailableTasks = async (userId) => {
  const client = await pool.connect();
  try {
    // Get all tasks
    const allTasks = await client.query("SELECT * FROM tasks");

    // Get completed tasks
    const completedTasks = await client.query(
      "SELECT task_id FROM completed_tasks WHERE user_id = $1",
      [userId]
    );

    const completedTaskIds = completedTasks.rows.map((task) => task.task_id);

    // Filter tasks that can be completed again (daily tasks)
    const dailyTasks = await client.query(
      `
      SELECT t.id 
      FROM tasks t
      JOIN completed_tasks ct ON t.id = ct.task_id
      WHERE ct.user_id = $1
      AND t.required_action = 'daily_check'
      AND DATE(ct.completion_date) < CURRENT_DATE
    `,
      [userId]
    );

    const dailyTaskIds = dailyTasks.rows.map((task) => task.id);

    // Combine all available tasks
    return allTasks.rows.filter(
      (task) =>
        !completedTaskIds.includes(task.id) || dailyTaskIds.includes(task.id)
    );
  } finally {
    client.release();
  }
};

// Complete a task
const completeTask = async (userId, taskId) => {
  const client = await pool.connect();
  try {
    // Check if task exists
    const task = await client.query("SELECT * FROM tasks WHERE id = $1", [
      taskId,
    ]);

    if (task.rows.length === 0) {
      return { success: false, message: "Task not found" };
    }

    // Check if task is already completed (except daily tasks)
    if (task.rows[0].required_action !== "daily_check") {
      const completedCheck = await client.query(
        "SELECT * FROM completed_tasks WHERE user_id = $1 AND task_id = $2",
        [userId, taskId]
      );

      if (completedCheck.rows.length > 0) {
        return { success: false, message: "Task already completed" };
      }
    } else {
      // For daily tasks, check if completed today
      const dailyCheck = await client.query(
        `
        SELECT * FROM completed_tasks 
        WHERE user_id = $1 
        AND task_id = $2
        AND DATE(completion_date) = CURRENT_DATE
      `,
        [userId, taskId]
      );

      if (dailyCheck.rows.length > 0) {
        return {
          success: false,
          message: "Daily task already completed today",
        };
      }
    }

    // Record task completion
    await client.query(
      "INSERT INTO completed_tasks (user_id, task_id) VALUES ($1, $2)",
      [userId, taskId]
    );

    // Award reward
    const reward = parseFloat(task.rows[0].reward);
    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE user_id = $2",
      [reward, userId]
    );

    // Increase mining rate for completing tasks
    await client.query(
      "UPDATE users SET mining_rate = mining_rate + $1 WHERE user_id = $2",
      [reward * 0.001, userId] // Small boost to mining rate
    );

    return {
      success: true,
      message: `Completed task: ${task.rows[0].title}. Earned ${reward.toFixed(
        2
      )} XTX!`,
      reward: reward,
    };
  } finally {
    client.release();
  }
};

// Generate referral link
const generateReferralLink = (userId) => {
  return `https://t.me/${process.env.BOT_USERNAME}?start=ref${userId}`;
};

// === Telegram Bot Commands ===

// Start command
bot.start(async (ctx) => {
  const startPayload = ctx.startPayload;
  let referrerId = null;

  if (startPayload && startPayload.startsWith("ref")) {
    referrerId = parseInt(startPayload.substring(3));
  }

  const userId = ctx.from.id;
  const username = ctx.from.username || `user${userId}`;

  const isNewUser = await registerUser(userId, username, referrerId);

  if (isNewUser) {
    await ctx.reply(
      "Welcome to Xentix (XTX) Mining Simulator! 🚀\n\nYou can start mining tokens and completing tasks to earn XTX. Use the mini app to access all features."
    );

    if (referrerId) {
      await ctx.reply(
        "You joined through a referral link! Both you and your referrer received a bonus!"
      );
    }
  } else {
    await ctx.reply(
      "Welcome back to Xentix (XTX) Mining Simulator! 📱\n\nUse the mini app to continue mining and earning XTX."
    );
  }

  // Send mini app keyboard
  ctx.reply("Open the Xentix Mining app:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⛏️ Open Mining App",
            web_app: { url: process.env.WEBAPP_URL },
          },
        ],
      ],
    },
  });
});

// Balance command
bot.command("balance", async (ctx) => {
  const userId = ctx.from.id;
  const stats = await getUserStats(userId);

  if (!stats) {
    return ctx.reply("You need to start mining first! Use /start to begin.");
  }

  await ctx.reply(
    `💰 Your XTX Balance: ${stats.balance} XTX\n⛏️ Mining Rate: ${stats.miningRate} XTX/min\n👥 Referrals: ${stats.referrals}\n✅ Tasks Completed: ${stats.completedTasks}`
  );
});

// Mine command
bot.command("mine", async (ctx) => {
  const userId = ctx.from.id;
  const result = await mineTokens(userId);

  await ctx.reply(result.message);

  if (result.success) {
    const stats = await getUserStats(userId);
    await ctx.reply(`Updated Balance: ${stats.balance} XTX`);
  }
});

// Tasks command
bot.command("tasks", async (ctx) => {
  const userId = ctx.from.id;
  const tasks = await getAvailableTasks(userId);

  if (tasks.length === 0) {
    return ctx.reply("You have completed all available tasks for now!");
  }

  let message = "📋 Available Tasks:\n\n";
  tasks.forEach((task, index) => {
    message += `${index + 1}. ${task.title} - ${task.reward} XTX\n${
      task.description
    }\n\n`;
  });

  await ctx.reply(message);
});

// Referral command
bot.command("referral", async (ctx) => {
  const userId = ctx.from.id;
  const referralLink = generateReferralLink(userId);

  await ctx.reply(
    `🔗 Your Referral Link:\n${referralLink}\n\nShare this link with friends. You'll earn 1 XTX for each friend who joins!`
  );
});

// Help command
bot.command("help", async (ctx) => {
  await ctx.reply(
    "Xentix (XTX) Mining Simulator Commands:\n\n" +
      "/start - Start mining\n" +
      "/mine - Mine XTX tokens\n" +
      "/balance - Check your balance\n" +
      "/tasks - View available tasks\n" +
      "/referral - Get your referral link\n" +
      "/help - Show this help message\n\n" +
      "Use the mini app for the best experience!"
  );
});

// Launch bot
bot.launch();

// === API Endpoints for Web App ===

// Get user data
app.get("/api/user/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const stats = await getUserStats(userId);

    if (!stats) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(stats);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Mine tokens
app.post("/api/mine", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    const result = await mineTokens(userId);
    res.json(result);
  } catch (error) {
    console.error("Error mining tokens:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get tasks
app.get("/api/tasks/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const tasks = await getAvailableTasks(userId);
    res.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Complete task
app.post("/api/complete-task", async (req, res) => {
  try {
    const { userId, taskId } = req.body;

    if (!userId || !taskId) {
      return res.status(400).json({ error: "User ID and Task ID required" });
    }

    const result = await completeTask(userId, taskId);
    res.json(result);
  } catch (error) {
    console.error("Error completing task:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get referrals
app.get("/api/referrals/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const client = await pool.connect();

    try {
      const referrals = await client.query(
        `
        SELECT u.username, r.date 
        FROM referrals r
        JOIN users u ON r.referred_id = u.user_id
        WHERE r.referrer_id = $1
        ORDER BY r.date DESC
      `,
        [userId]
      );

      res.json(referrals.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching referrals:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
// Serve static files
app.use(express.static("public"));
