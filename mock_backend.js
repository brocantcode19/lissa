const express = require('express');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  next();
});

app.get('/api/auth/me', (req, res) => {
  res.json({ full_name: 'Test Student', role_id: 'student', email_address: 'test@student.local' });
});

app.get('/api/query/my-history', (req, res) => {
  res.json([]);
});

app.post('/api/query/', (req, res) => {
  const { question } = req.body || {};
  if (!question) return res.status(400).json({ detail: 'Missing question' });
  const id = `mock-${Date.now()}`;
  res.json({ inquiry_id: id, question, answer: `Mock answer for: ${question}`, confidence: 0.9, confidence_label: 'high', source_filename: null, context: null, escalated: false });
});

app.post('/api/query/:inquiry_id/feedback', (req, res) => {
  res.json({ message: 'Feedback recorded.' });
});

app.listen(8000, () => console.log('Mock backend listening on http://localhost:8000'));
