import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';

// Isolated asset renderer for UI checks. No NPC/auth/worker plugins, runtime
// databases, model configuration or production environment are imported.
export default defineConfig({
  root:fileURLToPath(new URL('..',import.meta.url)),
  css:{postcss:{plugins:[tailwindcss()]}},
  server:{host:'127.0.0.1',port:3101,strictPort:true,
    fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.npc-runtime/**']},
    watch:{ignored:['**/.npc-runtime/**','**/desktop/dist/**','**/output/**'],usePolling:true,useFsEvents:false}},
  plugins:[vinext()],
});
