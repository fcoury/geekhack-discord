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

async function exec(client, sql, values=[]) {
  return new Promise((resolve, reject) => {
    client.query(sql, values, (err, result) => {
      if (err) { return reject(err); }
      resolve(result);
    });
  });
}

async function isNotified(client, link) {
  return new Promise((resolve, reject) => {
    exec(client, 'SELECT COUNT(*) FROM notified WHERE link = $1', [link]).then(res => {
      if (!res.rows || !res.rows.length) {
        return resolve(false);
      }
      resolve(res.rows[0].count > 0);
    }, reject).catch(reject);
  });
}

async function setNotified(client, link) {
  return exec(client, 'INSERT INTO notified VALUES ($1)', [link]);
}

async function checkTable(client) {
  const query = 'CREATE TABLE IF NOT EXISTS notified (link VARCHAR(1000))';
  return exec(client, query);
}

(async () => {
  const client = await connect();
  const feed = await parser.parseURL(process.env.FEED_URL);
  const forums = process.env.FORUMS && process.env.FORUMS.split(',');
  const webhook = process.env.WEBHOOK_URL;

  await checkTable(client);

  await Promise.all(feed.items.map(async item => {
    const { title, categories, link } = item;
    const category = categories[0];
    if (!title.startsWith('Re:')) {
      if (!forums || forums.indexOf(category)) {
        if (await isNotified(client, link)) {
          console.log('Already notified -', title);
          return;
        }

        console.log('Notifying -', title);
        const options = {
          method: 'POST',
          url: webhook,
          body: {
            content: `${title} - ${link}`,
          },
          json: true,
        };
        await rp(options);
        return await setNotified(client, link);
      }
    }
  }));

  client.end();

})();
