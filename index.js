const Parser = require('rss-parser');
const rp = require('request-promise');
const { Client } = require('pg');

const parser = new Parser();
require('dotenv').config();

async function connect() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  return new Promise((resolve, reject) => {
    client.connect((err, _) => {
      if (err) { return reject(err); }
      resolve(client);
    });
  });
}

async function exec(client, sql, values = []) {
  return new Promise((resolve, reject) => {
    client.query(sql, values, (err, result) => {
      if (err) { return reject(err); }
      resolve(result);
    });
  });
}

async function isNotified(client, topic) {
  return new Promise((resolve, reject) => {
    exec(client, 'SELECT COUNT(*) FROM notified WHERE topic = $1', [topic]).then(res => {
      if (!res.rows || !res.rows.length) {
        return resolve(false);
      }
      resolve(res.rows[0].count > 0);
    }, reject).catch(reject);
  });
}

async function setNotified(client, topic) {
  return exec(client, 'INSERT INTO notified VALUES ($1)', [topic]);
}

async function checkTable(client) {
  const query = 'CREATE TABLE IF NOT EXISTS notified (topic int)';
  return exec(client, query);
}

async function run() {
  try {
    const client = await connect();
    const feed = await parser.parseURL(process.env.FEED_URL);
    const forums = process.env.FORUMS && process.env.FORUMS.split(',');
    const webhook = process.env.WEBHOOK_URL;

    await checkTable(client);

    await Promise.all(feed.items.map(async item => {
      const { title, categories, link } = item;
      const category = categories[0];
      const topic = link.split('?topic=')[1].split('.')[0];
      if (!title.startsWith('Re:')) {
        if (!forums || forums.indexOf(category)) {
          if (await isNotified(client, topic)) {
            console.log('Already notified -', topic, title);
            return;
          }

          console.log('Notifying -', title);
          const options = {
            method: 'POST',
            url: webhook,
            body: {
              content: `<@&676468893551951902> ${title} - ${link}`,
            },
            json: true,
          };
          await rp(options);
          return await setNotified(client, topic);
        }
      }
    }));

    client.end();
  } catch (err) {
    console.log('error');
    console.log('Error executing', err);
  }
  setTimeout(() => run(), process.env.INTERVAL || 1000);
};

run();
