// netlify/functions/genera-menu.js
// netlify/functions/genera-menu.js
export const handler = async (event, context) => {
  const fetch = (await import("node-fetch")).default;
  const { createClient } = await import("@supabase/supabase-js");

  // 🔐 Configuración
  const API_URL = "https://api.openai.com/v1/chat/completions";
  const API_KEY = process.env.OPENAI_API_KEY;
  const SUPABASE_URL = "https://sfslkqjyylovajppdrjk.supabase.co";
  const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmc2xrcWp5eWxvdmFqcHBkcmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MTE4MzYsImV4cCI6MjA3NTA4NzgzNn0.SDorXKMk6k67LlI8aA5GPbsjcSmkuMMMKH8to7UpoLk";

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 7000;

  // 🧠 Recogemos filtros del body
  const body = event.body ? JSON.parse(event.body) : {};
  const filtros = body.filtros || {};
  const tipo = filtros.tipo || "normal";
  const semana = filtros.semana || new Date().toISOString().split("T")[0];

  // 📋 1️⃣ Comprobar si ya hay menú guardado para esa semana
  const { data: existente, error: selectError } = await supabase
    .from("menus")
    .select("*")
    .eq("semana", semana)
    .eq("tipo", tipo)
    .single();

  if (existente && !selectError) {
    console.log("✅ Menú ya existente, devolviendo desde Supabase");
    return {
      statusCode: 200,
      body: JSON.stringify(existente.datos),
    };
  }

  // 🍳 2️⃣ Si no existe, generar con OpenAI
  const prompt = `
Eres un asistente culinario experto en nutrición y planificación semanal.

Genera un menú semanal con 7 platos diferentes (uno por día), teniendo en cuenta estos filtros:
- Fecha de inicio de la semana: ${semana}
- Tipo de dieta: ${tipo}
- Dificultad: fácil, media o alta según el contenido.
- Tiempo máximo de preparación: 45 minutos.
- Número de personas: 1.

💡 Objetivo:
Crear un menú equilibrado y variado (proteínas, vegetales, hidratos) que no repita platos ni ingredientes principales en días consecutivos.

📦 Formato de salida: JSON válido y estructurado exactamente así:

{
  "semana": [
    {
      "dia": "Lunes",
      "plato": "Nombre del plato",
      "tiempo_preparacion": "25 min",
      "dificultad": "media",
      "ingredientes": [
        {"nombre": "ingrediente 1", "cantidad": "100 g"},
        {"nombre": "ingrediente 2", "cantidad": "50 ml"}
      ],
      "receta": "Texto breve con los pasos de preparación (máximo 4 pasos).",
      "video_url": "https://www.youtube.com/results?search_query=receta+Nombre+del+plato"
    }
  ],
  "lista_compra": [
    {"nombre": "ingrediente 1", "cantidad": "200 g"},
    {"nombre": "ingrediente 2", "cantidad": "100 ml"}
  ]
}

🧠 Reglas:
- No repitas platos ni ingredientes principales.
- Adapta los platos al tipo de dieta (${tipo}).
- Genera recetas prácticas, mediterráneas y saludables.
- Devuelve solo el JSON (sin texto adicional fuera del bloque JSON).
`;

  const fetchWithTimeout = async (url, options, retries = MAX_RETRIES) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      clearTimeout(timeout);
      if (retries > 0) {
        return fetchWithTimeout(url, options, retries - 1);
      } else {
        return { error: "Fallo al generar el menú. Inténtalo más tarde." };
      }
    }
  };

  const response = await fetchWithTimeout(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
    }),
  });

  if (response.error) {
    return { statusCode: 500, body: JSON.stringify(response) };
  }

  const menu = response.choices?.[0]?.message?.content || "{}";

  try {
    const parsed = JSON.parse(menu);

    // 🗄️ 3️⃣ Guardar en Supabase
    const { error: insertError } = await supabase.from("menus").insert([
      {
        semana,
        tipo,
        datos: parsed,
        created_at: new Date().toISOString(),
      },
    ]);

    if (insertError) console.error("❌ Error al guardar en Supabase:", insertError);

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: "JSON inválido" }) };
  }
};
