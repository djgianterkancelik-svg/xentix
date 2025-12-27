const fetch = require("node-fetch");
const { Client } = require("pg");

// Telegram API test
async function testTelegramAPI() {
  const response = await fetch(
    "https://api.telegram.org/bot7657260714:AAElFAKrRg9Gs8ZG8TSwVXx7N5r0Krol4gI/getMe"
  );
  const data = await response.json();
  console.log(data); // This should return bot info
}

// PostgreSQL database connection test
async function testPostgres() {
  const client = new Client({
    connectionString:
      "postgres://u3v0gkmh59p752:pd65ad94846b94cc56c9a45380ed5b4e3b4743f8ffc3a57cef8adbf6b13b87060@cc0gj7hsrh0ht8.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/dad7cis70dr20j",
  });

  try {
    await client.connect();
    console.log("Connected to PostgreSQL!");
    await client.end();
  } catch (err) {
    console.error("Database connection failed:", err.message);
  }
}

// Run tests
testTelegramAPI().catch((err) =>
  console.error("Telegram API test failed:", err.message)
);
testPostgres().catch((err) =>
  console.error("PostgreSQL test failed:", err.message)
);
