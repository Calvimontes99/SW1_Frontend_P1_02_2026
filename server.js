const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'dist')));

// Manejar rutas SPA - devolver index.html para todas las rutas
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Frontend server running on port ${port}`);
});