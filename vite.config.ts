import { sites } from '@openai/sites-vite-plugin';
import {zhiyuRuntimePlugins} from './server/beta/runtime';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
// The desktop is a long-running App, not an editing session. Avoid keeping the
// HMR graph and watchers alive for days; code changes apply on a normal reopen.
const isDesktopRuntime = process.env.ZHIYU_DESKTOP_RUNTIME === '1';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({mode}) => {
  const providerEnv=loadEnv(mode,process.cwd(),'');
  for(const key of [
    'NPC_TEXT_PROVIDER','DEEPSEEK_API_KEY','DEEPSEEK_MODEL','DEEPSEEK_THINKING',
    'WEATHER_API_KEY','WEATHER_API_HOST',
    'NPC_AUDIO_PROVIDER','NPC_AUDIO_API_KEY','NPC_ASR_MODEL','NPC_TTS_MODEL',
    'NPC_VOICE_XIA_XIA','NPC_VOICE_YUAN','NPC_VOICE_MOLLY','NPC_VOICE_LIU',
    'DOUBAO_SPEECH_API_KEY','DOUBAO_ASR_RESOURCE_ID','DOUBAO_TTS_RESOURCE_ID',
    'DOUBAO_DEFAULT_VOICE','DOUBAO_VOICE_XIA_XIA','DOUBAO_VOICE_YUAN',
    'DOUBAO_VOICE_MOLLY','DOUBAO_VOICE_LIU',
    'DASHSCOPE_API_KEY','DASHSCOPE_WORKSPACE_ID','QWEN_TTS_MODEL','QWEN_TTS_LOCAL_URL','QWEN_TTS_LOCAL_PYTHON','QWEN_TTS_LOCAL_MODEL',
    'QWEN_VOICE_XIA_XIA','QWEN_VOICE_YUAN','QWEN_VOICE_MOLLY','QWEN_VOICE_LIU',
    'QWEN_LOCAL_SPEAKER_XIA_XIA','QWEN_LOCAL_SPEAKER_YUAN','QWEN_LOCAL_SPEAKER_MOLLY','QWEN_LOCAL_SPEAKER_LIU',
  ])if(providerEnv[key])process.env[key]=providerEnv[key];
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const nodeRelease=process.env.ZHIYU_NODE_SERVER==='1';
  const { cloudflare } = nodeRelease ? {cloudflare:null} : await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      host: '127.0.0.1',
      port: 3100,
      strictPort: true,
      // Runtime files include local credentials and must only be read by
      // authenticated API middleware, never Vite's static or /@fs routes.
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.npc-runtime/**'],
      },
      // Runtime models, Python environments and generated media live under
      // .npc-runtime. Watching that multi-GB tree made a cold launch take
      // several minutes and caused the outer launcher to report HTTP 000.
      hmr: isDesktopRuntime ? false : undefined,
      watch: isDesktopRuntime ? null : {
        ignored: ['**/.npc-runtime/**', '**/desktop/dist/**', '**/output/**'],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      ...zhiyuRuntimePlugins(),
      vinext(),
      ...(nodeRelease?[]:[sites(),
      cloudflare!({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      })]),
    ],
  };
});
