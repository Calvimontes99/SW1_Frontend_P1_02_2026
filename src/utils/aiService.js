// Simple client-side service to call backend AI endpoints
import { errorDeRespuesta } from './mensajesError';

// Resolve API base URL: prefer explicit VITE_API_BASE, then VITE_WS_URL (set in .env.development
// for local dev); in production the backend serves the frontend, so use the page's own origin.
const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_WS_URL || window.location.origin;

export async function generateDiagram({ type = 'text', content = '', file = null, salaId = null }) {
  // Use a dedicated image endpoint for image uploads so frontend does not depend
  // on ai.controller.js for image processing. Non-image requests still use
  // the generic generate-diagram endpoint handled by ai.controller.js.
  const url = (file && type === 'image') ? `${API_BASE}/apis/ai/generate-diagram/image` : `${API_BASE}/apis/ai/generate-diagram`;

  try {
    if (file) {
      const form = new FormData();
      form.append(type === 'voice' ? 'audio' : 'image', file);
      form.append('type', type);
      form.append('salaId', salaId || '');
      // content is optional when sending file
      if (content) form.append('content', content);

      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        body: form
      });

      if (!resp.ok) {
        const text = await resp.text();
        // Try to parse JSON error body if present
        let parsed = text;
        try { parsed = JSON.parse(text); } catch (e) { /* keep raw text */ }
        throw errorDeRespuesta(resp, typeof parsed === 'object' ? parsed : null, 'La IA no pudo procesar el archivo.');
      }

      return await resp.json();
    }

    // JSON POST for text
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', content, salaId })
    });

    if (!resp.ok) {
      const text = await resp.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch (e) { }
      throw errorDeRespuesta(resp, typeof parsed === 'object' ? parsed : null, 'La IA no pudo procesar el pedido.');
    }

    return await resp.json();
  } catch (error) {
    console.error('generateDiagram error', error);
    throw error;
  }
}

export async function modifyDiagram({ 
  prompt, 
  nodes = [], 
  edges = [], 
  mode = 'modify', 
  dryRun = false, 
  clarification = null, 
  originalPrompt = null, 
  salaId = null 
} = {}) {
  const url = `${API_BASE}/apis/ai/modify-diagram`;
  
  try {
    const requestBody = {
      prompt,
      nodes,
      edges,
      mode,
      dryRun,
      salaId
    };

    // Agregar información de clarificación si está disponible
    if (clarification) {
      requestBody.clarification = clarification;
    }
    if (originalPrompt) {
      requestBody.originalPrompt = originalPrompt;
    }

    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include', // Importante para autenticación
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!resp.ok) {
      const text = await resp.text();
      let parsed = text;
      try { 
        parsed = JSON.parse(text); 
      } catch (e) { 
        // mantener texto original si no es JSON válido
      }
      throw errorDeRespuesta(resp, typeof parsed === 'object' ? parsed : null, 'La IA no pudo procesar el pedido.');
    }

    return await resp.json();
  } catch (error) {
    console.error('modifyDiagram error', error);
    throw error;
  }
}
