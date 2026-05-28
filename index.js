const express = require('express');
const app = express();

app.get('/hello', (req, res) => {
    res.json({ message: 'Hello from Node API' });
});

app.listen(3000, () => console.log('API running on port 3000'));
