const express = require('express');
const path = require('path');
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`注册电气工程师专业考试学习平台运行在 http://localhost:${PORT}`);
});