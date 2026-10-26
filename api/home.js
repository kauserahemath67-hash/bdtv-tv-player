const fs = require('fs');
const path = require('path');

let cachedHtml = '';
try {
  cachedHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
} catch (e) {
  try {
    cachedHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch (e2) {}
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(200).send(cachedHtml);
};
