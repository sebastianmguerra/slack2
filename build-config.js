// Script ejecutado automáticamente por Vercel durante el despliegue (build)
// Si definiste variables de entorno en Vercel, las inyecta en js/config.js.
// Si ya las pusiste manualmente en js/config.js, las respeta sin borrarlas.

const fs = require("fs");
const path = require("path");

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const workspaceName =
  process.env.WORKSPACE_NAME ||
  process.env.NEXT_PUBLIC_WORKSPACE_NAME ||
  "Slack Chat";

const configPath = path.join(__dirname, "js", "config.js");

if (supabaseUrl && supabaseAnonKey) {
  const content = `// Generado automáticamente en el build de Vercel
window.SLACK_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(supabaseUrl.trim())},
  SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey.trim())},
  WORKSPACE_NAME: ${JSON.stringify(workspaceName.trim())}
};
`;
  fs.writeFileSync(configPath, content, "utf8");
  console.log("✅ js/config.js actualizado con las variables de entorno de Vercel.");
} else {
  console.log("ℹ️ Sin variables de entorno detectadas en el build; conservando js/config.js actual.");
}
